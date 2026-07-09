#!/usr/bin/env node
/**
 * Shaked-only Telegram bot — long-poll getUpdates via plain fetch (zero new deps).
 *
 * Env vars (from site/.env — never committed):
 *   TELEGRAM_BOT_TOKEN  — token from @BotFather
 *   TELEGRAM_OWNER_ID   — numeric user ID (get from @userinfobot)
 *   FITNESS_API         — base URL of the node server (default: http://127.0.0.1:3000)
 *
 * Commands:
 *   /today  — GET /api/today, compact format + tailnet link
 *   /done   — POST /api/done, reply with streak from /api/stats
 *   /week   — training days summary + link
 *   /stats  — GET /api/stats formatted
 *   /log    — POST /api/log {raw: <text>} source='telegram'
 *
 * Security:
 *   - Any message from a sender whose id !== OWNER_ID gets NO reply and an
 *     audit row (ok=0).  The bot never reveals it exists to non-owners.
 *   - Every accepted command gets an audit row (ok=1).
 *
 * Pure formatters (formatToday, formatStats, formatDone, formatWeek) are
 * exported for unit testing — they depend on no I/O.
 */

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN ?? '';
const OWNER_ID   = String(process.env.TELEGRAM_OWNER_ID ?? '');
const FITNESS_API = (process.env.FITNESS_API ?? 'http://127.0.0.1:3000').replace(/\/$/, '');

// ── Formatters (pure — no I/O; exported for tests) ───────────────────────────

/**
 * Compact one-line representation of /api/today.
 * @param {{ date: string, dayName: string, isTrainingDay: boolean, done: boolean, focus: string|null }} json
 * @param {string} [tailnetLink]
 * @returns {string}
 */
export function formatToday(json, tailnetLink = '') {
  const { date, dayName, isTrainingDay, done, focus } = json;
  if (!isTrainingDay) {
    return `${dayName} ${date} — rest day. Recover well.`;
  }
  const focusLabel = focus ? ` (${focus})` : '';
  const doneLabel = done ? ' — already done' : ' — not done yet';
  const link = tailnetLink ? `\n${tailnetLink}` : '';
  return `${dayName} ${date} — training day${focusLabel}${doneLabel}.${link}`;
}

/**
 * One-line summary after a /done command.
 * @param {{ date: string, done: boolean, logged_at: string }} doneJson
 * @param {{ currentStreak: number, longestStreak: number }} statsJson
 * @returns {string}
 */
export function formatDone(doneJson, statsJson) {
  const streak = statsJson?.currentStreak ?? 0;
  return `Marked ${doneJson.date} as done. Streak: ${streak} day${streak === 1 ? '' : 's'}.`;
}

/**
 * Multi-line stats summary.
 * @param {{ currentStreak: number, longestStreak: number, weekRate: {done:number,scheduled:number}, monthRate: {done:number,scheduled:number} }} json
 * @returns {string}
 */
export function formatStats(json) {
  const { currentStreak, longestStreak, weekRate, monthRate } = json;
  const weekPct = weekRate.scheduled
    ? Math.round((weekRate.done / weekRate.scheduled) * 100)
    : null;
  const monthPct = monthRate.scheduled
    ? Math.round((monthRate.done / monthRate.scheduled) * 100)
    : null;
  const fmtRate = ({ done, scheduled }, pct) =>
    scheduled ? `${done}/${scheduled}${pct !== null ? ` (${pct}%)` : ''}` : '—';
  return [
    `Current streak: ${currentStreak} day${currentStreak === 1 ? '' : 's'}`,
    `Longest streak: ${longestStreak} day${longestStreak === 1 ? '' : 's'}`,
    `This week:  ${fmtRate(weekRate, weekPct)}`,
    `This month: ${fmtRate(monthRate, monthPct)}`,
  ].join('\n');
}

/**
 * Week summary — list of training days with their focus labels.
 * @param {number[]} trainingDays  - 0=Sun … 6=Sat day-of-week indices
 * @param {{ [dow: string]: string }} trainingDayKeywords - focus per dow
 * @param {string} [tailnetLink]
 * @returns {string}
 */
export function formatWeek(trainingDays, trainingDayKeywords, tailnetLink = '') {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const lines = trainingDays.map((dow) => {
    const focus = trainingDayKeywords?.[String(dow)] ?? '';
    return `${dayNames[dow]}${focus ? ` — ${focus}` : ''}`;
  });
  const link = tailnetLink ? `\n${tailnetLink}` : '';
  return `Training days this week:\n${lines.join('\n')}${link}`;
}

// ── Telegram API helpers ──────────────────────────────────────────────────────

/**
 * Call the Telegram Bot API.
 * @param {string} method
 * @param {object} params
 * @returns {Promise<object>}
 */
async function tgCall(method, params) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000),
  });
  return res.json();
}

/**
 * Long-poll getUpdates with a 25s timeout (leaves headroom under the 30s fetch timeout).
 * @param {number} offset
 * @returns {Promise<object[]>}
 */
async function getUpdates(offset) {
  try {
    const data = await tgCall('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
    return Array.isArray(data?.result) ? data.result : [];
  } catch {
    return []; // network hiccup — retry next iteration
  }
}

/** Send a text message to the owner. */
async function sendMessage(chatId, text) {
  await tgCall('sendMessage', { chat_id: chatId, text });
}

// ── Fitness API helpers ───────────────────────────────────────────────────────

async function apiGet(path) {
  const res = await fetch(`${FITNESS_API}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`api GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${FITNESS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`api POST ${path} → ${res.status}`);
  return res.json();
}

// ── Audit ─────────────────────────────────────────────────────────────────────

/**
 * Write an audit row via the fitness API's DB.
 * This is fire-and-forget; a failed audit must never crash the bot.
 *
 * We use a lightweight in-process approach: import migrate/open only if the
 * module is available (test harness may mock this path).
 */
let _auditDb = null;

async function loadAuditDb() {
  if (_auditDb) return _auditDb;
  try {
    const { openDb, runMigrations } = await import('../migrate.mjs');
    const db = openDb();
    runMigrations(db);
    _auditDb = db;
  } catch {
    _auditDb = null;
  }
  return _auditDb;
}

async function auditRow(userId, command, ok) {
  try {
    const db = await loadAuditDb();
    if (!db) return;
    db.prepare('INSERT INTO audit (user_id, command, ok) VALUES (?, ?, ?)').run(
      String(userId), command, ok ? 1 : 0,
    );
  } catch { /* audit failures must never propagate */ }
}

// ── Command handlers ──────────────────────────────────────────────────────────

/**
 * Route a text command from the owner and send the reply.
 * @param {string} chatId
 * @param {string} text  - raw message text e.g. "/today" or "/log 3x5 pull-up"
 */
async function handleOwnerCommand(chatId, text) {
  const trimmed = text.trim();
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const command = (cmd ?? '').toLowerCase();

  // Config is read lazily for /week.
  async function loadConfig() {
    const { default: fs } = await import('node:fs');
    const { default: path } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    try {
      const raw = fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8');
      return JSON.parse(raw);
    } catch { return {}; }
  }

  if (command === '/today') {
    const json = await apiGet('/api/today');
    await sendMessage(chatId, formatToday(json));
    return;
  }

  if (command === '/done') {
    const doneJson = await apiPost('/api/done', {});
    const statsJson = await apiGet('/api/stats').catch(() => ({ currentStreak: 0 }));
    await sendMessage(chatId, formatDone(doneJson, statsJson));
    return;
  }

  if (command === '/stats') {
    const json = await apiGet('/api/stats');
    await sendMessage(chatId, formatStats(json));
    return;
  }

  if (command === '/week') {
    const cfg = await loadConfig();
    const trainingDays = Array.isArray(cfg.trainingDays) ? cfg.trainingDays : [1, 2, 4, 5];
    const keywords = cfg.trainingDayKeywords ?? {};
    await sendMessage(chatId, formatWeek(trainingDays, keywords));
    return;
  }

  if (command === '/log') {
    const raw = rest.join(' ').trim();
    if (!raw) {
      await sendMessage(chatId, 'Usage: /log <description>\nExample: /log 3x5 pull-up @20kg');
      return;
    }
    const logJson = await apiPost('/api/log', { raw, source: 'telegram' });
    await sendMessage(chatId, `Logged (id ${logJson.id}): ${raw}`);
    return;
  }

  // Unknown command — reply with help.
  await sendMessage(chatId, '/today /done /week /stats /log <text>');
}

// ── Bot loop ──────────────────────────────────────────────────────────────────

/**
 * Main long-poll loop. Call start_bot() from local-sync-serve.sh supervision.
 * Exported so tests can import the formatters without starting the loop.
 */
export async function runBot() {
  if (!BOT_TOKEN) {
    console.error('[telegram-bot] TELEGRAM_BOT_TOKEN is not set — aborting');
    process.exit(1);
  }
  if (!OWNER_ID) {
    console.error('[telegram-bot] TELEGRAM_OWNER_ID is not set — aborting');
    process.exit(1);
  }

  console.log('[telegram-bot] starting long-poll loop');

  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const updates = await getUpdates(offset);

    for (const update of updates) {
      offset = update.update_id + 1;

      const msg = update.message;
      if (!msg?.text) continue;

      const senderId = String(msg.from?.id ?? '');
      const chatId = msg.chat?.id;
      const text = msg.text ?? '';

      if (senderId !== OWNER_ID) {
        // Unknown sender — audit and ignore; never send a reply.
        await auditRow(senderId, text.split(' ')[0] ?? 'unknown', false);
        continue;
      }

      // Owner — handle and audit.
      const command = text.trim().split(/\s+/)[0] ?? 'unknown';
      try {
        await handleOwnerCommand(String(chatId), text);
        await auditRow(senderId, command, true);
      } catch (err) {
        console.error('[telegram-bot] error handling command:', err);
        await auditRow(senderId, command, false);
        try { await sendMessage(String(chatId), 'Error — check the server logs.'); } catch { /* ignore */ }
      }
    }

    // Brief pause to avoid hammering the API if getUpdates returns immediately.
    if (updates.length === 0) {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  runBot().catch((err) => {
    console.error('[telegram-bot] fatal:', err);
    process.exit(1);
  });
}
