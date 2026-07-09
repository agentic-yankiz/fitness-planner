/**
 * Unit tests for computeStats() in stats.mjs.
 *
 * All tests use a fixed todayStr so results are deterministic.
 * trainingDays = [1, 2, 4, 5] (Mon/Tue/Thu/Fri).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeStats } from '../stats.mjs';

const TD = [1, 2, 4, 5]; // Mon=1, Tue=2, Thu=4, Fri=5

// Helper: build a done row object
const done = (date) => ({ date, done: 1 });
const notDone = (date) => ({ date, done: 0 });

// ── Empty rows ─────────────────────────────────────────────────────────────────

test('computeStats: empty rows → streaks zero, window has 30 days, weekRate.done=0', () => {
  // 2026-07-10 is a Friday. The current week (Mon–Fri) has Mon/Tue/Thu/Fri = 4 scheduled.
  // No rows → done=0 but scheduled=4, monthRate.scheduled=6 (Jul 2,3,6,7,9,10).
  const result = computeStats([], TD, '2026-07-10');
  assert.equal(result.currentStreak, 0);
  assert.equal(result.longestStreak, 0);
  assert.equal(result.weekRate.done, 0);
  assert.equal(result.weekRate.scheduled, 4, 'Mon+Tue+Thu+Fri = 4 scheduled in current week');
  assert.equal(result.monthRate.done, 0);
  assert.equal(result.days.length, 30);
});

// ── State classification ───────────────────────────────────────────────────────

test('computeStats: trained day shows state=trained', () => {
  // 2026-07-09 is a Thursday (trainingDay)
  const result = computeStats([done('2026-07-09')], TD, '2026-07-10');
  const day = result.days.find((d) => d.date === '2026-07-09');
  assert.ok(day, '2026-07-09 is in the window');
  assert.equal(day.state, 'trained');
});

test('computeStats: past scheduled day with no done → state=missed', () => {
  // 2026-07-07 is a Tuesday (trainingDay); today is 2026-07-10
  const result = computeStats([], TD, '2026-07-10');
  const day = result.days.find((d) => d.date === '2026-07-07');
  assert.ok(day, '2026-07-07 is in the window');
  assert.equal(day.state, 'missed');
});

test('computeStats: rest day → state=rest', () => {
  // 2026-07-08 is a Wednesday (not in trainingDays)
  const result = computeStats([], TD, '2026-07-10');
  const day = result.days.find((d) => d.date === '2026-07-08');
  assert.ok(day);
  assert.equal(day.state, 'rest');
});

test('computeStats: today scheduled, not yet done → state=upcoming (no mid-day shame)', () => {
  // 2026-07-10 is a Friday (trainingDay), today = '2026-07-10', no done row
  const result = computeStats([], TD, '2026-07-10');
  const today = result.days.find((d) => d.date === '2026-07-10');
  assert.ok(today);
  assert.equal(today.state, 'upcoming', 'today scheduled but not done → upcoming');
});

test('computeStats: today scheduled AND done → state=trained', () => {
  const result = computeStats([done('2026-07-10')], TD, '2026-07-10');
  const today = result.days.find((d) => d.date === '2026-07-10');
  assert.ok(today);
  assert.equal(today.state, 'trained');
});

// ── Streak: rest days are skipped over, never break ───────────────────────────

test('computeStats: streak counts across rest days (rest does not break streak)', () => {
  // Week: Mon Jul 6 (done), Tue Jul 7 (done), Wed Jul 8 (rest), Thu Jul 9 (done), Fri Jul 10 (today, done)
  // Today = Friday 2026-07-10. Streak should be 4 (Mon+Tue+Thu+Fri).
  const rows = [done('2026-07-06'), done('2026-07-07'), done('2026-07-09'), done('2026-07-10')];
  const result = computeStats(rows, TD, '2026-07-10');
  assert.equal(result.currentStreak, 4, 'rest day (Wed) should not break streak');
});

test('computeStats: today-not-done does not break current streak', () => {
  // Mon Jul 6 and Tue Jul 7 done; Thu Jul 10 is today (not done, training day).
  // Streak should be 2 (Mon+Tue); today skipped, not broken.
  // Wed Jul 8 = rest (skip), Thu Jul 9 = missed (breaks streak for days before today).
  // Actually Thu Jul 9 is past and missed → streak breaks at Jul 9. Streak = 0.
  // Let's use a simpler scenario: Mon+Tue done, today = Wed (rest day) — streak = 2
  // 2026-07-08 is Wednesday (rest). rows: Mon Jul 6 + Tue Jul 7 done.
  const rows = [done('2026-07-06'), done('2026-07-07')];
  const result = computeStats(rows, TD, '2026-07-08'); // today = Wed (rest day)
  // Walk back from Wed: Wed=rest(skip), Tue=done(+1), Mon=done(+1), Sun=rest(skip)...
  // then Fri Jul 3 = scheduled but no done → break. Streak = 2.
  assert.equal(result.currentStreak, 2);
});

test('computeStats: today is training day, not done — does not break streak from previous days', () => {
  // Training days: Mon/Tue/Thu/Fri. Today = Friday Jul 10, not done.
  // Previous done: Mon Jul 6, Tue Jul 7, Thu Jul 9.
  // Streak walk: Fri Jul 10 (today, not done — skip, don't break), Thu Jul 9 (done +1),
  // Wed (rest skip), Tue Jul 7 (done +1), Mon Jul 6 (done +1), Sun (rest skip),
  // Fri Jul 3 (no done → break). Streak = 3.
  const rows = [done('2026-07-06'), done('2026-07-07'), done('2026-07-09')];
  const result = computeStats(rows, TD, '2026-07-10');
  assert.equal(result.currentStreak, 3, 'today-not-done should not break streak');
});

// ── Longest streak ─────────────────────────────────────────────────────────────

test('computeStats: longestStreak over all rows, not just 30-day window', () => {
  // Simulate a 5-day streak 60 days ago (outside the 30-day window).
  // 2026-05-04 = Mon, 2026-05-05 = Tue, 2026-05-07 = Thu, 2026-05-08 = Fri, 2026-05-11 = Mon
  // Recent: Mon Jul 6 + Tue Jul 7 + Thu Jul 9 done; today = Thu Jul 9 (no future days to miss).
  const rows = [
    done('2026-05-04'), done('2026-05-05'), done('2026-05-07'), done('2026-05-08'), done('2026-05-11'),
    done('2026-07-06'), done('2026-07-07'), done('2026-07-09'),
  ];
  // today = 2026-07-09 (Thursday). currentStreak walks: Thu(done+1), Wed(rest,skip),
  // Tue(done+1), Mon(done+1), Sun(rest,skip), Fri Jul 3(no done→break) → streak=3
  const result = computeStats(rows, TD, '2026-07-09');
  assert.ok(result.longestStreak >= 5, `longestStreak should be ≥ 5, got ${result.longestStreak}`);
  assert.equal(result.currentStreak, 3, 'currentStreak = 3 (Mon+Tue+Thu this week)');
});

// ── weekRate ───────────────────────────────────────────────────────────────────

test('computeStats: weekRate counts Mon-start current week up to today only', () => {
  // Today = 2026-07-10 (Friday). Week Mon Jul 6 – Fri Jul 10.
  // Scheduled days ≤ today: Mon/Tue/Thu/Fri = 4 scheduled.
  // Done: Mon + Thu.
  const rows = [done('2026-07-06'), done('2026-07-09')];
  const result = computeStats(rows, TD, '2026-07-10');
  assert.equal(result.weekRate.scheduled, 4, '4 training days Mon-Fri');
  assert.equal(result.weekRate.done, 2, '2 done this week');
});

test('computeStats: weekRate does not include future days', () => {
  // Today = 2026-07-06 (Monday). Scheduled ≤ today = only Mon = 1 day.
  const rows = [];
  const result = computeStats(rows, TD, '2026-07-06');
  assert.equal(result.weekRate.scheduled, 1, 'only Monday counts');
});

// ── monthRate ─────────────────────────────────────────────────────────────────

test('computeStats: monthRate counts calendar month to today', () => {
  // Today = 2026-07-10 (Friday). Jul 1 = Wed, so from Jul 1 to Jul 10:
  // Training days: Mon 6, Tue 7, Thu 9, Fri 10 = 4 scheduled (Thu Jul 2 + other Thu/Fri…)
  // Let me enumerate: Jul 1=Wed(rest), 2=Thu(train), 3=Fri(train), 4=Sat(rest), 5=Sun(rest),
  // 6=Mon(train), 7=Tue(train), 8=Wed(rest), 9=Thu(train), 10=Fri(train) → 6 scheduled
  const rows = [done('2026-07-02'), done('2026-07-03'), done('2026-07-06')];
  const result = computeStats(rows, TD, '2026-07-10');
  assert.equal(result.monthRate.scheduled, 6, '6 training days Jul 1–10');
  assert.equal(result.monthRate.done, 3, '3 done this month');
});

// ── SSR endpoint ───────────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';

import { openDb, runMigrations } from '../migrate.mjs';
import { router, setDb } from '../server.mjs';

async function withApiServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-stats-test-'));
  const db = openDb(join(dir, 'test.db'));
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

test('GET /stats returns 200 HTML with summary stats', async () => {
  await withApiServer(async (base, db) => {
    // Seed a done row
    db.prepare("INSERT INTO sessions (date, done, logged_at) VALUES ('2026-07-06', 1, '2026-07-06T10:00:00.000Z')").run();
    const res = await fetch(`${base}/stats`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<!doctype html/i, 'is HTML');
    assert.match(html, /Adherence Stats/i, 'has page title');
    assert.match(html, /Current Streak/i, 'has currentStreak label');
    assert.match(html, /Longest Streak/i, 'has longestStreak label');
    assert.match(html, /This Week/i, 'has weekRate label');
    assert.match(html, /This Month/i, 'has monthRate label');
  });
});

test('GET /stats with empty DB shows empty-state message and no grid', async () => {
  await withApiServer(async (base) => {
    const res = await fetch(`${base}/stats`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /No sessions logged yet/i, 'empty state message present');
    // Grid should not be present (no cal-grid table)
    assert.doesNotMatch(html, /<table class="cal-grid"/, 'no calendar grid when empty');
  });
});

test('GET /stats with seeded rows contains calendar grid', async () => {
  await withApiServer(async (base, db) => {
    db.prepare("INSERT INTO sessions (date, done, logged_at) VALUES ('2026-07-09', 1, '2026-07-09T09:00:00.000Z')").run();
    const res = await fetch(`${base}/stats`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /cal-grid/, 'calendar grid rendered');
    assert.match(html, /cal-trained/, 'trained cell rendered');
  });
});
