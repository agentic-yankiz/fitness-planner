#!/usr/bin/env node
/**
 * Fitness site Node server — default port 3000 (SERVER_PORT env to override).
 *
 * Topology:
 *   Tailscale Serve (TLS + identity headers)
 *     → Caddy :8080 (strip /fitness prefix, forward to this server)
 *       → Node :3000 (this file)
 *
 * Routes (paths as seen by Node, after Caddy strips /fitness):
 *   GET  /           → serve dist/index.html
 *   GET  /styles.css → serve dist/styles.css
 *   POST /api/done         → mark today as trained
 *   GET  /api/done/today   → check if today is marked done
 *   GET  /api/stats        → JSON adherence summary
 *   GET  /stats            → SSR adherence page
 *
 * External URLs through the full stack:
 *   POST /fitness/api/done
 *   GET  /fitness/api/done/today
 *   GET  /fitness/api/stats
 *   GET  /fitness/stats
 *
 * Write-auth middleware (mutating routes only):
 *   • Tailscale-User-Login == klein.shaked@gmail.com  → allow (owner via proxy)
 *   • No header AND loopback remote_addr               → allow (local automation)
 *   • Anything else                                    → 403
 *
 * See docs/infra/tailscale-serving.md for the full trust-model rationale.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, runMigrations } from './migrate.mjs';
import { computeStats } from './stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DIST = path.join(__dirname, 'dist');
const PORT = parseInt(process.env.SERVER_PORT ?? '3000', 10);
const OWNER_EMAIL = 'klein.shaked@gmail.com';

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Load trainingDays from config.json at boot.
 * Falls back to [1,2,4,5] (Mon/Tue/Thu/Fri) if the file is missing or malformed.
 */
function loadTrainingDays() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    const cfg = JSON.parse(raw);
    if (Array.isArray(cfg.trainingDays) && cfg.trainingDays.length) {
      return cfg.trainingDays;
    }
  } catch { /* fall through */ }
  return [1, 2, 4, 5];
}

const TRAINING_DAYS = loadTrainingDays();

// ── Database ──────────────────────────────────────────────────────────────────

/** Module-level DB handle. Injected by boot code or tests via setDb(). */
let _db = null;

/**
 * Inject (or clear) the database handle used by API handlers.
 * Call setDb(null) in tests to reset between suites.
 * @param {import('node:sqlite').DatabaseSync|null} db
 */
export function setDb(db) {
  _db = db;
}

/**
 * Get the active DB. Opens lazily if not set (e.g. when router is used
 * without explicit boot). Migrations are run on lazy open.
 * @returns {import('node:sqlite').DatabaseSync}
 */
function getDb() {
  if (!_db) {
    _db = openDb();
    runMigrations(_db);
  }
  return _db;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Return today's date as "YYYY-MM-DD" using the server's LOCAL time zone.
 *
 * We deliberately use getFullYear/getMonth/getDate (local) rather than
 * toISOString().slice(0,10) (UTC) so that a session logged at 00:30 local
 * still counts for the new local day — important for post-midnight gym
 * sessions in Asia/Jerusalem (UTC+3).
 *
 * @param {Date} [now] - injectable for tests; defaults to current time.
 * @returns {string} e.g. "2026-07-09"
 */
export function localDateStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Static root. Defaults to ./dist; SITE_DIST_DIR overrides it (used by tests).
function distDir() {
  return process.env.SITE_DIST_DIR ?? DEFAULT_DIST;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isLoopback(addr) {
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1'
  );
}

/**
 * Write-auth middleware.
 * Calls next() on allow; sends 403 JSON and returns on deny.
 * GET/HEAD/OPTIONS are always forwarded to next() unchecked.
 *
 * Trust model (full rationale: docs/infra/tailscale-serving.md):
 *   - The backend binds 127.0.0.1, so the sole non-loopback path is the
 *     Tailscale serve proxy, which injects Tailscale-User-Login on every
 *     request it forwards. A missing header on the loopback interface is
 *     therefore reliable evidence of local automation.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {() => void} next
 */
export function writeAuth(req, res, next) {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return next();
  }

  const userLogin = req.headers['tailscale-user-login'];
  const remoteAddr = req.socket?.remoteAddress ?? '';

  // Case 1: owner identity injected by the Tailscale proxy.
  if (userLogin === OWNER_EMAIL) {
    return next();
  }

  // Case 2: loopback automation bypass — no header AND loopback source.
  //   Both conditions are required. A missing header alone is not sufficient.
  if (userLogin === undefined && isLoopback(remoteAddr)) {
    return next();
  }

  // Deny by default.
  sendJson(res, 403, {
    error: 'Forbidden',
    message: 'Write access requires owner identity.',
  });
}

// ── Static file serving ───────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  const method = (req.method ?? 'GET').toUpperCase();

  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    return sendJson(res, 400, { error: 'Bad Request', message: 'Malformed URL.' });
  }
  if (urlPath === '') urlPath = '/';

  const DIST = distDir();
  let filePath = path.join(DIST, urlPath);

  // Path-traversal guard — path.join normalises `..`, so anything that escapes
  // DIST is rejected here.
  if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) {
    return sendJson(res, 400, { error: 'Bad Request', message: 'Invalid path.' });
  }

  // Directory-index resolution: map a directory (e.g. /roadmap/ or /roadmap)
  // to its index.html — so /fitness/roadmap/ serves dist/roadmap/index.html.
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    /* miss — handled below */
  }
  if (stat?.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  } else if (!stat && !path.extname(filePath)) {
    const candidate = path.join(filePath, 'index.html');
    if (fs.existsSync(candidate)) filePath = candidate;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const status = err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500;
      return sendJson(res, status, {
        error: status === 404 ? 'Not Found' : 'Internal Server Error',
      });
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    // HEAD must not carry a body.
    res.end(method === 'HEAD' ? undefined : data);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {object} body
 */
export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function notImplemented(res) {
  sendJson(res, 501, {
    error: 'Not Implemented',
    message: 'This endpoint will be available in a future release.',
  });
}

// ── API handlers ──────────────────────────────────────────────────────────────

/**
 * POST /api/done — mark today as trained (idempotent).
 *
 * INSERT OR IGNORE ensures a second request never overwrites the original
 * logged_at. The row is then fetched so the original timestamp is returned.
 *
 * Response 200: { date, done: true, logged_at }
 */
function handlePostDone(res) {
  const db = getDb();
  const date = localDateStr();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT OR IGNORE INTO sessions (date, done, logged_at) VALUES (?, 1, ?)',
  ).run(date, now);

  const row = db.prepare('SELECT date, done, logged_at FROM sessions WHERE date = ?').get(date);
  sendJson(res, 200, { date: row.date, done: row.done === 1, logged_at: row.logged_at });
}

/**
 * GET /api/done/today — check whether today has been marked done.
 *
 * Response 200: { date, done: bool, logged_at: string|null }
 */
function handleGetDoneToday(res) {
  const db = getDb();
  const date = localDateStr();
  const row = db.prepare('SELECT date, done, logged_at FROM sessions WHERE date = ?').get(date);
  sendJson(res, 200, {
    date,
    done: row ? row.done === 1 : false,
    logged_at: row ? row.logged_at : null,
  });
}

// ── Stats handlers (issue #18) ────────────────────────────────────────────────

/**
 * GET /api/stats — machine-readable adherence summary.
 *
 * Response 200: { currentStreak, longestStreak, weekRate, monthRate }
 * weekRate / monthRate are { done, scheduled }.
 */
export function handleGetApiStats(res, { trainingDays = TRAINING_DAYS, todayStr = localDateStr() } = {}) {
  const db = getDb();
  const rows = db.prepare('SELECT date, done FROM sessions').all();
  const { currentStreak, longestStreak, weekRate, monthRate } = computeStats(
    rows, trainingDays, todayStr,
  );
  sendJson(res, 200, { currentStreak, longestStreak, weekRate, monthRate });
}

/**
 * Render an emoji-free calendar cell.
 * @param {'trained'|'missed'|'upcoming'|'rest'} state
 */
function cellHtml(date, state) {
  const d = date.slice(8); // day-of-month
  const labels = {
    trained:  'Trained',
    missed:   'Missed',
    upcoming: 'Upcoming',
    rest:     'Rest',
  };
  return `<td class="cal-cell cal-${state}" title="${date} — ${labels[state]}">${d}</td>`;
}

/** Mon-first weekday headers */
const WEEK_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Build a Mon-first calendar grid HTML for the days array.
 * Pads the first row with empty cells so Mon is column 0.
 */
function calendarGridHtml(days) {
  if (!days.length) return '<p class="empty">No data yet — start training and rows will appear here.</p>';

  // Build weeks (Mon-first). Each day.date is "YYYY-MM-DD"; getDay() is 0=Sun.
  const rows = [];
  let week = null;

  // Pad the first week so Mon is column 0.
  {
    const [y, m, d] = days[0].date.split('-').map(Number);
    const firstDow = new Date(y, m - 1, d).getDay(); // 0=Sun
    const padCols = (firstDow + 6) % 7; // Mon=0
    week = Array(padCols).fill(null);
  }

  for (const day of days) {
    const [y, m, d] = day.date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const col = (dow + 6) % 7; // Mon=0 … Sun=6
    if (col === 0 && week !== null && week.length > 0) {
      rows.push(week);
      week = [];
    }
    week.push(day);
  }
  if (week && week.length) rows.push(week);

  const headerRow = WEEK_HEADERS.map((h) => `<th>${h}</th>`).join('');
  const bodyRows = rows.map((row) => {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const cell = row[i];
      if (!cell) {
        cells.push('<td class="cal-cell cal-empty"></td>');
      } else {
        cells.push(cellHtml(cell.date, cell.state));
      }
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  return `<table class="cal-grid">
  <thead><tr>${headerRow}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>`;
}

/**
 * GET /stats — SSR adherence page.
 *
 * Same chrome as the main page (header + footer + link to styles.css).
 * Shows: current streak, longest streak, week/month rates, 30-day calendar grid.
 */
export function handleGetStatsPage(res, { trainingDays = TRAINING_DAYS, todayStr = localDateStr() } = {}) {
  const db = getDb();
  const rows = db.prepare('SELECT date, done FROM sessions').all();
  const { currentStreak, longestStreak, weekRate, monthRate, days } = computeStats(
    rows, trainingDays, todayStr,
  );

  const isEmpty = rows.length === 0;
  const emptyMsg = isEmpty
    ? '<p class="empty stats-empty">No sessions logged yet — hit the Done button on the <a href=".">plan page</a> after your first workout.</p>'
    : '';

  const weekPct = weekRate.scheduled
    ? Math.round((weekRate.done / weekRate.scheduled) * 100)
    : null;
  const monthPct = monthRate.scheduled
    ? Math.round((monthRate.done / monthRate.scheduled) * 100)
    : null;

  const fmtRate = ({ done, scheduled }, pct) =>
    scheduled
      ? `${done}/${scheduled}${pct !== null ? ` (${pct}%)` : ''}`
      : '—';

  const grid = isEmpty ? '' : calendarGridHtml(days);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Adherence Stats</title>
<link rel="stylesheet" href="styles.css">
<style>
.stats-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 24px; margin: 0 0 24px; }
@media (max-width: 400px) { .stats-summary { grid-template-columns: 1fr; } }
.stat-card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; }
.stat-label { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 4px; }
.stat-value { font-size: 1.6rem; font-weight: 700; color: var(--accent); }
.stat-unit  { font-size: 0.85rem; color: var(--muted); font-weight: 400; }
.cal-section { margin: 0 0 28px; }
.cal-section h2 { font-size: 1.1rem; margin: 0 0 10px; }
.cal-grid { border-collapse: collapse; font-size: 0.82rem; }
.cal-grid th { padding: 4px 8px; text-align: center; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
.cal-cell { width: 36px; height: 32px; text-align: center; border-radius: 6px; font-size: 0.82rem; }
.cal-trained  { background: var(--accent); color: #fff; font-weight: 600; }
.cal-missed   { background: #fee2e2; color: #b91c1c; }
.cal-upcoming { background: var(--accent-soft); color: var(--accent); }
.cal-rest     { color: var(--muted); }
.cal-empty    { background: transparent; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 0.8rem; color: var(--muted); margin: 10px 0 0; }
.legend-dot { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
.stats-empty { margin: 24px 0; }
</style>
</head>
<body>
<main>
  <header class="top">
    <h1><a href="." style="color:inherit;text-decoration:none">Shaked's Workout Plan</a></h1>
  </header>
  <h2 style="margin:0 0 16px;font-size:1.3rem">Adherence Stats</h2>
  ${emptyMsg}
  <div class="stats-summary">
    <div class="stat-card">
      <p class="stat-label">Current Streak</p>
      <p class="stat-value">${currentStreak} <span class="stat-unit">days</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-label">Longest Streak</p>
      <p class="stat-value">${longestStreak} <span class="stat-unit">days</span></p>
    </div>
    <div class="stat-card">
      <p class="stat-label">This Week</p>
      <p class="stat-value">${fmtRate(weekRate, weekPct)}</p>
    </div>
    <div class="stat-card">
      <p class="stat-label">This Month</p>
      <p class="stat-value">${fmtRate(monthRate, monthPct)}</p>
    </div>
  </div>
  <section class="cal-section">
    <h2>Last 30 Days</h2>
    ${grid}
    ${isEmpty ? '' : `<div class="legend">
      <span><span class="legend-dot" style="background:var(--accent)"></span>Trained</span>
      <span><span class="legend-dot" style="background:#fee2e2"></span>Missed</span>
      <span><span class="legend-dot" style="background:var(--accent-soft)"></span>Upcoming / Today</span>
      <span><span class="legend-dot" style="background:var(--line)"></span>Rest</span>
    </div>`}
  </section>
  <footer class="stamp">
    <span>adherence as of ${todayStr}</span>
    <span class="src"><a href=".">back to plan</a></span>
  </footer>
</main>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Main request handler / router.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
export function router(req, res) {
  const method = (req.method ?? 'GET').toUpperCase();
  const url = (req.url ?? '/').split('?')[0];

  // ── API endpoints ─────────────────────────────────────────────────────────
  // Caddy strips /fitness before proxying, so these are /api/* not /fitness/api/*

  if (url === '/api/done' && method === 'POST') {
    return writeAuth(req, res, () => handlePostDone(res));
  }

  if (url === '/api/done/today' && method === 'GET') {
    return handleGetDoneToday(res);
  }

  if (url === '/api/stats' && method === 'GET') {
    return handleGetApiStats(res);
  }

  if (url === '/stats' && method === 'GET') {
    return handleGetStatsPage(res);
  }

  // ── Static assets ─────────────────────────────────────────────────────────
  if (method === 'GET' || method === 'HEAD') {
    return serveStatic(req, res);
  }

  sendJson(res, 405, { error: 'Method Not Allowed' });
}

// ── Boot (only when run as main module) ──────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  runMigrations(db);
  setDb(db);

  const server = http.createServer(router);

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`fitness-site server listening on 127.0.0.1:${PORT}`);
  });

  // Graceful shutdown on SIGTERM/SIGINT (issued by local-sync-serve.sh trap).
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close(() => {
        db.close();
        setDb(null);
        process.exit(0);
      });
    });
  }
}
