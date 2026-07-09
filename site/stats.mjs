/**
 * stats.mjs — pure adherence-stats computation (no I/O).
 *
 * Exported for use by server.mjs (SSR + JSON endpoint) and by tests.
 *
 * @param {Array<{date: string, done: number|null}>} rows
 *   All rows from the `sessions` table, any order. `done` is 1 or falsy.
 *   Backfilled rows may have `logged_at = null` but `done = 1`.
 * @param {number[]} trainingDays
 *   Weekday indices where 0=Sun, 1=Mon … 6=Sat. E.g. [1,2,4,5].
 * @param {string} todayStr
 *   Local date as "YYYY-MM-DD" (from localDateStr()).
 * @param {{ windowDays?: number }} [opts]
 * @returns {{
 *   currentStreak: number,
 *   longestStreak: number,
 *   weekRate: { done: number, scheduled: number },
 *   monthRate: { done: number, scheduled: number },
 *   days: Array<{ date: string, state: 'trained'|'missed'|'upcoming'|'rest' }>
 * }}
 */
export function computeStats(rows, trainingDays, todayStr, { windowDays = 30 } = {}) {
  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Parse "YYYY-MM-DD" into a LOCAL Date object.
   * ⚠ new Date('YYYY-MM-DD') parses as UTC midnight — always use this helper.
   */
  function parseLocalDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** Format a local Date as "YYYY-MM-DD". */
  function fmtDate(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Add `n` days to a local Date, returning a new Date. */
  function addDays(dt, n) {
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + n);
  }

  const tdSet = new Set(trainingDays);

  // ── Build a lookup of done dates from all rows ─────────────────────────────
  // (used for both the 30-day window AND the all-time longest-streak query)
  const doneSet = new Set(rows.filter((r) => r.done).map((r) => r.date));

  // ── today ─────────────────────────────────────────────────────────────────
  const todayDt = parseLocalDate(todayStr);

  // ── 30-day window: build day-by-day states ────────────────────────────────
  const days = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const dt = addDays(todayDt, -i);
    const dateStr = fmtDate(dt);
    const isTraining = tdSet.has(dt.getDay());
    const isPast = i > 0;           // strictly before today
    const isToday = i === 0;

    let state;
    if (!isTraining) {
      state = 'rest';
    } else if (doneSet.has(dateStr)) {
      state = 'trained';
    } else if (isPast) {
      state = 'missed';
    } else {
      // today, scheduled, not yet done → "upcoming" (don't shame mid-day)
      state = 'upcoming';
    }
    days.push({ date: dateStr, state });
  }

  // ── currentStreak — walk back from today over scheduled days only ─────────
  // rest days are skipped over; today-not-done does NOT break the streak.
  let currentStreak = 0;
  {
    let dt = todayDt;
    while (true) {
      const dateStr = fmtDate(dt);
      const isTraining = tdSet.has(dt.getDay());

      if (isTraining) {
        const isTodayDate = dateStr === todayStr;
        if (doneSet.has(dateStr)) {
          currentStreak++;
        } else if (isTodayDate) {
          // today not-done: don't break streak, just skip
        } else {
          // past training day with no done → streak ends
          break;
        }
      }
      // move to the previous day
      dt = addDays(dt, -1);

      // Safety: don't go back further than all sessions rows
      // (stop if we've gone back more days than any possible data)
      const daysBack = Math.round((todayDt - dt) / 86400000);
      if (daysBack > 3650) break; // 10 years max
    }
  }

  // ── longestStreak — computed over ALL sessions rows (not just window) ──────
  // Walk ALL calendar days from earliest done date to today.
  let longestStreak = 0;
  {
    // Find the earliest known done date
    const sortedDone = [...doneSet].sort();
    if (sortedDone.length > 0) {
      let streak = 0;
      const startDt = parseLocalDate(sortedDone[0]);
      let dt = startDt;
      while (fmtDate(dt) <= todayStr) {
        const dateStr = fmtDate(dt);
        const isTraining = tdSet.has(dt.getDay());
        if (!isTraining) {
          // rest day — skip without breaking streak
        } else if (doneSet.has(dateStr)) {
          streak++;
          if (streak > longestStreak) longestStreak = streak;
        } else if (dateStr < todayStr) {
          // missed past training day → break
          streak = 0;
        } else {
          // today not-done → don't break
        }
        dt = addDays(dt, 1);
      }
    }
  }

  // ── weekRate — Mon-start current week, scheduled days ≤ today only ────────
  const weekRate = { done: 0, scheduled: 0 };
  {
    // Find Monday of the current week
    const dow = todayDt.getDay(); // 0=Sun
    const daysFromMon = (dow + 6) % 7; // Mon=0 … Sun=6
    const monDt = addDays(todayDt, -daysFromMon);
    for (let i = 0; i < 7; i++) {
      const dt = addDays(monDt, i);
      const dateStr = fmtDate(dt);
      if (dateStr > todayStr) break; // future day
      if (tdSet.has(dt.getDay())) {
        weekRate.scheduled++;
        if (doneSet.has(dateStr)) weekRate.done++;
      }
    }
  }

  // ── monthRate — calendar month to date ────────────────────────────────────
  const monthRate = { done: 0, scheduled: 0 };
  {
    const y = todayDt.getFullYear();
    const m = todayDt.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    let dt = firstOfMonth;
    while (fmtDate(dt) <= todayStr) {
      if (tdSet.has(dt.getDay())) {
        monthRate.scheduled++;
        if (doneSet.has(fmtDate(dt))) monthRate.done++;
      }
      dt = addDays(dt, 1);
    }
  }

  return { currentStreak, longestStreak, weekRate, monthRate, days };
}
