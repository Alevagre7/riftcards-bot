import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteUserSettingsRepository } from './sqlite-user-settings-repository.js';
import { openDatabase } from './open-database.js';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SqliteUserSettingsRepository (in-memory)', () => {
  let db: Database.Database;
  let repo: SqliteUserSettingsRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SqliteUserSettingsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when the user has no saved location', async () => {
    expect(await repo.getLocation(123)).toBeNull();
  });

  it('round-trips a location without a per-user radius', async () => {
    await repo.setLocation(42, { latitude: 37.39, longitude: -5.99 });
    const stored = await repo.getLocation(42);
    expect(stored).not.toBeNull();
    expect(stored?.telegramId).toBe(42);
    expect(stored?.latitude).toBeCloseTo(37.39);
    expect(stored?.longitude).toBeCloseTo(-5.99);
    expect(stored?.radiusKm).toBeNull();
    expect(stored?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('round-trips a location with a per-user radius', async () => {
    await repo.setLocation(7, { latitude: 40.0, longitude: -3.7, radiusKm: 25 });
    const stored = await repo.getLocation(7);
    expect(stored?.radiusKm).toBe(25);
  });

  it('treats explicit null radius as the "use global" sentinel', async () => {
    await repo.setLocation(7, { latitude: 1, longitude: 2, radiusKm: 50 });
    await repo.setLocation(7, { latitude: 1, longitude: 2, radiusKm: null });
    const stored = await repo.getLocation(7);
    expect(stored?.radiusKm).toBeNull();
  });

  it('overwrites an existing row on a second setLocation', async () => {
    await repo.setLocation(1, { latitude: 10, longitude: 10 });
    await repo.setLocation(1, { latitude: 20, longitude: 20, radiusKm: 30 });
    const stored = await repo.getLocation(1);
    expect(stored?.latitude).toBe(20);
    expect(stored?.longitude).toBe(20);
    expect(stored?.radiusKm).toBe(30);
  });

  it('clearLocation removes the row', async () => {
    await repo.setLocation(1, { latitude: 10, longitude: 10 });
    await repo.clearLocation(1);
    expect(await repo.getLocation(1)).toBeNull();
  });

  it('clearLocation is a no-op for an unknown user', async () => {
    await expect(repo.clearLocation(999)).resolves.toBeUndefined();
  });

  it('keeps separate users isolated', async () => {
    await repo.setLocation(1, { latitude: 10, longitude: 10 });
    await repo.setLocation(2, { latitude: 20, longitude: 20 });
    const a = await repo.getLocation(1);
    const b = await repo.getLocation(2);
    expect(a?.latitude).toBe(10);
    expect(b?.latitude).toBe(20);
  });
});

describe('SqliteUserSettingsRepository — nexus username', () => {
  let db: Database.Database;
  let repo: SqliteUserSettingsRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SqliteUserSettingsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when the user has no saved nexus username', async () => {
    expect(await repo.getNexusUsername(123)).toBeNull();
  });

  it('round-trips a nexus username', async () => {
    await repo.setNexusUsername(42, 'riftbound_player');
    const stored = await repo.getNexusUsername(42);
    expect(stored).toBe('riftbound_player');
  });

  it('clearNexusUsername removes the row', async () => {
    await repo.setNexusUsername(1, 'player_one');
    await repo.clearNexusUsername(1);
    expect(await repo.getNexusUsername(1)).toBeNull();
  });

  it('clearNexusUsername is a no-op for an unknown user', async () => {
    await expect(repo.clearNexusUsername(999)).resolves.toBeUndefined();
  });

  it('keeps separate user nexus usernames isolated', async () => {
    await repo.setNexusUsername(1, 'player_a');
    await repo.setNexusUsername(2, 'player_b');
    expect(await repo.getNexusUsername(1)).toBe('player_a');
    expect(await repo.getNexusUsername(2)).toBe('player_b');
  });

  it('overwrites an existing nexus username on a second set', async () => {
    await repo.setNexusUsername(1, 'old_name');
    await repo.setNexusUsername(1, 'new_name');
    expect(await repo.getNexusUsername(1)).toBe('new_name');
  });
});

describe('SqliteUserSettingsRepository — /mytable store preference', () => {
  let db: Database.Database;
  let repo: SqliteUserSettingsRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SqliteUserSettingsRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns null when no store has been selected', async () => {
    expect(await repo.getMytableStore(123)).toBeNull();
  });

  it('round-trips the Riot organizer and its lookup location independently', async () => {
    await repo.setMytableStore(42, {
      organizerId: 'b6e5c1f0-2233-4a55-8666-123456789abc',
      name: 'Card Castle',
      latitude: 37.39,
      longitude: -5.99,
      timezone: 'Europe/Madrid',
    });

    const stored = await repo.getMytableStore(42);
    expect(stored).toMatchObject({
      organizerId: 'b6e5c1f0-2233-4a55-8666-123456789abc',
      name: 'Card Castle',
      latitude: 37.39,
      longitude: -5.99,
      timezone: 'Europe/Madrid',
    });
    expect(stored?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('replaces the selected store without changing the /events location', async () => {
    await repo.setLocation(42, { latitude: 1, longitude: 2, radiusKm: 30 });
    await repo.setMytableStore(42, {
      organizerId: 'first-organizer',
      name: 'First Store',
      latitude: 3,
      longitude: 4,
      timezone: 'UTC',
    });
    await repo.setMytableStore(42, {
      organizerId: 'second-organizer',
      name: 'Second Store',
      latitude: 5,
      longitude: 6,
      timezone: 'Europe/Paris',
    });

    expect(await repo.getMytableStore(42)).toMatchObject({
      organizerId: 'second-organizer',
      name: 'Second Store',
    });
    expect(await repo.getLocation(42)).toMatchObject({ latitude: 1, longitude: 2, radiusKm: 30 });
  });

  it('clears the store preference without clearing the saved player name', async () => {
    await repo.setNexusUsername(42, 'Player#EUW');
    await repo.setMytableStore(42, {
      organizerId: 'organizer',
      name: 'Store',
      latitude: 1,
      longitude: 2,
      timezone: 'UTC',
    });

    await repo.clearMytableStore(42);

    expect(await repo.getMytableStore(42)).toBeNull();
    expect(await repo.getNexusUsername(42)).toBe('Player#EUW');
  });
});

describe('openDatabase (file-backed)', () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `riftbot-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the file on first open and survives a reopen', async () => {
    const path = join(dir, 'riftbot.db');
    const db1 = openDatabase(path);
    const repo1 = new SqliteUserSettingsRepository(db1);
    await repo1.setLocation(1, { latitude: 10, longitude: 10 });
    await repo1.setMytableStore(1, {
      organizerId: 'persisted-organizer',
      name: 'Persisted Store',
      latitude: 11,
      longitude: 12,
      timezone: 'Europe/Madrid',
    });
    db1.close();

    // Re-open and verify the row is still there.
    const db2 = openDatabase(path);
    const repo2 = new SqliteUserSettingsRepository(db2);
    const stored = await repo2.getLocation(1);
    expect(stored).not.toBeNull();
    expect(stored?.latitude).toBe(10);
    expect(await repo2.getMytableStore(1)).toMatchObject({
      organizerId: 'persisted-organizer',
      name: 'Persisted Store',
      latitude: 11,
      longitude: 12,
      timezone: 'Europe/Madrid',
    });
    db2.close();
  });

  it('re-applies migrations idempotently on a populated DB', async () => {
    const path = join(dir, 'riftbot.db');
    const db0 = openDatabase(path);
    db0.close();
    // Re-opening on a populated DB must not throw and must not
    // corrupt the schema.
    const db = openDatabase(path);
    const repo = new SqliteUserSettingsRepository(db);
    await repo.setLocation(1, { latitude: 10, longitude: 10 });
    const stored = await repo.getLocation(1);
    expect(stored?.latitude).toBe(10);
    db.close();
  });
});
