-- 001_init.sql — initial schema for the bot's SQLite store.
-- One table for now: per-TelegramUser location. See ADR-0006.
--
-- Idempotent: the runner applies this once at startup, guarded by
-- IF NOT EXISTS. Future migrations append a 002_*.sql and are
-- applied in order.

CREATE TABLE IF NOT EXISTS user_locations (
  telegram_id  INTEGER PRIMARY KEY,
  latitude     REAL    NOT NULL,
  longitude    REAL    NOT NULL,
  -- NULL means "use the global EVENTS_RADIUS_KM env default". A
  -- non-null value overrides the global radius for that user.
  -- The setup flow stores the configured default explicitly; NULL is
  -- retained for callers that want to use the global radius.
  radius_km    REAL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_locations_updated_at
  ON user_locations (updated_at);
