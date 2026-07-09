/**
 * Tests for migration runner and write-auth middleware.
 * Run with:  npm test  (or: node --test test/server.test.mjs)
 *
 * Covers:
 *  1. Migration idempotency
 *  2. Auth middleware matrix (4 cases from tailscale-serving.md §Verification)
 *  3. API stub endpoint behavior (POST /api/done → 501)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

import { openDb, runMigrations } from '../migrate.mjs';
import { writeAuth, router, sendJson, setDb, localDateStr, todayInfo } from '../server.mjs';

// ── 1. Migration idempotency ──────────────────────────────────────────────────

test('migration: creates sessions and schema_migrations tables on a fresh DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-migrate-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    assert.ok(tables.includes('sessions'), 'sessions table exists');
    assert.ok(tables.includes('schema_migrations'), 'schema_migrations table exists');

    // sessions columns
    const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
    assert.ok(cols.includes('date'), 'date column exists');
    assert.ok(cols.includes('done'), 'done column exists');
    assert.ok(cols.includes('logged_at'), 'logged_at column exists');

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration: running twice is idempotent — no duplicate rows on re-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-migrate-'));
  try {
    const db = openDb(join(dir, 'test.db'));

    runMigrations(db); // first run
    const { c: afterFirst } = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get();

    runMigrations(db); // second run — must not throw or duplicate
    const { c: afterSecond } = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get();

    assert.equal(afterSecond, afterFirst, 'row count must not grow on second run (idempotent)');
    assert.ok(afterFirst >= 1, 'at least one migration was applied');

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. Auth middleware matrix ─────────────────────────────────────────────────

/**
 * Build a minimal IncomingMessage-like object.
 * @param {{ method?: string, url?: string, headers?: object, remoteAddress?: string }} opts
 */
function mockReq({ method = 'POST', url = '/api/done', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  return { method, url, headers, socket: { remoteAddress } };
}

/** Build a minimal ServerResponse-like object that records the outcome. */
function mockRes() {
  const res = { statusCode: null, _headers: {}, body: '' };
  res.writeHead = (code, hdrs = {}) => {
    res.statusCode = code;
    Object.assign(res._headers, hdrs);
  };
  res.end = (data = '') => {
    res.body = typeof data === 'string' ? data : data.toString();
  };
  return res;
}

// Case 1 (tailscale-serving.md §Verification #3):
//   loopback remote_addr AND no Tailscale-User-Login header → allow (loopback bypass)
test('auth: loopback + no header → allow', () => {
  const req = mockReq({ remoteAddress: '127.0.0.1', headers: {} });
  const res = mockRes();
  let called = false;
  writeAuth(req, res, () => { called = true; });
  assert.ok(called, 'next() should be called');
  assert.equal(res.statusCode, null, 'no response written by auth middleware');
});

// Case 2 (tailscale-serving.md §Verification #2):
//   Tailscale-User-Login == owner email → allow
test('auth: Tailscale-User-Login == klein.shaked@gmail.com → allow', () => {
  const req = mockReq({
    remoteAddress: '100.64.0.1', // typical tailnet IP
    headers: { 'tailscale-user-login': 'klein.shaked@gmail.com' },
  });
  const res = mockRes();
  let called = false;
  writeAuth(req, res, () => { called = true; });
  assert.ok(called, 'next() should be called for owner identity');
  assert.equal(res.statusCode, null);
});

// Case 3 (tailscale-serving.md §Verification #4):
//   Wrong identity even from loopback → 403 (spoofed header attempt)
test('auth: Tailscale-User-Login == other@example.com (any addr) → 403', () => {
  const req = mockReq({
    remoteAddress: '127.0.0.1', // even loopback
    headers: { 'tailscale-user-login': 'other@example.com' },
  });
  const res = mockRes();
  let called = false;
  writeAuth(req, res, () => { called = true; });
  assert.ok(!called, 'next() must NOT be called');
  assert.equal(res.statusCode, 403);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'Forbidden');
});

// Case 4 (tailscale-serving.md §Verification: non-loopback without header):
//   Non-loopback AND no header → 403 (deny by default)
test('auth: non-loopback + no header → 403', () => {
  const req = mockReq({ remoteAddress: '10.0.0.5', headers: {} });
  const res = mockRes();
  let called = false;
  writeAuth(req, res, () => { called = true; });
  assert.ok(!called, 'next() must NOT be called');
  assert.equal(res.statusCode, 403);
});

// GET requests bypass auth entirely.
test('auth: GET requests always pass auth unchecked', () => {
  const req = mockReq({ method: 'GET', remoteAddress: '10.0.0.5', headers: {} });
  const res = mockRes();
  let called = false;
  writeAuth(req, res, () => { called = true; });
  assert.ok(called, 'GET bypasses auth middleware');
});

// ── 3. Local date helper ──────────────────────────────────────────────────────

test('localDateStr: uses local date components (not UTC)', () => {
  // Pass a fixed Date constructed from LOCAL components.
  // new Date(year, month, day) creates a date in local time; getFullYear/Month/Date
  // must return the same values — verifying we use local getters, not toISOString.
  const local = new Date(2026, 6, 9); // local July 9, 2026
  assert.equal(localDateStr(local), '2026-07-09');

  // Also check padding: single-digit month and day.
  const padCheck = new Date(2026, 0, 5); // local Jan 5, 2026
  assert.equal(localDateStr(padCheck), '2026-01-05');

  // Verify against current time: localDateStr() should match local date getters.
  const now = new Date();
  const expected = [
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  assert.equal(localDateStr(now), expected, 'should match local date components');
});

// ── 4. API implementation — done endpoints ────────────────────────────────────

/**
 * Spin up a real HTTP server with an injected test DB.
 * Calls fn(baseUrl, db) then tears everything down.
 */
async function withApiServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-api-'));
  const dbPath = join(dir, 'test.db');
  const db = openDb(dbPath);
  runMigrations(db);
  setDb(db);

  const server = http.createServer(router);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base, db);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    setDb(null);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// POST /api/done is idempotent: two POSTs produce exactly one row, same logged_at.
test('POST /api/done: idempotent — two POSTs → one row, same logged_at', async () => {
  await withApiServer(async (base, db) => {
    const r1 = await fetch(`${base}/api/done`, { method: 'POST' });
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.done, true);
    assert.ok(typeof b1.date === 'string');
    assert.ok(typeof b1.logged_at === 'string');

    const r2 = await fetch(`${base}/api/done`, { method: 'POST' });
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.logged_at, b1.logged_at, 'second POST must not overwrite logged_at');

    const rows = db.prepare('SELECT * FROM sessions WHERE date = ?').all(b1.date);
    assert.equal(rows.length, 1, 'exactly one row after two POSTs');
  });
});

// GET /api/done/today round-trip: returns done:false before POST, done:true after.
test('GET /api/done/today: round-trip with POST', async () => {
  await withApiServer(async (base) => {
    const before = await fetch(`${base}/api/done/today`).then((r) => r.json());
    assert.equal(before.done, false);
    assert.ok(typeof before.date === 'string');

    await fetch(`${base}/api/done`, { method: 'POST' });

    const after = await fetch(`${base}/api/done/today`).then((r) => r.json());
    assert.equal(after.done, true);
    assert.equal(after.date, before.date, 'same date returned');
  });
});

// Auth is still enforced on POST /api/done: guest header → 403.
test('POST /api/done from guest identity → 403', async () => {
  await withApiServer(async (base) => {
    const res = await fetch(`${base}/api/done`, {
      method: 'POST',
      headers: { 'tailscale-user-login': 'guest@example.com' },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'Forbidden');
  });
});

// GET /api/stats → 200 JSON with expected shape (issue #18)
test('GET /api/stats → 200 with stats shape', async () => {
  await withApiServer(async (base) => {
    const res = await fetch(`${base}/api/stats`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('currentStreak' in body, 'has currentStreak');
    assert.ok('longestStreak' in body, 'has longestStreak');
    assert.ok('weekRate' in body && 'done' in body.weekRate && 'scheduled' in body.weekRate, 'has weekRate');
    assert.ok('monthRate' in body && 'done' in body.monthRate && 'scheduled' in body.monthRate, 'has monthRate');
    assert.ok(typeof body.currentStreak === 'number', 'currentStreak is number');
    assert.ok(typeof body.longestStreak === 'number', 'longestStreak is number');
  });
});

// ── 4. Static file serving (real HTTP, exercises async fs + dir index) ────────

/**
 * Boot the router over HTTP against a fixture dist dir, run `fn(baseUrl)`,
 * then tear everything down.
 */
async function withStaticServer(fn) {
  const dist = mkdtempSync(join(tmpdir(), 'fitness-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>root</title>');
  writeFileSync(join(dist, 'styles.css'), 'body{color:red}');
  mkdirSync(join(dist, 'roadmap'));
  writeFileSync(join(dist, 'roadmap', 'index.html'), '<!doctype html><title>roadmap</title>');

  const prev = process.env.SITE_DIST_DIR;
  process.env.SITE_DIST_DIR = dist;

  const server = http.createServer(router);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections?.(); // don't wait on fetch keep-alive sockets
    await new Promise((r) => server.close(r));
    if (prev === undefined) delete process.env.SITE_DIST_DIR;
    else process.env.SITE_DIST_DIR = prev;
    rmSync(dist, { recursive: true, force: true });
  }
}

test('static: GET / serves dist/index.html', async () => {
  await withStaticServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /root/);
  });
});

test('static: GET /roadmap/ serves the directory index (roadmap/index.html)', async () => {
  await withStaticServer(async (base) => {
    const res = await fetch(`${base}/roadmap/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /roadmap/);
  });
});

test('static: GET /roadmap (no trailing slash) also resolves the index', async () => {
  await withStaticServer(async (base) => {
    const res = await fetch(`${base}/roadmap`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /roadmap/);
  });
});

test('static: GET /styles.css serves CSS with the right content-type', async () => {
  await withStaticServer(async (base) => {
    const res = await fetch(`${base}/styles.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/css/);
  });
});

test('static: missing file → 404 JSON error shape', async () => {
  await withStaticServer(async (base) => {
    const res = await fetch(`${base}/does-not-exist.html`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Not Found');
  });
});

test('static: path traversal is rejected with 400', async () => {
  await withStaticServer(async (base) => {
    // %2e%2e%2f = ../ — decoded server-side, then blocked by the DIST guard.
    const res = await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    assert.equal(res.status, 400);
  });
});

// ── 5. GET /api/today (issue #27) ────────────────────────────────────────────

test('todayInfo: training day — isTrainingDay true, shape correct', () => {
  // Day-of-week 1 (Mon) is a training day per the default TRAINING_DAYS=[1,2,4,5].
  // We construct a date that falls on a Monday in local time.
  // 2026-07-06 is a Monday.
  const info = todayInfo('2026-07-06');
  assert.equal(typeof info.date, 'string', 'date is string');
  assert.equal(typeof info.dayName, 'string', 'dayName is string');
  assert.equal(typeof info.isTrainingDay, 'boolean', 'isTrainingDay is boolean');
  assert.equal(typeof info.done, 'boolean', 'done is boolean');
  // focus is string or null
  assert.ok(info.focus === null || typeof info.focus === 'string', 'focus is string|null');
  // Monday is a training day
  assert.equal(info.isTrainingDay, true, '2026-07-06 (Mon) is a training day');
  assert.equal(info.dayName, 'Mon');
});

test('todayInfo: rest day — isTrainingDay false', () => {
  // 2026-07-05 is a Sunday (day-of-week 0), not in [1,2,4,5].
  const info = todayInfo('2026-07-05');
  assert.equal(info.isTrainingDay, false, '2026-07-05 (Sun) is a rest day');
  assert.equal(info.dayName, 'Sun');
});

test('GET /api/today → 200 with expected shape', async () => {
  await withApiServer(async (base) => {
    const res = await fetch(`${base}/api/today`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('date' in body, 'has date');
    assert.ok('dayName' in body, 'has dayName');
    assert.ok('isTrainingDay' in body, 'has isTrainingDay');
    assert.ok('done' in body, 'has done');
    assert.ok('focus' in body, 'has focus');
    assert.equal(typeof body.date, 'string');
    assert.equal(typeof body.isTrainingDay, 'boolean');
    assert.equal(typeof body.done, 'boolean');
  });
});

// ── 6. POST /api/log (issue #27) ─────────────────────────────────────────────

test('POST /api/log with {raw} body → 200 with log id', async () => {
  await withApiServer(async (base, db) => {
    const res = await fetch(`${base}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: '3x5 pull-up @20kg', source: 'telegram' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.id === 'number', 'response has numeric id');
    assert.equal(body.exercise, 'raw', 'raw field maps to exercise=raw');
    assert.equal(body.source, 'telegram');

    // Verify the row is in the DB.
    const row = db.prepare('SELECT * FROM logs WHERE id = ?').get(body.id);
    assert.ok(row, 'row exists in DB');
    assert.equal(row.exercise, 'raw');
    assert.equal(row.source, 'telegram');
    const payload = JSON.parse(row.payload);
    assert.equal(payload.raw, '3x5 pull-up @20kg');
  });
});

test('POST /api/log with structured body → 200', async () => {
  await withApiServer(async (base, db) => {
    const res = await fetch(`${base}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: '2026-07-06',
        exercise: 'pull-up',
        payload: JSON.stringify({ sets: 3, reps: 5 }),
        source: 'web',
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.id === 'number');
    assert.equal(body.exercise, 'pull-up');
    assert.equal(body.source, 'web');
  });
});

test('POST /api/log with empty body → 200 (tolerant)', async () => {
  await withApiServer(async (base) => {
    const res = await fetch(`${base}/api/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body.id === 'number');
  });
});

test('POST /api/log: guest identity → 403 (auth enforced)', async () => {
  await withApiServer(async (base) => {
    const res = await fetch(`${base}/api/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'tailscale-user-login': 'guest@example.com',
      },
      body: JSON.stringify({ raw: 'hack attempt' }),
    });
    assert.equal(res.status, 403);
  });
});

// ── 7. Migration 003: audit table ────────────────────────────────────────────

test('migration 003: audit table exists with correct columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-audit-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes('audit'), 'audit table exists');

    const cols = db.prepare('PRAGMA table_info(audit)').all().map((c) => c.name);
    assert.ok(cols.includes('id'), 'id column');
    assert.ok(cols.includes('at'), 'at column');
    assert.ok(cols.includes('user_id'), 'user_id column');
    assert.ok(cols.includes('command'), 'command column');
    assert.ok(cols.includes('ok'), 'ok column');

    // Insert a row to verify the schema is functional.
    db.prepare('INSERT INTO audit (user_id, command, ok) VALUES (?, ?, ?)').run('42', '/today', 1);
    const row = db.prepare('SELECT * FROM audit WHERE user_id = ?').get('42');
    assert.equal(row.command, '/today');
    assert.equal(row.ok, 1);
    assert.ok(typeof row.at === 'string' && row.at.length > 0, 'at is auto-filled');

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
