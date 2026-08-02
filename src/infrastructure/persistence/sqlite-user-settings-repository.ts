// SqliteUserSettingsRepository is the SQLite-backed implementation
// of IUserSettingsRepository. The driver is better-sqlite3 (sync),
// wrapped in Promise.resolve at the port boundary for symmetry with
// the rest of the codebase. The port is async, the adapter is
// effectively sync.
//
// See ADR-0006 for the storage decision and the schema. The single
// table is `user_locations` (see migrations/001_init.sql).

import Database from 'better-sqlite3';
import {
  IUserSettingsRepository,
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

export class SqliteUserSettingsRepository implements IUserSettingsRepository {
  private readonly getStmt: Database.Statement<[number], UserLocationRow>;
  private readonly setStmt: Database.Statement<[number, number, number, number | null, string]>;
  private readonly clearStmt: Database.Statement<[number]>;

  private readonly getNexusStmt: Database.Statement<[number], NexusUsernameRow>;
  private readonly setNexusStmt: Database.Statement<[number, string, string]>;
  private readonly clearNexusStmt: Database.Statement<[number]>;

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
}
