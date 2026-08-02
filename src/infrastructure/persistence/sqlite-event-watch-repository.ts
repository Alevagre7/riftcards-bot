// SqliteEventWatchRepository is the SQLite-backed implementation
// of IEventWatchRepository. Mirrors SqliteUserSettingsRepository.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { EventWatch } from '../../core/entities/event-watch.js';
import {
  EventWatchDraft,
  EventWatchObservation,
  IEventWatchRepository,
} from '../../core/ports/event-watch-repository.js';

interface EventWatchRow {
  telegram_id: number;
  revision: string;
  event_id: number;
  event_name: string;
  event_username: string;
  has_observed_pairing: number;
  last_seen_round: number | null;
  last_seen_table: number | null;
  last_seen_opponent: string | null;
  last_seen_result: string | null;
  created_at: string;
  updated_at: string;
  last_checked_at: string | null;
  consecutive_failures: number;
  consecutive_missing: number;
}

function newRevision(): string {
  // Callback data has a 64-byte limit. Keep new revisions compact while
  // retaining enough entropy to distinguish rapid replacements.
  return `${Date.now().toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 8)}`;
}

function rowToWatch(row: EventWatchRow): EventWatch {
  return {
    telegramId: row.telegram_id,
    revision: row.revision,
    eventId: row.event_id,
    eventName: row.event_name,
    eventUsername: row.event_username,
    hasObservedPairing: row.has_observed_pairing === 1,
    lastSeenRound: row.last_seen_round,
    lastSeenTable: row.last_seen_table,
    lastSeenOpponent: row.last_seen_opponent,
    lastSeenResult: row.last_seen_result as EventWatch['lastSeenResult'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: row.last_checked_at,
    consecutiveFailures: row.consecutive_failures,
    consecutiveMissing: row.consecutive_missing,
  };
}

export class SqliteEventWatchRepository implements IEventWatchRepository {
  private readonly listStmt: Database.Statement<[], EventWatchRow>;
  private readonly getStmt: Database.Statement<[number], EventWatchRow>;
  private readonly createStmt: Database.Statement<
    [number, string, number, string, string, string, string]
  >;
  private readonly replaceStmt: Database.Statement<
    [string, number, string, string, string, string, number, string]
  >;
  private readonly deleteStmt: Database.Statement<[number]>;
  private readonly deleteIfCurrentStmt: Database.Statement<[number, string]>;
  private readonly recordSuccessStmt: Database.Statement<
    [number | null, number | null, string | null, string | null, string, number, number, string, number, string]
  >;
  private readonly recordSuccessHealthStmt: Database.Statement<[string, number, string]>;
  private readonly recordFailureStmt: Database.Statement<[string, number, string]>;
  private readonly recordMissingStmt: Database.Statement<[string, number, string]>;

  constructor(private readonly db: Database.Database) {
    this.listStmt = db.prepare(
      'SELECT * FROM user_event_watches ORDER BY updated_at DESC',
    );
    this.getStmt = db.prepare(
      'SELECT * FROM user_event_watches WHERE telegram_id = ?',
    );
    this.createStmt = db.prepare(
      `INSERT OR IGNORE INTO user_event_watches
        (telegram_id, revision, event_id, event_name, event_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.replaceStmt = db.prepare(
      `UPDATE user_event_watches
       SET revision = ?,
           event_id = ?,
           event_name = ?,
           event_username = ?,
           last_seen_round = NULL,
           last_seen_table = NULL,
           last_seen_opponent = NULL,
           last_seen_result = NULL,
           has_observed_pairing = 0,
           last_checked_at = NULL,
           consecutive_failures = 0,
           consecutive_missing = 0,
           created_at = ?,
           updated_at = ?
       WHERE telegram_id = ? AND revision = ?`,
    );
    this.deleteStmt = db.prepare(
      'DELETE FROM user_event_watches WHERE telegram_id = ?',
    );
    this.deleteIfCurrentStmt = db.prepare(
      'DELETE FROM user_event_watches WHERE telegram_id = ? AND revision = ?',
    );
    this.recordSuccessStmt = db.prepare(
      `UPDATE user_event_watches
       SET last_seen_round = ?,
           last_seen_table = ?,
           last_seen_opponent = ?,
           last_seen_result = ?,
           last_checked_at = ?,
           consecutive_failures = 0,
           consecutive_missing = 0,
           has_observed_pairing = CASE WHEN ? = 1 THEN 1 ELSE has_observed_pairing END,
           updated_at = CASE WHEN ? = 1 THEN ? ELSE updated_at END
       WHERE telegram_id = ? AND revision = ?`,
    );
    this.recordSuccessHealthStmt = db.prepare(
      `UPDATE user_event_watches
       SET last_checked_at = ?, consecutive_failures = 0, consecutive_missing = 0
       WHERE telegram_id = ? AND revision = ?`,
    );
    this.recordFailureStmt = db.prepare(
      `UPDATE user_event_watches
       SET last_checked_at = ?,
           consecutive_failures = consecutive_failures + 1,
           consecutive_missing = 0
       WHERE telegram_id = ? AND revision = ?`,
    );
    this.recordMissingStmt = db.prepare(
      `UPDATE user_event_watches
       SET last_checked_at = ?,
           consecutive_missing = consecutive_missing + 1,
           consecutive_failures = 0
       WHERE telegram_id = ? AND revision = ?`,
    );
  }

  async list(): Promise<EventWatch[]> {
    return this.listStmt.all().map(rowToWatch);
  }

  async get(telegramId: number): Promise<EventWatch | null> {
    const row = this.getStmt.get(telegramId);
    return row ? rowToWatch(row) : null;
  }

  async create(watch: EventWatchDraft): Promise<EventWatch | null> {
    const revision = newRevision();
    const result = this.createStmt.run(
      watch.telegramId,
      revision,
      watch.eventId,
      watch.eventName,
      watch.eventUsername,
      watch.createdAt,
      watch.createdAt,
    );
    return result.changes > 0 ? this.get(watch.telegramId) : null;
  }

  async replace(watch: EventWatchDraft, expectedRevision: string): Promise<EventWatch | null> {
    const revision = newRevision();
    const result = this.replaceStmt.run(
      revision,
      watch.eventId,
      watch.eventName,
      watch.eventUsername,
      watch.createdAt,
      watch.createdAt,
      watch.telegramId,
      expectedRevision,
    );
    return result.changes > 0 ? this.get(watch.telegramId) : null;
  }

  async delete(telegramId: number): Promise<void> {
    this.deleteStmt.run(telegramId);
  }

  async deleteIfCurrent(telegramId: number, revision: string): Promise<boolean> {
    return this.deleteIfCurrentStmt.run(telegramId, revision).changes > 0;
  }

  async recordObservation(
    telegramId: number,
    revision: string,
    observation: EventWatchObservation,
  ): Promise<boolean> {
    if (observation.kind === 'transient-failure') {
      return this.recordFailureStmt.run(
        observation.checkedAt,
        telegramId,
        revision,
      ).changes > 0;
    }
    if (observation.kind === 'not-found') {
      return this.recordMissingStmt.run(
        observation.checkedAt,
        telegramId,
        revision,
      ).changes > 0;
    }

    if (!observation.changed && observation.snapshot === undefined && observation.clearSnapshot !== true) {
      return this.recordSuccessHealthStmt.run(
        observation.checkedAt,
        telegramId,
        revision,
      ).changes > 0;
    }

    const snapshot = observation.clearSnapshot === true
      ? { round: null, table: null, opponent: null, result: null }
      : observation.snapshot ?? {
          round: null,
          table: null,
          opponent: null,
          result: null,
        };
    const changedAt = observation.changed ? observation.checkedAt : null;
    return this.recordSuccessStmt.run(
      snapshot.round,
      snapshot.table,
      snapshot.opponent,
      snapshot.result,
      observation.checkedAt,
      observation.snapshot?.round != null ? 1 : 0,
      observation.changed ? 1 : 0,
      changedAt ?? observation.checkedAt,
      telegramId,
      revision,
    ).changes > 0;
  }
}
