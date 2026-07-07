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
import { writeAuth, router, sendJson } from '../server.mjs';

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
    const cols = db.pragma('table_info(sessions)').map((c) => c.name);
    assert.ok(cols.includes('date'), 'date column exists');
    assert.ok(cols.includes('done'), 'done column exists');
    assert.ok(cols.includes('logged_at'), 'logged_at column exists');

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration: running twice is idempotent — migration recorded exactly once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-migrate-'));
  try {
    const db = openDb(join(dir, 'test.db'));

    runMigrations(db); // first run
    runMigrations(db); // second run — must not throw or duplicate

    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM schema_migrations')
      .get();
    assert.equal(c, 1, 'exactly one migration row recorded after two runs');

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

// ── 3. API stub endpoint behavior ────────────────────────────────────────────

// POST /api/done from loopback (auth passes) → 501 stub
test('POST /api/done → 501 (stub, loopback bypass)', () => {
  const req = mockReq({ method: 'POST', url: '/api/done', remoteAddress: '127.0.0.1', headers: {} });
  const res = mockRes();
  router(req, res);
  assert.equal(res.statusCode, 501);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'Not Implemented');
});

// POST /api/done from non-owner non-loopback → 403 (auth blocks before 501)
test('POST /api/done from non-owner non-loopback → 403', () => {
  const req = mockReq({
    method: 'POST',
    url: '/api/done',
    remoteAddress: '10.0.0.5',
    headers: { 'tailscale-user-login': 'stranger@example.com' },
  });
  const res = mockRes();
  router(req, res);
  assert.equal(res.statusCode, 403);
});

// GET /api/done/today → 501 (no auth gate on GETs)
test('GET /api/done/today → 501 (stub)', () => {
  const req = mockReq({ method: 'GET', url: '/api/done/today', remoteAddress: '10.0.0.5', headers: {} });
  const res = mockRes();
  router(req, res);
  assert.equal(res.statusCode, 501);
});

// GET /api/stats → 501
test('GET /api/stats → 501 (stub)', () => {
  const req = mockReq({ method: 'GET', url: '/api/stats', remoteAddress: '10.0.0.5', headers: {} });
  const res = mockRes();
  router(req, res);
  assert.equal(res.statusCode, 501);
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
