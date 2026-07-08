# Workout Site - Local Tailscale Serve

A tiny site that renders [`../PLAN.md`](../PLAN.md) into a clean, light page for the gym,
served by a small Node HTTP server (`server.mjs`) backed by SQLite. The rendered plan is
read-only: if the site and `PLAN.md` disagree, `PLAN.md` wins.

The canonical deploy is local-only:

```text
main changes on GitHub -> launchd service fetches origin/main -> fast-forward merge
  -> npm build (./dist) + node server.mjs on 127.0.0.1:3000
  -> Caddy reverse-proxies /fitness/* -> 127.0.0.1:3000 on localhost:8080
  -> Tailscale Serve exposes https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/
```

No Fly.io, GitHub Pages, or other hosted deployment is used.

For the multi-project path convention, threat model, and write-auth design, see
[`docs/infra/tailscale-serving.md`](../docs/infra/tailscale-serving.md).
Data-flow contract (SQLite ↔ tracking/ markdown, export, backfill): [`docs/architecture-data-flow.md`](../docs/architecture-data-flow.md).

## Server, database & API

`server.mjs` (default port `3000`, override with `SERVER_PORT`) does three things:

1. **Serves the static build** for `GET /fitness/*`, including directory indexes
   (`/fitness/roadmap/` -> `dist/roadmap/index.html`). Caddy strips the `/fitness`
   prefix, so the server sees `/`, `/styles.css`, `/api/...`.
2. **Owns `site/data/training.db`** (gitignored), a SQLite database managed with
   `better-sqlite3`.
3. **Exposes the `/fitness/api/*` namespace.** `POST /fitness/api/done`,
   `GET /fitness/api/done/today`, and `GET /fitness/api/stats` currently return `501`
   stubs — they are implemented by issues #17 / #18. The routing skeleton, write-auth
   middleware, and JSON error shape are live now.

### Write-auth

Mutating methods (`POST/PUT/PATCH/DELETE`) pass through an auth middleware
(the enforcement half of [#26](https://github.com/agentic-yankiz/fitness-planner/issues/26)):

- `Tailscale-User-Login == klein.shaked@gmail.com` -> allow (owner, header injected by
  the Tailscale proxy).
- No identity header **and** loopback `remote_addr` -> allow (local automation bypass,
  e.g. a future Telegram bot).
- Anything else -> `403`. Deny by default.

`GET`/`HEAD` are always open (read-only to any tailnet member). Full rationale:
[`docs/infra/tailscale-serving.md`](../docs/infra/tailscale-serving.md).

### Migrations

SQL migrations live in `migrations/NNN_name.sql` and are applied in order at server boot
(and via `npm run migrate`). A `schema_migrations` table records what has run, so boots
are idempotent. Migration `001_sessions.sql` creates the `sessions` table.

### Backups

`npm run backup` (also run nightly by `bin/local-sync-serve.sh`) writes a consistent
`VACUUM INTO` copy of the DB to `site/data/backups/` and keeps the newest 14.

```bash
npm run migrate   # apply pending migrations manually
npm run backup    # force a DB backup now
npm test          # migration idempotency, auth matrix, static serving, backups
```

## What It Shows

- day-by-day plan tables from `PLAN.md`
- current block/week from the newest `../tracking/week-YYYY-MM-DD.md`
- progress parsed from `../tracking/`
- footer stamp with the build commit and UTC build time

## Manual Local Run

```bash
cd site
npm install
npm run dev   # builds ./dist, starts server.mjs (:3000), runs Caddy (:8080)
```

Then open:

- local: `http://localhost:8080/fitness/`
- Tailscale, after serve is configured:
  `https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/`

To run just the app server (no Caddy) — e.g. to curl the API directly:

```bash
npm run build && npm start   # server on http://127.0.0.1:3000/
```

## Always-On Setup

Install the macOS LaunchAgent from the repo root:

```bash
cd site
npm run install:launchd
```

The service:

- starts on login and restarts if it exits
- builds the site immediately
- configures Tailscale Serve for `/fitness`
- checks `origin/main` every 60 seconds
- fast-forwards only when the local worktree is clean
- rebuilds after every successful update

Logs live in `~/Library/Logs/fitness-planner/`.

Useful commands:

```bash
launchctl print gui/$(id -u)/com.shaked.fitness-planner.site
tail -f ~/Library/Logs/fitness-planner/site-launchd.log
tail -f ~/Library/Logs/fitness-planner/site-launchd.err.log
```

## Requirements

- macOS launchd
- Node/npm
- Caddy (`brew install caddy`)
- Tailscale signed in on the laptop

The script also finds the macOS Tailscale app CLI at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` when `tailscale` is not on `PATH`.

## Current Week

The build reads the newest `../tracking/week-YYYY-MM-DD.md` whose first line declares
`Block N / Week M`. With no logs yet, it falls back to `config.json`.
