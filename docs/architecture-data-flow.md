# Architecture: Data Flow Contract

> **Summary:** Markdown owns the curated training record; SQLite owns runtime capture.
> They connect through two one-way bridges: `export-tracking` (SQLite → markdown) and
> `backfill-history` (markdown → SQLite). Neither bridge self-merges — all changes to
> tracked files land in `tracking/` via agent-created PRs reviewed before merge.

---

## Layers

```
┌───────────────────────────────────────────────────────────┐
│  PLAN.md + tracking/week-*.md + tracking/history/         │
│  Source of truth for the curated training record.         │
│  Always wins in any conflict. Human-readable.             │
└───────────┬───────────────────────────────┬───────────────┘
            │ backfill-history.mjs           │ export-tracking.mjs
            │ (one-time import, idempotent)  │ (ongoing export, append-only)
            ▼                               ▲
┌───────────────────────────────────────────────────────────┐
│  site/data/training.db  (SQLite, gitignored)              │
│  Runtime capture: sessions (done button), logs (exercises)│
│  Transient — can be rebuilt from markdown backfill.       │
└───────────────────────────────────────────────────────────┘
            ▲
            │  POST /api/done  ·  (future) POST /api/log
            │
         Web UI / Telegram bot / local automation
```

---

## Tables

### `sessions` (migration 001)

| Column     | Type    | Notes                                           |
|------------|---------|-------------------------------------------------|
| date       | TEXT PK | ISO date: `2026-07-09`                         |
| done       | INTEGER | `1` = trained, `0` = not done                  |
| logged_at  | TEXT    | ISO timestamp of last update (NULL for history) |
| exported   | INTEGER | `0` = pending, `1` = flushed to tracking/      |

Written by `POST /api/done` (INSERT OR IGNORE — idempotent, preserves first timestamp).
Backfilled from history markdown (INSERT OR IGNORE, done=1, logged_at=NULL).

### `logs` (migration 002)

| Column     | Type    | Notes                                           |
|------------|---------|-------------------------------------------------|
| id         | INTEGER | Auto PK                                         |
| date       | TEXT    | ISO date                                        |
| exercise   | TEXT    | Exercise name                                   |
| payload    | TEXT    | JSON blob: sets, reps, load, rpe, notes, …     |
| source     | TEXT    | `'web'` or `'telegram'`                         |
| created_at | TEXT    | ISO timestamp (DEFAULT datetime('now'))         |
| exported   | INTEGER | `0` = pending, `1` = flushed to tracking/      |

---

## Bridges

### `site/scripts/backfill-history.mjs`  (`npm run backfill:history`)

- **Direction:** tracking/history/ → SQLite `sessions` table.
- **Trigger:** one-time import when the pipeline is set up; safe to re-run.
- **Rules:**
  - Parses `cycle-*/week-*.md` files in `tracking/history/`.
  - Days with actual exercise results → `INSERT OR IGNORE (date, done=1)`.
  - Days with no results (skipped, "not logged") → **no row inserted**.
  - **Safety gate:** refuses to touch any date >= the current local date. Hard error.
  - Does NOT set `exported=1` on history rows — their source is already markdown.

### `site/scripts/export-tracking.mjs`  (`npm run export:tracking`)

- **Direction:** SQLite (`logs` + `sessions` where `exported=0`) → tracking/week-*.md.
- **Trigger:** called by the agent after capture, before creating a PR.
- **Rules:**
  - Groups rows by ISO week (Monday). Opens/creates `tracking/week-YYYY-MM-DD.md`.
  - Appends new sections in log-template.md shape; never rewrites existing content.
  - Marks exported rows `exported=1` in a single transaction AFTER writing files.
    A crash before the transaction leaves files written but rows unexported — safe to retry.
  - Does **not** commit or open a PR. Prints a summary of what changed to stdout.
    The calling agent reads the summary and handles git.

---

## Invariants

1. **Markdown wins.** If the tracking file and the DB disagree, the file is correct.
2. **No current-date backfill.** `backfill-history` refuses dates >= today. This protects
   `POST /api/done`'s `INSERT OR IGNORE` — a pre-existing `done=0` row would cause the
   Done button to silently no-op. Only historical (past) dates are backfilled.
3. **Export is append-only.** The script never deletes or rewrites existing content.
4. **PRs, not direct pushes.** Export changes land in `tracking/` via an agent-created PR
   that is adversarially reviewed before merge (see `docs/TASK-training-feedback-loop.md`).
5. **Idempotency.** Both bridges are safe to re-run: `INSERT OR IGNORE` on the DB side;
   append-only on the file side.

---

## Adding a new capture source

1. Write to `logs` (or `sessions`) with the appropriate `source` value.
2. Run `npm run export:tracking` to flush to markdown.
3. Create a PR with the diff; get it reviewed and merged.

---

*Last updated: 2026-07-09. Reference this doc from `site/README.md`.*
