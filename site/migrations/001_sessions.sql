-- Migration 001: sessions table
-- Tracks which training days have been marked done.
CREATE TABLE IF NOT EXISTS sessions (
  date      TEXT PRIMARY KEY,          -- ISO date: 2026-07-01
  done      INTEGER NOT NULL DEFAULT 0,
  logged_at TEXT                       -- ISO timestamp of last update
);
