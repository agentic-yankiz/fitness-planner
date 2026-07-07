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
    // stub — issue #17
    return writeAuth(req, res, () => notImplemented(res));
  }

  if (url === '/api/done/today' && method === 'GET') {
    // stub — issue #17
    return notImplemented(res);
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

  const server = http.createServer(router);

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`fitness-site server listening on 127.0.0.1:${PORT}`);
  });

  // Graceful shutdown on SIGTERM/SIGINT (issued by local-sync-serve.sh trap).
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  }
}
