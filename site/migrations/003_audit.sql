-- Migration 003: audit table
-- Records every Telegram command attempt (both accepted and rejected).
-- ok=1 means the sender was the owner and the command was handled.
-- ok=0 means the sender was not the owner — no reply was sent.
CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY,
  at      TEXT NOT NULL DEFAULT (datetime('now')),
  user_id TEXT NOT NULL,
  command TEXT NOT NULL,
  ok      INTEGER NOT NULL
);
