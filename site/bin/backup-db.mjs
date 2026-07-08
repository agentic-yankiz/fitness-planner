#!/usr/bin/env node
/**
 * SQLite backup for site/data/training.db.
 *
 * - Run manually:  npm run backup   (or: node bin/backup-db.mjs)
 * - Run nightly by bin/local-sync-serve.sh (once per calendar day).
 *
 * Uses SQLite's `VACUUM INTO`, which writes a clean, fully-consistent
 * single-file copy of the live database (safe while the server holds it open).
 * Backups land in site/data/backups/ (gitignored); the newest KEEP are kept,
 * older ones are pruned.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'training.db');
const DEFAULT_BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 14;

const BACKUP_RE = /^training-.*\.db$/;

/**
 * Produce a timestamped backup of dbPath in backupDir and prune to `keep`.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath]     source database
 * @param {string} [opts.backupDir]  destination directory
 * @param {number} [opts.keep]       how many recent backups to retain
 * @returns {string} absolute path to the backup file just written
 */
export function backupDb({
  dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH,
  backupDir = DEFAULT_BACKUP_DIR,
  keep = KEEP,
} = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`no database to back up at ${dbPath}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  // Filesystem-safe ISO timestamp: 2026-07-07T12-30-00-000Z
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `training-${stamp}.db`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // VACUUM INTO fails if the target exists; the timestamp makes that unlikely,
    // but guard anyway for repeated same-instant runs in tests.
    if (fs.existsSync(dest)) fs.rmSync(dest);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  prune(backupDir, keep);
  return dest;
}

/** Delete all but the newest `keep` backups (lexical timestamp sort). */
function prune(backupDir, keep) {
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => BACKUP_RE.test(f))
    .sort(); // ISO timestamps sort chronologically
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(backupDir, f));
  }
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dest = backupDb();
  console.log(`[backup] wrote ${dest}`);
}
