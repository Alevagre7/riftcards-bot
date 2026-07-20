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
  -- Not currently written by the v1 /events set flow (the flow
  -- only captures the location pin), but the column is reserved
  -- for a future /events radius <km> command.
  radius_km    REAL,
  updated_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_locations_updated_at
  ON user_locations (updated_at);
