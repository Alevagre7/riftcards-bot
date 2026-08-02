-- 005_event_watch_health.sql — add lifecycle and optimistic-concurrency
-- metadata to the single active watch stored per Telegram user.

ALTER TABLE user_event_watches ADD COLUMN revision TEXT NOT NULL DEFAULT '';
ALTER TABLE user_event_watches ADD COLUMN last_checked_at TEXT;
ALTER TABLE user_event_watches ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_event_watches ADD COLUMN consecutive_missing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_event_watches ADD COLUMN has_observed_pairing INTEGER NOT NULL DEFAULT 0;

UPDATE user_event_watches
SET revision = lower(hex(randomblob(16)))
WHERE revision = '';

UPDATE user_event_watches
SET has_observed_pairing = 1
WHERE last_seen_round IS NOT NULL;
