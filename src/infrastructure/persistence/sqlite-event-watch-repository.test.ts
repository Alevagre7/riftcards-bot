import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteEventWatchRepository } from './sqlite-event-watch-repository.js';
import { openDatabase } from './open-database.js';
import { EventWatchDraft } from '../../core/ports/event-watch-repository.js';

describe('SqliteEventWatchRepository (in-memory)', () => {
  let db: Database.Database;
  let repo: SqliteEventWatchRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SqliteEventWatchRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function draft(overrides: Partial<EventWatchDraft> = {}): EventWatchDraft {
    return {
      telegramId: 42,
      eventId: 735205,
      eventName: 'Wednesday Nexus',
      eventUsername: 'player_one',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('returns null when the user has no watch', async () => {
    expect(await repo.get(123)).toBeNull();
  });

  it('creates and round-trips a watch with fresh lifecycle metadata', async () => {
    const created = await repo.create(draft());
    expect(created).not.toBeNull();
    expect(created!.revision).toBeTruthy();
    expect(created!.eventName).toBe('Wednesday Nexus');
    expect(created!.lastSeenResult).toBeNull();
    expect(created!.hasObservedPairing).toBe(false);
    expect(created!.lastCheckedAt).toBeNull();
    expect(created!.consecutiveFailures).toBe(0);
    expect(created!.consecutiveMissing).toBe(0);
  });

  it('does not create a second active watch for the same user', async () => {
    const first = await repo.create(draft({ eventId: 100 }));
    const second = await repo.create(draft({ eventId: 200 }));

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await repo.get(42))!.eventId).toBe(100);
  });

  it('replaces only the expected watch revision', async () => {
    const first = await repo.create(draft({ eventId: 100 }));
    const replacement = await repo.replace(
      draft({ eventId: 200, eventName: 'Event B' }),
      first!.revision,
    );

    expect(replacement).not.toBeNull();
    expect(replacement!.eventId).toBe(200);
    expect(replacement!.revision).not.toBe(first!.revision);
    expect(await repo.replace(draft({ eventId: 300 }), first!.revision)).toBeNull();
  });

  it('records a pairing observation and marks the watch as observed', async () => {
    const created = await repo.create(draft())!;
    const checkedAt = new Date().toISOString();
    const changed = await repo.recordObservation(42, created!.revision, {
      kind: 'success',
      checkedAt,
      changed: true,
      snapshot: { round: 2, table: 3, opponent: 'rival', result: 'win' },
    });

    expect(changed).toBe(true);
    const stored = await repo.get(42);
    expect(stored!.lastSeenRound).toBe(2);
    expect(stored!.lastSeenTable).toBe(3);
    expect(stored!.lastSeenOpponent).toBe('rival');
    expect(stored!.lastSeenResult).toBe('win');
    expect(stored!.hasObservedPairing).toBe(true);
    expect(stored!.lastCheckedAt).toBe(checkedAt);
  });

  it('tracks transient and missing health separately', async () => {
    const created = await repo.create(draft())!;
    const first = new Date().toISOString();
    await repo.recordObservation(42, created!.revision, {
      kind: 'transient-failure',
      checkedAt: first,
    });
    await repo.recordObservation(42, created!.revision, {
      kind: 'transient-failure',
      checkedAt: new Date().toISOString(),
    });
    let stored = await repo.get(42);
    expect(stored!.consecutiveFailures).toBe(2);
    expect(stored!.consecutiveMissing).toBe(0);

    await repo.recordObservation(42, created!.revision, {
      kind: 'not-found',
      checkedAt: new Date().toISOString(),
    });
    stored = await repo.get(42);
    expect(stored!.consecutiveFailures).toBe(0);
    expect(stored!.consecutiveMissing).toBe(1);
  });

  it('ignores stale observations and conditional deletes', async () => {
    const created = await repo.create(draft())!;
    expect(await repo.recordObservation(42, 'stale', {
      kind: 'transient-failure',
      checkedAt: new Date().toISOString(),
    })).toBe(false);
    expect(await repo.deleteIfCurrent(42, 'stale')).toBe(false);
    expect(await repo.deleteIfCurrent(42, created!.revision)).toBe(true);
    expect(await repo.get(42)).toBeNull();
  });

  it('lists all active watches', async () => {
    await repo.create(draft({ telegramId: 1, eventId: 100, eventName: 'E1', eventUsername: 'u1' }));
    await repo.create(draft({ telegramId: 2, eventId: 100, eventName: 'E1', eventUsername: 'u2' }));

    const all = await repo.list();
    expect(all.length).toBe(2);
    expect(all.map((watch) => watch.telegramId).sort()).toEqual([1, 2]);
  });

  it('round-trips exact Riot and player UUIDs after the repository is recreated', async () => {
    const created = await repo.create(draft({
      eventId: 'riot:12345678901234567890',
      registrationId: 'player-uuid-8f0c4dd1-4e7a-4d3a-a9f5',
    }));
    expect(created?.eventId).toBe('riot:12345678901234567890');

    await repo.recordObservation(42, created!.revision, {
      kind: 'success',
      checkedAt: new Date().toISOString(),
      changed: true,
      snapshot: {
        round: 1,
        roundId: 'round-uuid-01234567890123456789',
        table: 4,
        opponent: 'rival',
        result: 'win',
      },
    });

    const restartedRepository = new SqliteEventWatchRepository(db);
    const stored = await restartedRepository.get(42);
    expect(stored?.eventId).toBe('riot:12345678901234567890');
    expect(stored?.registrationId).toBe('player-uuid-8f0c4dd1-4e7a-4d3a-a9f5');
    expect(stored?.lastSeenRoundId).toBe('round-uuid-01234567890123456789');
  });

  it('migrates old numeric event IDs without changing their domain type', async () => {
    const legacyDb = new Database(':memory:');
    try {
      legacyDb.exec(`
        CREATE TABLE user_event_watches (
          telegram_id INTEGER PRIMARY KEY,
          event_id INTEGER NOT NULL,
          event_name TEXT NOT NULL,
          event_username TEXT NOT NULL,
          last_seen_round INTEGER,
          last_seen_table INTEGER,
          last_seen_opponent TEXT,
          last_seen_result TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          revision TEXT NOT NULL DEFAULT '',
          last_checked_at TEXT,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          consecutive_missing INTEGER NOT NULL DEFAULT 0,
          has_observed_pairing INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_user_event_watches_event_id ON user_event_watches (event_id);
        INSERT INTO user_event_watches (
          telegram_id, event_id, event_name, event_username, last_seen_round,
          last_seen_table, last_seen_opponent, last_seen_result, created_at,
          updated_at, revision, has_observed_pairing
        ) VALUES (
          99, 735205, 'Legacy event', 'legacy_player', 3,
          7, 'rival', 'loss', '2026-08-01T12:00:00.000Z',
          '2026-08-01T12:01:00.000Z', 'legacy-revision', 1
        );
      `);
      legacyDb.exec(readFileSync(fileURLToPath(
        new URL('./migrations/006_event_watch_provider_ids.sql', import.meta.url),
      ), 'utf8'));

      const legacyRepository = new SqliteEventWatchRepository(legacyDb);
      const migrated = await legacyRepository.get(99);
      expect(migrated?.eventId).toBe(735205);
      expect(typeof migrated?.eventId).toBe('number');
      expect(migrated?.eventUsername).toBe('legacy_player');
      expect(migrated?.lastSeenRound).toBe(3);
      expect(migrated?.lastSeenRoundId).toBeNull();
      expect(migrated?.registrationId).toBeUndefined();
      expect(migrated?.revision).toBe('legacy-revision');
    } finally {
      legacyDb.close();
    }
  });
});
