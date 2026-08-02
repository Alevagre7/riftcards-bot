import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
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
});
