#!/usr/bin/env node
/**
 * export-tracking.mjs — flush unexported SQLite rows → tracking/ markdown files.
 *
 * Usage:  npm run export:tracking
 *         (or: node site/scripts/export-tracking.mjs)
 *
 * Contract (docs/architecture-data-flow.md):
 *   • SQLite is the runtime capture store; tracking/ markdown is the curated record.
 *   • This script bridges them: it reads unexported `logs` and `sessions` rows,
 *     appends/creates `tracking/week-YYYY-MM-DD.md` files in log-template.md shape,
 *     then marks those rows exported=1 inside a single transaction.
 *   • It only writes files and flips DB flags — it does NOT commit or open a PR.
 *     The calling agent reads the summary printed to stdout and handles git.
 *   • Idempotent on the DB side: rows already marked exported=1 are skipped.
 *     If the file already has content for a day, new entries are appended under it.
 *
 * Output format follows tracking/log-template.md — week files are keyed by the
 * Monday of the ISO week that contains the log date.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, runMigrations, withTransaction } from '../migrate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKING_DIR = path.join(__dirname, '..', '..', 'tracking');

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Return the Monday of the ISO week containing `dateStr` (YYYY-MM-DD).
 * Week files are named tracking/week-<monday>.md.
 * @param {string} dateStr
 * @returns {string} YYYY-MM-DD of the Monday
 */
function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Format a UTC ISO timestamp to local HH:MM for display.
 * @param {string|null} isoTs
 * @returns {string}
 */
function fmtTime(isoTs) {
  if (!isoTs) return '';
  const d = new Date(isoTs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Markdown helpers ──────────────────────────────────────────────────────────

/**
 * Build a markdown section for one log row.
 * @param {{ date: string, exercise: string, payload: string, source: string, created_at: string }} row
 * @returns {string}
 */
function logRowToMarkdown(row) {
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = { raw: row.payload };
  }

  const lines = [`### ${row.exercise}  <!-- logged ${row.date} via ${row.source} at ${fmtTime(row.created_at)} -->`];

  // Render well-known fields as a table row; fall back to JSON dump.
  if (payload.sets !== undefined || payload.reps !== undefined || payload.load !== undefined) {
    lines.push('');
    lines.push('| Sets | Reps | Load | RPE | Notes |');
    lines.push('|------|------|------|-----|-------|');
    lines.push(
      `| ${payload.sets ?? ''} | ${payload.reps ?? ''} | ${payload.load ?? ''} | ${payload.rpe ?? ''} | ${payload.notes ?? ''} |`,
    );
  } else {
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(payload, null, 2));
    lines.push('```');
  }

  return lines.join('\n');
}

/**
 * Build a markdown section for one session row.
 * @param {{ date: string, done: number, logged_at: string }} row
 * @returns {string}
 */
function sessionRowToMarkdown(row) {
  const status = row.done === 1 ? 'Done' : 'Not done';
  const ts = row.logged_at ? ` at ${fmtTime(row.logged_at)}` : '';
  return `### Session — ${row.date}  <!-- ${status}${ts} -->\n\n> **Trained:** ${row.done === 1 ? 'yes' : 'no'}`;
}

/**
 * Create (or open) the week file for the Monday given.
 * Returns the current file content (or a header stub if new).
 * @param {string} monday YYYY-MM-DD
 * @param {string} [trackingDirPath] override for the tracking directory
 * @returns {{ filePath: string, isNew: boolean, content: string }}
 */
function openWeekFile(monday, trackingDirPath = TRACKING_DIR) {
  fs.mkdirSync(trackingDirPath, { recursive: true });
  const filePath = path.join(trackingDirPath, `week-${monday}.md`);
  if (fs.existsSync(filePath)) {
    return { filePath, isNew: false, content: fs.readFileSync(filePath, 'utf8') };
  }
  // New file — stub header matching log-template.md shape.
  const content = `# Training Log — week of ${monday}\n\n`;
  return { filePath, isNew: true, content };
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function exportTracking({ dbPath, trackingDir: trackingDirOverride } = {}) {
  const resolvedTrackingDir = trackingDirOverride ?? TRACKING_DIR;
  const db = openDb(dbPath);
  runMigrations(db);

  // Fetch unexported rows — ordered so that within each week file, entries
  // appear chronologically.
  const unexportedLogs = db
    .prepare(
      'SELECT id, date, exercise, payload, source, created_at FROM logs WHERE exported = 0 ORDER BY date, created_at',
    )
    .all();

  const unexportedSessions = db
    .prepare(
      'SELECT date, done, logged_at FROM sessions WHERE exported = 0 ORDER BY date',
    )
    .all();

  if (unexportedLogs.length === 0 && unexportedSessions.length === 0) {
    console.log('[export] nothing to export — all rows are already flagged exported=1');
    db.close();
    return { filesWritten: [], logRowsExported: 0, sessionRowsExported: 0 };
  }

  // Group by week (Monday) so we open each file at most once.
  const weekMap = new Map(); // monday → { logs: [], sessions: [] }

  for (const row of unexportedLogs) {
    const monday = mondayOf(row.date);
    if (!weekMap.has(monday)) weekMap.set(monday, { logs: [], sessions: [] });
    weekMap.get(monday).logs.push(row);
  }
  for (const row of unexportedSessions) {
    const monday = mondayOf(row.date);
    if (!weekMap.has(monday)) weekMap.set(monday, { logs: [], sessions: [] });
    weekMap.get(monday).sessions.push(row);
  }

  const filesWritten = [];
  const logIds = unexportedLogs.map((r) => r.id);

  // All DB flag flips happen in a single transaction AFTER writing files
  // so that a mid-run crash leaves files written but rows unexported (safe to re-run).
  const markExportedLogs = db.prepare('UPDATE logs SET exported = 1 WHERE id = ?');
  const markExportedSession = db.prepare('UPDATE sessions SET exported = 1 WHERE date = ?');

  const flushAll = () => withTransaction(db, () => {
    for (const id of logIds) markExportedLogs.run(id);
    for (const row of unexportedSessions) markExportedSession.run(row.date);
  });

  // Write files first.
  for (const [monday, { logs, sessions }] of [...weekMap.entries()].sort()) {
    const { filePath, isNew, content } = openWeekFile(monday, resolvedTrackingDir);

    const newSections = [];
    for (const row of sessions) {
      newSections.push(sessionRowToMarkdown(row));
    }
    for (const row of logs) {
      newSections.push(logRowToMarkdown(row));
    }

    const appended = content.trimEnd() + '\n\n' + newSections.join('\n\n') + '\n';
    fs.writeFileSync(filePath, appended, 'utf8');
    filesWritten.push({ filePath, isNew, logsAdded: logs.length, sessionsAdded: sessions.length });
  }

  // Now flip the DB flags atomically.
  flushAll();

  db.close();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('[export] done.');
  console.log(`  log rows exported   : ${unexportedLogs.length}`);
  console.log(`  session rows exported: ${unexportedSessions.length}`);
  for (const { filePath, isNew, logsAdded, sessionsAdded } of filesWritten) {
    const rel = path.relative(process.cwd(), filePath);
    console.log(`  ${isNew ? 'created' : 'updated'} ${rel} (+${logsAdded} logs, +${sessionsAdded} sessions)`);
  }

  return {
    filesWritten,
    logRowsExported: unexportedLogs.length,
    sessionRowsExported: unexportedSessions.length,
  };
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  exportTracking().catch((err) => {
    console.error('[export] fatal:', err);
    process.exit(1);
  });
}
