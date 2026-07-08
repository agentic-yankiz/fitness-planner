-- Migration 002: logs table + sessions.exported column
-- Captures individual exercise logs written via web or telegram.
-- exported flag (0/1) tracks whether this row has been flushed to tracking/.
CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,          -- ISO date: 2026-07-09
  exercise   TEXT    NOT NULL,
  payload    TEXT    NOT NULL,          -- JSON blob (sets, reps, load, RPE, notes, …)
  source     TEXT    NOT NULL CHECK(source IN ('web', 'telegram')),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  exported   INTEGER NOT NULL DEFAULT 0
);

-- Add exported column to sessions (tracks flush to tracking/ markdown).
-- ALTER TABLE ADD COLUMN is safe to run even if column already exists only via
-- the IF NOT EXISTS guard below (SQLite ≥ 3.37.0). For older SQLite we rely on
-- the schema_migrations idempotency gate — this file runs at most once.
ALTER TABLE sessions ADD COLUMN exported INTEGER NOT NULL DEFAULT 0;
