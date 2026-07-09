# Telegram Bot — Runbook

**Status:** Implemented; awaiting activation credentials from Shaked.  
**Relates to:** [#27](https://github.com/agentic-yankiz/fitness-planner/issues/27)

---

## Overview

A Shaked-only Telegram bot that provides off-tailnet access to the fitness site.
Long-polling runs on the laptop; nothing is exposed to the internet.
The Telegram API is reached outbound only — your IP is never published.

Commands: `/today`, `/done`, `/week`, `/stats`, `/log <text>`

Every command (accepted or rejected) is written to the `audit` table in
`site/data/training.db`.  Unknown senders receive **no reply at all** — the bot
never acknowledges it exists to non-owners.

---

## Activation steps

### 1. Create a Telegram bot

1. Open Telegram and start a chat with **@BotFather**.
2. Send `/newbot` and follow the prompts.
3. Copy the token — it looks like `123456789:ABCdefGhijKlmNoPQRstUvWxYz`.

### 2. Find your Telegram user ID

1. Start a chat with **@userinfobot**.
2. It replies with your numeric user ID (e.g. `123456789`).

### 3. Create `site/.env`

Create this file on the machine that runs the fitness service.
**Never commit this file** — it is listed in `site/.gitignore`.

```
# site/.env  — NOT committed, never pushed to the repo
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhijKlmNoPQRstUvWxYz
TELEGRAM_OWNER_ID=123456789
```

The `local-sync-serve.sh` service will detect the file and start the bot
automatically on the next sync cycle (within 60 seconds), or on a full
service restart.

### 4. Verify

Send `/today` to your bot.  You should get a one-line reply like:

```
Mon 2026-07-06 — training day (Mon) — not done yet.
```

Check the log:

```
tail -f ~/Library/Logs/fitness-planner/telegram-bot.log
```

---

## How it works

`site/telegram/bot.mjs` long-polls `getUpdates` with a 25-second timeout
(plain `fetch`, zero new npm dependencies).  On each update:

1. If `from.id !== TELEGRAM_OWNER_ID` → write audit row (`ok=0`), **no reply**.
2. If `from.id === TELEGRAM_OWNER_ID` → route to the appropriate handler, write
   audit row (`ok=1`).

The fitness Node server runs on `127.0.0.1:3000` (loopback) and is reachable
from the bot without Tailscale because both processes run on the same machine.
This is the same loopback bypass used by other local automation (see
[tailscale-serving.md](tailscale-serving.md) §Trust model).

---

## Testing without a real bot

```bash
cd site
PATH="/opt/homebrew/bin:$PATH" npm test
```

The test suite stubs all `getUpdates` / `sendMessage` calls — the real Telegram
API is never contacted.  See `test/telegram.test.mjs` and the formatter unit
tests in `test/server.test.mjs`.

---

## Token revocation

If the token is compromised:

1. Open @BotFather → `/mybots` → select the bot → **API Token** → **Revoke current token**.
2. Update `site/.env` with the new token.
3. Restart the service: `launchctl kickstart -k gui/$(id -u)/fitness-planner.site` (macOS).

---

## Files

| File | Purpose |
|------|---------|
| `site/telegram/bot.mjs` | Bot implementation (long-poll loop + formatters) |
| `site/migrations/003_audit.sql` | Audit table schema |
| `site/.env` | Secrets (gitignored, not in repo) |
| `site/bin/local-sync-serve.sh` | Supervises the bot alongside node + caddy |
| `test/telegram.test.mjs` | Unit tests — formatters + allowlist logic |

---

## Localhost-bypass rationale

The bot calls the fitness API as `http://127.0.0.1:3000/api/*`.  Because the
server binds only to the loopback interface and the bot runs on the same host,
the `writeAuth` middleware allows these requests without a Tailscale identity
header (the "loopback automation bypass" path).  Full trust-model rationale:
[tailscale-serving.md](tailscale-serving.md).
