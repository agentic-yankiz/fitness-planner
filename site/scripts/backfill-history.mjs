#!/usr/bin/env node
/**
 * backfill-history.mjs — parse tracking/history/cycle-N/week-N.md → sessions rows.
 *
 * Usage:  npm run backfill:history
 *         (or: node site/scripts/backfill-history.mjs)
 *
 * Contract (docs/architecture-data-flow.md):
 *   • Backfill is one-way and historical only. It NEVER touches any date >= today.
 *   • A day with logged exercise results → INSERT OR IGNORE (date, done=1).
 *   • A day marked SKIPPED / "not logged" / entirely blank → NO row inserted.
 *   • Idempotent: INSERT OR IGNORE means re-running is always safe.
 *   • Does NOT set exported=1 on sessions; these historical rows are source-of-truth
 *     from markdown — there is nothing to "export back" from them.
 *
 * Date assignment (from tracking/history/README.md):
 *   Cycle 1:  Week 1 starts 2025-08-06, each week adds 7 days.
 *             Days 1-6 within a week map to Wed-Mon (the spreadsheet numbering).
 *             Approximate only — the README says exact day-of-week is unknown.
 *   Cycle 2:  Week 1 starts 2025-09-10.
 *
 *   We assign Day N → startDate + (N-1) days, which gives a unique ISO date
 *   per day within each week. The absolute date is approximate but stable and
 *   guaranteed historical (both cycles end well before 2026).
 *
 * Safety rule: any computed date >= localDateStr() is rejected with a hard error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, runMigrations, withTransaction } from '../migrate.mjs';
import { localDateStr } from '../server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.join(__dirname, '..', '..', 'tracking', 'history');

// ── Cycle / week date mapping ─────────────────────────────────────────────────

/**
 * Start dates for each cycle/week slot.
 * Day 1 of the week = startDate, Day 2 = startDate + 1 day, etc.
 *
 * Source: tracking/history/README.md date mapping table.
 */
const WEEK_STARTS = [
  // cycle 1
  { cycle: 1, week: 'week-1',     start: '2025-08-06' },
  { cycle: 1, week: 'week-2',     start: '2025-08-13' },
  { cycle: 1, week: 'week-3',     start: '2025-08-20' },
  { cycle: 1, week: 'week-4',     start: '2025-08-27' },
  { cycle: 1, week: 'week-deload',start: '2025-09-03' },
  // cycle 2
  { cycle: 2, week: 'week-1',     start: '2025-09-10' },
  { cycle: 2, week: 'week-2',     start: '2025-09-17' },
  { cycle: 2, week: 'week-3',     start: '2025-09-24' },
  { cycle: 2, week: 'week-4',     start: '2025-10-01' },
  { cycle: 2, week: 'week-deload',start: '2025-10-08' },
];

/**
 * Add `days` calendar days to a YYYY-MM-DD string.
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Markdown parser ───────────────────────────────────────────────────────────

/**
 * Determine whether a Day section has actual logged results (done=1) vs. entirely
 * blank / skipped / "not logged" (should not insert any row).
 *
 * Logic:
 *  1. Extract the ## Day N heading and the content until the next ## heading (or EOF).
 *  2. Look at table rows — if any "Done" cell has non-empty content that is not
 *     "not logged", "SKIPPED", "—", or blank, the day has results → done=1.
 *  3. A note block saying "entirely Day N results blank" → skip (no row).
 *
 * @param {string} daySection  raw markdown text of the Day section
 * @returns {{ hasResults: boolean }}
 */
function parseDaySection(daySection) {
  // Blank / skipped flags in the "Done" column.
  const SKIPPED_PATTERNS = [
    /^not logged$/i,
    /^skipped$/i,
    /^—$/,
    /^-$/,
    /^\s*$/,
  ];

  // Extract "Done" column values from pipe-table rows.
  // Table format: | Exercise | Prescribed | Done | ... |
  // We look at the 3rd pipe-delimited cell.
  const rows = daySection.split('\n').filter((l) => l.startsWith('|') && !l.match(/^\|-/));

  // Identify the "Done" column index from the header row.
  let doneColIdx = -1;
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    // cells[0] is empty (before first |), cells[1] is first column, etc.
    const headerIdx = cells.findIndex((c) => /^done$/i.test(c));
    if (headerIdx !== -1) {
      doneColIdx = headerIdx;
      break;
    }
  }

  if (doneColIdx === -1) {
    // No table header found — treat as no results (e.g. deload with prescription only).
    return { hasResults: false };
  }

  // Check each data row (skip header and separator).
  let foundResult = false;
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length <= doneColIdx) continue;
    const doneCell = cells[doneColIdx];
    if (!doneCell) continue;

    // Skip header row values.
    if (/^done$/i.test(doneCell)) continue;

    // If this cell has content that is not a skipped pattern → done=1.
    const isSkipped = SKIPPED_PATTERNS.some((p) => p.test(doneCell));
    if (!isSkipped) {
      foundResult = true;
      break;
    }
  }

  return { hasResults: foundResult };
}

/**
 * Parse a history week file and return a list of { date, done } rows to insert.
 * Only days with actual results get a row. Skipped days get nothing.
 *
 * @param {string} filePath  absolute path to the week-N.md file
 * @param {string} weekStart  YYYY-MM-DD start of the week
 * @param {string} todayStr   current local date (YYYY-MM-DD) — guard boundary
 * @returns {{ date: string, done: number }[]}
 */
export function parseWeekFile(filePath, weekStart, todayStr) {
  const raw = fs.readFileSync(filePath, 'utf8');

  // Split into Day sections on "## Day N" headings.
  // Also handle "## Day N — Description" variants.
  const dayRegex = /^## Day (\d+)/gm;
  const sections = [];

  let match;
  const matches = [];
  while ((match = dayRegex.exec(raw)) !== null) {
    matches.push({ dayNum: parseInt(match[1], 10), index: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    sections.push({ dayNum: matches[i].dayNum, text: raw.slice(start, end) });
  }

  const rows = [];
  for (const { dayNum, text } of sections) {
    const date = addDays(weekStart, dayNum - 1);

    // Safety: never touch current or future dates.
    if (date >= todayStr) {
      throw new Error(
        `backfill-history: refusing to touch date ${date} (>= today ${todayStr}). ` +
          `This indicates a misconfigured date mapping in WEEK_STARTS.`,
      );
    }

    const { hasResults } = parseDaySection(text);
    if (hasResults) {
      rows.push({ date, done: 1 });
    }
    // Skipped days → no row at all (per contract: INSERT OR IGNORE protects /api/done).
  }

  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function backfillHistory({ dbPath } = {}) {
  const todayStr = localDateStr();

  const db = openDb(dbPath);
  runMigrations(db);

  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO sessions (date, done, logged_at) VALUES (?, ?, ?)',
  );

  let totalInserted = 0;
  let totalSkipped = 0;
  const filesSummary = [];

  for (const { cycle, week, start } of WEEK_STARTS) {
    const cycleDir = `cycle-0${cycle}`;
    const filePath = path.join(HISTORY_DIR, cycleDir, `${week}.md`);

    if (!fs.existsSync(filePath)) {
      console.warn(`[backfill] warning: file not found — ${filePath}`);
      continue;
    }

    let rows;
    try {
      rows = parseWeekFile(filePath, start, todayStr);
    } catch (err) {
      console.error(`[backfill] error parsing ${filePath}: ${err.message}`);
      throw err;
    }

    // Insert all rows for this file in a transaction for atomicity.
    const insertBatch = (batchRows) => withTransaction(db, () => {
      let inserted = 0;
      let skipped = 0;
      for (const { date, done } of batchRows) {
        const info = insertStmt.run(date, done, null); // logged_at=null for historical
        if (info.changes > 0) inserted++;
        else skipped++;
      }
      return { inserted, skipped };
    });

    const { inserted, skipped } = insertBatch(rows);
    totalInserted += inserted;
    totalSkipped += skipped;

    filesSummary.push({
      file: path.relative(process.cwd(), filePath),
      daysWithResults: rows.length,
      inserted,
      skipped,
    });
  }

  db.close();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('[backfill] done.');
  console.log(`  rows inserted : ${totalInserted}`);
  console.log(`  rows skipped (already present) : ${totalSkipped}`);
  console.log('  per-file breakdown:');
  for (const { file, daysWithResults, inserted, skipped } of filesSummary) {
    console.log(`    ${file}: ${daysWithResults} days with results → inserted ${inserted}, skipped ${skipped}`);
  }

  return { totalInserted, totalSkipped, filesSummary };
}

// ── CLI entry-point ───────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  backfillHistory().catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
}
