-- 002_nexus_username.sql — per-TelegramUser Nexus username.
--
-- Idempotent: the runner applies this in lexicographic order after
-- 001_init.sql. The table is small, scoped per user, and survives
-- restarts via the existing Docker volume.

CREATE TABLE IF NOT EXISTS user_nexus_usernames (
  telegram_id  INTEGER PRIMARY KEY,
  username     TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
