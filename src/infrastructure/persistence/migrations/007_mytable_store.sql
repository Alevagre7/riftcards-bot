-- A store explicitly selected for the user's official Riot /mytable lookup.
-- Kept separate from /events location and event-watch state.

CREATE TABLE IF NOT EXISTS user_mytable_stores (
  telegram_id  INTEGER PRIMARY KEY,
  organizer_id TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  latitude     REAL    NOT NULL,
  longitude    REAL    NOT NULL,
  timezone     TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
