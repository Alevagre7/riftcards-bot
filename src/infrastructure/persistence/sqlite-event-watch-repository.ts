// SqliteEventWatchRepository is the SQLite-backed implementation
// of IEventWatchRepository. Mirrors SqliteUserSettingsRepository.

import Database from 'better-sqlite3';
import { EventWatch } from '../../core/entities/event-watch.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';

interface EventWatchRow {
  telegram_id: number;
  event_id: number;
  event_name: string;
  event_username: string;
  last_seen_round: number | null;
  last_seen_table: number | null;
  last_seen_opponent: string | null;
  last_seen_result: string | null;
  created_at: string;
  updated_at: string;
}

function rowToWatch(row: EventWatchRow): EventWatch {
  return {
    telegramId: row.telegram_id,
    eventId: row.event_id,
    eventName: row.event_name,
    eventUsername: row.event_username,
    lastSeenRound: row.last_seen_round,
    lastSeenTable: row.last_seen_table,
    lastSeenOpponent: row.last_seen_opponent,
    lastSeenResult: row.last_seen_result as EventWatch['lastSeenResult'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteEventWatchRepository implements IEventWatchRepository {
  private readonly listStmt: Database.Statement<[], EventWatchRow>;
  private readonly getStmt: Database.Statement<[number], EventWatchRow>;
  private readonly upsertStmt: Database.Statement<
    [number, number, string, string, string, string]
  >;
  private readonly deleteStmt: Database.Statement<[number]>;
  private readonly updateLastSeenStmt: Database.Statement<
    [number | null, number | null, string | null, string | null, string, number]
  >;

  constructor(private readonly db: Database.Database) {
    this.listStmt = db.prepare(
      'SELECT * FROM user_event_watches ORDER BY updated_at DESC',
    );
    this.getStmt = db.prepare(
      'SELECT * FROM user_event_watches WHERE telegram_id = ?',
    );
    this.upsertStmt = db.prepare(
      `INSERT INTO user_event_watches
        (telegram_id, event_id, event_name, event_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
        event_id         = excluded.event_id,
        event_name       = excluded.event_name,
        event_username   = excluded.event_username,
        last_seen_round  = NULL,
        last_seen_table  = NULL,
        last_seen_opponent = NULL,
        last_seen_result = NULL,
        updated_at       = excluded.updated_at`,
    );
    this.deleteStmt = db.prepare(
      'DELETE FROM user_event_watches WHERE telegram_id = ?',
    );
    this.updateLastSeenStmt = db.prepare(
      `UPDATE user_event_watches
       SET last_seen_round = ?,
           last_seen_table = ?,
           last_seen_opponent = ?,
           last_seen_result = ?,
           updated_at = ?
       WHERE telegram_id = ?`,
    );
  }

  async list(): Promise<EventWatch[]> {
    return this.listStmt.all().map(rowToWatch);
  }

  async get(telegramId: number): Promise<EventWatch | null> {
    const row = this.getStmt.get(telegramId);
    return row ? rowToWatch(row) : null;
  }

  async upsert(watch: EventWatch): Promise<void> {
    this.upsertStmt.run(
      watch.telegramId,
      watch.eventId,
      watch.eventName,
      watch.eventUsername,
      watch.createdAt,
      watch.updatedAt,
    );
  }

  async delete(telegramId: number): Promise<void> {
    this.deleteStmt.run(telegramId);
  }

  async updateLastSeen(
    telegramId: number,
    snapshot: {
      round: number | null;
      table: number | null;
      opponent: string | null;
      result: 'win' | 'loss' | 'draw' | 'bye' | null;
    },
  ): Promise<void> {
    this.updateLastSeenStmt.run(
      snapshot.round,
      snapshot.table,
      snapshot.opponent,
      snapshot.result,
      new Date().toISOString(),
      telegramId,
    );
  }
}
