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
 *   POST /api/done         → 501 (stub — issue #17)
 *   GET  /api/done/today   → 501 (stub — issue #17)
 *   GET  /api/stats        → 501 (stub — issue #18)
 *
 * External URLs through the full stack:
 *   POST /fitness/api/done
 *   GET  /fitness/api/done/today
 *   GET  /fitness/api/stats
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DIST = path.join(__dirname, 'dist');
const PORT = parseInt(process.env.SERVER_PORT ?? '3000', 10);
const OWNER_EMAIL = 'klein.shaked@gmail.com';

// ── Database ──────────────────────────────────────────────────────────────────

/** Module-level DB handle. Injected by boot code or tests via setDb(). */
let _db = null;

/**
 * Inject (or clear) the database handle used by API handlers.
 * Call setDb(null) in tests to reset between suites.
 * @param {import('better-sqlite3').Database|null} db
 */
export function setDb(db) {
  _db = db;
}

/**
 * Get the active DB. Opens lazily if not set (e.g. when router is used
 * without explicit boot). Migrations are run on lazy open.
 * @returns {import('better-sqlite3').Database}
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
    // stub — issue #18
    return notImplemented(res);
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
