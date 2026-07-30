import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteEventWatchRepository } from './sqlite-event-watch-repository.js';
import { openDatabase } from './open-database.js';

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

  it('returns null when the user has no watch', async () => {
    expect(await repo.get(123)).toBeNull();
  });

  it('round-trips a watch via upsert and get', async () => {
    const now = new Date().toISOString();
    await repo.upsert({
      telegramId: 42,
      eventId: 735205,
      eventName: 'Wednesday Nexus',
      eventUsername: 'player_one',
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: now,
      updatedAt: now,
    });
    const stored = await repo.get(42);
    expect(stored).not.toBeNull();
    expect(stored!.telegramId).toBe(42);
    expect(stored!.eventId).toBe(735205);
    expect(stored!.eventName).toBe('Wednesday Nexus');
    expect(stored!.eventUsername).toBe('player_one');
    expect(stored!.lastSeenResult).toBeNull();
    expect(stored!.createdAt).toBe(now);
    expect(stored!.updatedAt).toBe(now);
  });

  it('overwrites an existing watch on upsert', async () => {
    const t0 = new Date().toISOString();
    await repo.upsert({
      telegramId: 1,
      eventId: 100,
      eventName: 'Event A',
      eventUsername: 'user_a',
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: t0,
      updatedAt: t0,
    });

    const t1 = new Date().toISOString();
    await repo.upsert({
      telegramId: 1,
      eventId: 200,
      eventName: 'Event B',
      eventUsername: 'user_b',
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: t0,
      updatedAt: t1,
    });

    const stored = await repo.get(1);
    expect(stored!.eventId).toBe(200);
    expect(stored!.eventName).toBe('Event B');
    expect(stored!.updatedAt).toBe(t1);
  });

  it('updateLastSeen sets the snapshot fields', async () => {
    const now = new Date().toISOString();
    await repo.upsert({
      telegramId: 7,
      eventId: 735205,
      eventName: 'Test Event',
      eventUsername: 'player',
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: now,
      updatedAt: now,
    });

    await repo.updateLastSeen(7, {
      round: 2,
      table: 3,
      opponent: 'rival',
      result: 'win',
    });

    const stored = await repo.get(7);
    expect(stored!.lastSeenRound).toBe(2);
    expect(stored!.lastSeenTable).toBe(3);
    expect(stored!.lastSeenOpponent).toBe('rival');
    expect(stored!.lastSeenResult).toBe('win');
  });

  it('delete removes the watch', async () => {
    const now = new Date().toISOString();
    await repo.upsert({
      telegramId: 99,
      eventId: 735205,
      eventName: 'Event',
      eventUsername: 'user',
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: now,
      updatedAt: now,
    });

    await repo.delete(99);
    expect(await repo.get(99)).toBeNull();
  });

  it('lists all watches', async () => {
    const now = new Date().toISOString();
    await repo.upsert({
      telegramId: 1,
      eventId: 100,
      eventName: 'E1',
      eventUsername: 'u1',
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: now,
      updatedAt: now,
    });
    await repo.upsert({
      telegramId: 2,
      eventId: 100,
      eventName: 'E1',
      eventUsername: 'u2',
      lastSeenRound: 1,
      lastSeenTable: 2,
      lastSeenOpponent: 'opp',
      lastSeenResult: null,
      createdAt: now,
      updatedAt: now,
    });

    const all = await repo.list();
    expect(all.length).toBe(2);
    expect(all.map((w) => w.telegramId).sort()).toEqual([1, 2]);
  });
});
