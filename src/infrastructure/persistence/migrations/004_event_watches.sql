-- 004_event_watches.sql — per-TelegramUser event watch. Replaces the
-- nexus-table-based watch store that previously lived in 003_nexus_watches.sql
-- (file removed). Drops the old user_nexus_watches table and creates
-- user_event_watches with an index on event_id.

DROP TABLE IF EXISTS user_nexus_watches;

CREATE TABLE IF NOT EXISTS user_event_watches (
  telegram_id         INTEGER PRIMARY KEY,
  event_id            INTEGER NOT NULL,
  event_name          TEXT    NOT NULL,
  event_username      TEXT    NOT NULL,
  last_seen_round     INTEGER,
  last_seen_table     INTEGER,
  last_seen_opponent  TEXT,
  last_seen_result    TEXT,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_event_watches_event_id
  ON user_event_watches (event_id);
