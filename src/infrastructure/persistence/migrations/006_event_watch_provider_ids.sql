-- Preserve legacy numeric UVS event IDs while allowing exact Riot IDs and
-- stable registration / round identities for the 1v1 watch contract.

ALTER TABLE user_event_watches RENAME TO user_event_watches_v5;

CREATE TABLE user_event_watches (
  telegram_id              INTEGER PRIMARY KEY,
  event_id                 TEXT    NOT NULL,
  event_id_kind            TEXT    NOT NULL CHECK (event_id_kind IN ('number', 'riot')),
  event_name               TEXT    NOT NULL,
  event_username           TEXT    NOT NULL,
  revision                 TEXT    NOT NULL,
  registration_id          TEXT,
  registration_id_kind     TEXT    CHECK (registration_id_kind IN ('number', 'string')),
  has_observed_pairing     INTEGER NOT NULL DEFAULT 0,
  last_seen_round          INTEGER,
  last_seen_round_id       TEXT,
  last_seen_round_id_kind  TEXT    CHECK (last_seen_round_id_kind IN ('number', 'string')),
  last_seen_table          INTEGER,
  last_seen_opponent       TEXT,
  last_seen_result         TEXT,
  created_at               TEXT    NOT NULL,
  updated_at               TEXT    NOT NULL,
  last_checked_at          TEXT,
  consecutive_failures     INTEGER NOT NULL DEFAULT 0,
  consecutive_missing      INTEGER NOT NULL DEFAULT 0
);

INSERT INTO user_event_watches (
  telegram_id,
  event_id,
  event_id_kind,
  event_name,
  event_username,
  revision,
  has_observed_pairing,
  last_seen_round,
  last_seen_table,
  last_seen_opponent,
  last_seen_result,
  created_at,
  updated_at,
  last_checked_at,
  consecutive_failures,
  consecutive_missing
)
SELECT
  telegram_id,
  CAST(event_id AS TEXT),
  'number',
  event_name,
  event_username,
  revision,
  has_observed_pairing,
  last_seen_round,
  last_seen_table,
  last_seen_opponent,
  last_seen_result,
  created_at,
  updated_at,
  last_checked_at,
  consecutive_failures,
  consecutive_missing
FROM user_event_watches_v5;

DROP TABLE user_event_watches_v5;

CREATE INDEX idx_user_event_watches_event_id
  ON user_event_watches (event_id_kind, event_id);
