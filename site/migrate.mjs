#!/usr/bin/env node
/**
 * Migration runner for site/data/training.db.
 *
 * - Applied automatically at server boot (imported by server.mjs).
 * - Run manually: npm run migrate  (or: node migrate.mjs)
 *
 * Migrations live in site/migrations/NNN_name.sql, applied in lexical order.
 * A schema_migrations table tracks which files have been applied so that
 * re-running is always safe (idempotent).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'training.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Open (or create) the SQLite database at dbPath.
 * Creates parent directories automatically.
 *
 * @param {string} [dbPath]
 * @returns {import('node:sqlite').DatabaseSync}
 */
export function openDb(dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new DatabaseSync(dbPath);
}

/**
 * Apply any pending migrations from site/migrations/ to the given db.
 * Safe to call multiple times — already-applied migrations are skipped.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function runMigrations(db) {
  // Ensure the tracking table exists.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue; // already applied — skip silently
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
    console.log(`[migrate] applied ${file}`);
  }
}

/**
 * Run fn inside a BEGIN/COMMIT transaction, rolling back on any throw.
 * (node:sqlite's DatabaseSync has no .transaction() helper like better-sqlite3.)
 *
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb();
  runMigrations(db);
  db.close();
  console.log('[migrate] done');
}
