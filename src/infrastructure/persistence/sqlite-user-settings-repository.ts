// SqliteUserSettingsRepository is the SQLite-backed implementation
// of IUserSettingsRepository. The driver is better-sqlite3 (sync),
// wrapped in Promise.resolve at the port boundary for symmetry with
// the rest of the codebase. The port is async, the adapter is
// effectively sync.
//
// `user_locations`, `user_nexus_usernames`, and `user_mytable_stores` are
// created by the ordered SQL migrations under `migrations/`.

import Database from 'better-sqlite3';
import {
  IUserSettingsRepository,
  MytableStorePreference,
  UserLocation,
} from '../../core/ports/user-settings-repository.js';

interface UserLocationRow {
  telegram_id: number;
  latitude: number;
  longitude: number;
  radius_km: number | null;
  updated_at: string;
}

function rowToLocation(row: UserLocationRow): UserLocation {
  return {
    telegramId: row.telegram_id,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusKm: row.radius_km,
    updatedAt: row.updated_at,
  };
}

interface NexusUsernameRow {
  telegram_id: number;
  username: string;
  updated_at: string;
}

interface MytableStoreRow {
  telegram_id: number;
  organizer_id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  updated_at: string;
}

function rowToMytableStore(row: MytableStoreRow): MytableStorePreference {
  return {
    organizerId: row.organizer_id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    updatedAt: row.updated_at,
  };
}

export class SqliteUserSettingsRepository implements IUserSettingsRepository {
  private readonly getStmt: Database.Statement<[number], UserLocationRow>;
  private readonly setStmt: Database.Statement<[number, number, number, number | null, string]>;
  private readonly clearStmt: Database.Statement<[number]>;

  private readonly getNexusStmt: Database.Statement<[number], NexusUsernameRow>;
  private readonly setNexusStmt: Database.Statement<[number, string, string]>;
  private readonly clearNexusStmt: Database.Statement<[number]>;

  private readonly getMytableStoreStmt: Database.Statement<[number], MytableStoreRow>;
  private readonly setMytableStoreStmt: Database.Statement<
    [number, string, string, number, number, string, string]
  >;
  private readonly clearMytableStoreStmt: Database.Statement<[number]>;

  constructor(private readonly db: Database.Database) {
    this.getStmt = db.prepare<[number], UserLocationRow>(
      'SELECT telegram_id, latitude, longitude, radius_km, updated_at FROM user_locations WHERE telegram_id = ?',
    );
    // Use an UPDATE-on-conflict rather than INSERT OR REPLACE. SQLite's
    // REPLACE deletes the old row first, which can surprise future
    // foreign keys/triggers and is unnecessary for this upsert.
    this.setStmt = db.prepare<[number, number, number, number | null, string]>(
      `INSERT INTO user_locations
         (telegram_id, latitude, longitude, radius_km, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         radius_km = excluded.radius_km,
         updated_at = excluded.updated_at`,
    );
    this.clearStmt = db.prepare<[number]>(
      'DELETE FROM user_locations WHERE telegram_id = ?',
    );

    this.getNexusStmt = db.prepare<[number], NexusUsernameRow>(
      'SELECT telegram_id, username, updated_at FROM user_nexus_usernames WHERE telegram_id = ?',
    );
    this.setNexusStmt = db.prepare<[number, string, string]>(
      `INSERT INTO user_nexus_usernames
         (telegram_id, username, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username = excluded.username,
         updated_at = excluded.updated_at`,
    );
    this.clearNexusStmt = db.prepare<[number]>(
      'DELETE FROM user_nexus_usernames WHERE telegram_id = ?',
    );

    this.getMytableStoreStmt = db.prepare<[number], MytableStoreRow>(
      'SELECT telegram_id, organizer_id, name, latitude, longitude, timezone, updated_at FROM user_mytable_stores WHERE telegram_id = ?',
    );
    this.setMytableStoreStmt = db.prepare<
      [number, string, string, number, number, string, string]
    >(
      `INSERT INTO user_mytable_stores
         (telegram_id, organizer_id, name, latitude, longitude, timezone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         organizer_id = excluded.organizer_id,
         name = excluded.name,
         latitude = excluded.latitude,
         longitude = excluded.longitude,
         timezone = excluded.timezone,
         updated_at = excluded.updated_at`,
    );
    this.clearMytableStoreStmt = db.prepare<[number]>(
      'DELETE FROM user_mytable_stores WHERE telegram_id = ?',
    );
  }

  async getLocation(telegramId: number): Promise<UserLocation | null> {
    const row = this.getStmt.get(telegramId);
    return row ? rowToLocation(row) : null;
  }

  async setLocation(
    telegramId: number,
    location: { latitude: number; longitude: number; radiusKm?: number | null },
  ): Promise<void> {
    this.setStmt.run(
      telegramId,
      location.latitude,
      location.longitude,
      location.radiusKm ?? null,
      new Date().toISOString(),
    );
  }

  async clearLocation(telegramId: number): Promise<void> {
    this.clearStmt.run(telegramId);
  }

  async getNexusUsername(telegramId: number): Promise<string | null> {
    const row = this.getNexusStmt.get(telegramId);
    return row ? row.username : null;
  }

  async setNexusUsername(telegramId: number, username: string): Promise<void> {
    this.setNexusStmt.run(telegramId, username, new Date().toISOString());
  }

  async clearNexusUsername(telegramId: number): Promise<void> {
    this.clearNexusStmt.run(telegramId);
  }

  async getMytableStore(telegramId: number): Promise<MytableStorePreference | null> {
    const row = this.getMytableStoreStmt.get(telegramId);
    return row ? rowToMytableStore(row) : null;
  }

  async setMytableStore(
    telegramId: number,
    store: Omit<MytableStorePreference, 'updatedAt'>,
  ): Promise<void> {
    this.setMytableStoreStmt.run(
      telegramId,
      store.organizerId,
      store.name,
      store.latitude,
      store.longitude,
      store.timezone,
      new Date().toISOString(),
    );
  }

  async clearMytableStore(telegramId: number): Promise<void> {
    this.clearMytableStoreStmt.run(telegramId);
  }
}
