/**
 * Tests for the SQLite backup helper.
 * Run with:  npm test  (or: node --test test/backup.test.mjs)
 *
 * Covers:
 *  1. A forced backup produces a restorable copy (DoD: "Forced backup run
 *     produces a restorable file").
 *  2. Pruning keeps only the newest N backups.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { openDb, runMigrations } from '../migrate.mjs';
import { backupDb } from '../bin/backup-db.mjs';

test('backup: produces a restorable copy of the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-backup-'));
  try {
    const dbPath = join(dir, 'training.db');
    const backupDir = join(dir, 'backups');

    // Seed a DB with a migration + a row.
    const db = openDb(dbPath);
    runMigrations(db);
    db.prepare('INSERT INTO sessions (date, done, logged_at) VALUES (?, 1, ?)').run(
      '2026-07-07',
      '2026-07-07T10:00:00Z',
    );
    db.close();

    const dest = backupDb({ dbPath, backupDir });

    // Reopen the backup and confirm the row survived.
    const restored = new DatabaseSync(dest, { readOnly: true });
    const row = restored.prepare('SELECT date, done FROM sessions WHERE date = ?').get('2026-07-07');
    restored.close();

    assert.ok(row, 'row exists in the backup');
    assert.equal(row.done, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup: prune keeps only the newest N files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-backup-'));
  try {
    const dbPath = join(dir, 'training.db');
    const backupDir = join(dir, 'backups');

    const db = openDb(dbPath);
    runMigrations(db);
    db.close();

    // First real backup creates the backups/ dir.
    backupDb({ dbPath, backupDir, keep: 100 });

    // Drop in 20 stale, older-timestamped files that pruning must remove.
    for (let i = 0; i < 20; i++) {
      const n = String(i).padStart(2, '0');
      writeFileSync(join(backupDir, `training-2020-01-01T00-00-${n}-000Z.db`), 'stale');
    }

    // A fresh backup with keep=3 should leave exactly 3 files total.
    backupDb({ dbPath, backupDir, keep: 3 });

    const files = readdirSync(backupDir).filter((f) => /^training-.*\.db$/.test(f));
    assert.equal(files.length, 3, 'exactly 3 backups retained');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
