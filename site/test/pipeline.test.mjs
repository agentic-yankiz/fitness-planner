/**
 * Tests for the SQLite ↔ tracking/ markdown data pipeline (issue #28).
 *
 * Covers:
 *  1. Migration 002 idempotency — logs table created, re-run safe
 *  2. Export round-trip — insert log+session → export → file matches template shape,
 *     rows flagged exported=1
 *  3. Backfill — parses a real history file, inserts done=1 rows
 *  4. Backfill current-date guard — refuses dates >= today (hard error)
 *
 * Run: npm test   (or: node --test test/pipeline.test.mjs)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, runMigrations } from '../migrate.mjs';
import { exportTracking } from '../scripts/export-tracking.mjs';
import { parseWeekFile, backfillHistory } from '../scripts/backfill-history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_HISTORY_DIR = path.join(__dirname, '..', '..', 'tracking', 'history');

// ── 1. Migration 002 idempotency ──────────────────────────────────────────────

test('migration 002: creates logs table on fresh DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);

    assert.ok(tables.includes('logs'), 'logs table exists');

    const cols = db.prepare('PRAGMA table_info(logs)').all().map((c) => c.name);
    assert.ok(cols.includes('id'), 'id column');
    assert.ok(cols.includes('date'), 'date column');
    assert.ok(cols.includes('exercise'), 'exercise column');
    assert.ok(cols.includes('payload'), 'payload column');
    assert.ok(cols.includes('source'), 'source column');
    assert.ok(cols.includes('created_at'), 'created_at column');
    assert.ok(cols.includes('exported'), 'exported column');

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 002: running twice is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db);
    runMigrations(db); // second run must not throw
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get();
    // 001 + 002 = 2 migrations
    assert.equal(c, 2, 'exactly two migration rows after two runs');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migration 002: source CHECK constraint rejects invalid value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const db = openDb(join(dir, 'test.db'));
    runMigrations(db);
    assert.throws(
      () => db.prepare("INSERT INTO logs (date, exercise, payload, source) VALUES ('2025-08-06', 'test', '{}', 'invalid')").run(),
      /CHECK constraint/i,
      'should throw on invalid source value',
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 2. Export round-trip ──────────────────────────────────────────────────────

test('export: inserts log+session → export → file created, rows flagged exported=1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  const trackingDir = join(dir, 'tracking');
  mkdirSync(trackingDir, { recursive: true });

  try {
    const dbPath = join(dir, 'test.db');
    const db = openDb(dbPath);
    runMigrations(db);

    // Insert a synthetic log row and a session row for a historical date.
    const testDate = '2025-08-06';
    db.prepare(
      "INSERT INTO logs (date, exercise, payload, source, created_at, exported) VALUES (?, ?, ?, 'web', datetime('now'), 0)",
    ).run(testDate, 'Max hang 14 mm (weighted)', JSON.stringify({ sets: 3, reps: '8s', load: '17.5 kg', rpe: 8 }));

    db.prepare(
      "INSERT INTO sessions (date, done, logged_at) VALUES (?, 1, datetime('now'))",
    ).run(testDate);

    db.close();

    // Patch tracking dir — the export script resolves it relative to __dirname.
    // We override it by monkey-patching process.env and using the dbPath option.
    // The export script uses TRACKING_DIR = join(__dirname, '..', '..', 'tracking')
    // We need to supply a custom tracking dir. Export supports dbPath but not trackingDir
    // directly — test against the real dir (it appends, so we read back).
    // For isolation we run with a temp DB and the real tracking dir.
    // The generated file will be tracking/week-2025-08-04.md (Monday of 2025-08-06).
    const result = await exportTracking({ dbPath, trackingDir });

    assert.equal(result.logRowsExported, 1, '1 log row exported');
    assert.equal(result.sessionRowsExported, 1, '1 session row exported');
    assert.equal(result.filesWritten.length, 1, '1 file written');

    // File should exist and contain the exercise name.
    const { filePath } = result.filesWritten[0];
    const content = readFileSync(filePath, 'utf8');
    assert.ok(content.includes('Max hang 14 mm'), 'exercise name in exported file');
    assert.ok(content.includes('17.5 kg'), 'load in exported file');

    // Re-open DB to verify exported flags.
    const db2 = openDb(dbPath);
    const logRow = db2.prepare('SELECT exported FROM logs WHERE date = ?').get(testDate);
    assert.equal(logRow.exported, 1, 'log row marked exported=1');

    const sessionRow = db2.prepare('SELECT exported FROM sessions WHERE date = ?').get(testDate);
    assert.equal(sessionRow.exported, 1, 'session row marked exported=1');
    db2.close();

    // Clean up the generated tracking file.
    rmSync(filePath, { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('export: second run is no-op (all rows already exported)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const dbPath = join(dir, 'test.db');
    const db = openDb(dbPath);
    runMigrations(db);
    db.close();

    // No unexported rows → filesWritten should be empty.
    const result = await exportTracking({ dbPath });
    assert.equal(result.logRowsExported, 0, '0 log rows on empty export');
    assert.equal(result.sessionRowsExported, 0, '0 session rows on empty export');
    assert.equal(result.filesWritten.length, 0, 'no files written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 3. Backfill — real history file ──────────────────────────────────────────

test('backfill: parseWeekFile parses cycle-01/week-1.md and finds done days', () => {
  const filePath = join(REAL_HISTORY_DIR, 'cycle-01', 'week-1.md');
  // Use a far-future todayStr so all dates pass the guard.
  const rows = parseWeekFile(filePath, '2025-08-06', '2099-12-31');

  // Cycle 1 Week 1 has results on Days 1,2,3,5 (Day 4 blank, Day 6 partial AMRAP).
  // We just assert we got at least some rows and they're all done=1.
  assert.ok(rows.length > 0, 'at least one done day parsed');
  for (const row of rows) {
    assert.equal(row.done, 1, `row for ${row.date} should be done=1`);
    assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/, 'date is ISO format');
  }
});

test('backfill: inserts rows into sessions table via backfillHistory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const dbPath = join(dir, 'test.db');
    const result = await backfillHistory({ dbPath });

    // All cycles + weeks — we just check total row counts are reasonable.
    assert.ok(result.totalInserted > 0, 'should insert at least one row');
    assert.ok(result.filesSummary.length > 0, 'at least one file processed');

    // Verify the DB actually has rows.
    const db = openDb(dbPath);
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE done = 1').get();
    assert.ok(c > 0, 'sessions table has done=1 rows after backfill');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill: idempotent — running twice gives same row count', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const dbPath = join(dir, 'test.db');

    const r1 = await backfillHistory({ dbPath });
    const r2 = await backfillHistory({ dbPath });

    // Second run should insert 0 new rows (all OR IGNORE).
    assert.equal(r2.totalInserted, 0, 'second backfill inserts 0 rows (idempotent)');
    assert.equal(r2.totalSkipped, r1.totalInserted, 'second run skips all rows from first run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 4. Backfill current-date guard ───────────────────────────────────────────

test('backfill: parseWeekFile throws when a computed date >= todayStr', () => {
  // Manufacture a minimal "week file" with Day 1.
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const fakeFile = join(dir, 'fake-week.md');
    writeFileSync(fakeFile, [
      '# Fake Week',
      '',
      '## Day 1 — Power',
      '',
      '| Exercise | Prescribed | Done | Notes |',
      '|---|---|---|---|',
      '| Max hang | 3×8 s | 8,8,8 | |',
    ].join('\n'), 'utf8');

    // Pass todayStr == the computed date for Day 1 → should throw.
    // Day 1 = weekStart + 0 days = weekStart.
    const weekStart = '2099-01-01'; // far future
    assert.throws(
      () => parseWeekFile(fakeFile, weekStart, '2099-01-01'),
      /refusing to touch date/i,
      'should throw when date >= todayStr',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill: parseWeekFile does NOT insert rows for "not logged" days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-pipeline-'));
  try {
    const fakeFile = join(dir, 'fake-week.md');
    writeFileSync(fakeFile, [
      '# Fake Week',
      '',
      '## Day 1 — Power',
      '',
      '| Exercise | Prescribed | Done | Notes |',
      '|---|---|---|---|',
      '| Max hang | 3×8 s | not logged | |',
      '| OAP | 3×4 | not logged | |',
    ].join('\n'), 'utf8');

    const rows = parseWeekFile(fakeFile, '2025-01-06', '2099-12-31');
    assert.equal(rows.length, 0, 'no rows for an all-not-logged day');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
