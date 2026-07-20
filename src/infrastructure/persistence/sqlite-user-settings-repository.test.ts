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
    db1.close();

    // Re-open and verify the row is still there.
    const db2 = openDatabase(path);
    const repo2 = new SqliteUserSettingsRepository(db2);
    const stored = await repo2.getLocation(1);
    expect(stored).not.toBeNull();
    expect(stored?.latitude).toBe(10);
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
