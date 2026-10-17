// SqliteEventWatchRepository is the SQLite-backed implementation
// of IEventWatchRepository. Mirrors SqliteUserSettingsRepository.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { EventWatch } from '../../core/entities/event-watch.js';
import type { EventId, RoundId } from '../../core/entities/event-id.js';
import {
  EventWatchDraft,
  EventWatchObservation,
  IEventWatchRepository,
} from '../../core/ports/event-watch-repository.js';

interface EventWatchRow {
  telegram_id: number;
  revision: string;
  event_id: string;
  event_id_kind: 'number' | 'riot';
  event_name: string;
  event_username: string;
  registration_id: string | null;
  registration_id_kind: 'number' | 'string' | null;
  has_observed_pairing: number;
  last_seen_round: number | null;
  last_seen_round_id: string | null;
  last_seen_round_id_kind: 'number' | 'string' | null;
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

function encodeEventId(id: EventId): { value: string; kind: EventWatchRow['event_id_kind'] } {
  if (typeof id === 'number') return { value: String(id), kind: 'number' };
  return { value: id.slice('riot:'.length), kind: 'riot' };
}

function decodeEventId(value: string, kind: EventWatchRow['event_id_kind']): EventId {
  return kind === 'riot' ? `riot:${value}` : Number(value);
}

function encodeTypedId(id: number | string | undefined): { value: string; kind: 'number' | 'string' } | null {
  if (id === undefined) return null;
  return typeof id === 'number'
    ? { value: String(id), kind: 'number' }
    : { value: id, kind: 'string' };
}

function decodeTypedId(
  value: string | null,
  kind: 'number' | 'string' | null,
): number | string | null {
  if (value === null || kind === null) return null;
  return kind === 'number' ? Number(value) : value;
}

function rowToWatch(row: EventWatchRow): EventWatch {
  const registrationId = decodeTypedId(row.registration_id, row.registration_id_kind);
  const lastSeenRoundId = decodeTypedId(row.last_seen_round_id, row.last_seen_round_id_kind);
  return {
    telegramId: row.telegram_id,
    revision: row.revision,
    eventId: decodeEventId(row.event_id, row.event_id_kind),
    eventName: row.event_name,
    eventUsername: row.event_username,
    ...(registrationId === null ? {} : { registrationId }),
    hasObservedPairing: row.has_observed_pairing === 1,
    lastSeenRound: row.last_seen_round,
    lastSeenRoundId,
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

function encodeRoundId(roundId: RoundId | null | undefined): { value: string; kind: 'number' | 'string' } | null {
  if (roundId === null || roundId === undefined) return null;
  return typeof roundId === 'number'
    ? { value: String(roundId), kind: 'number' }
    : { value: roundId, kind: 'string' };
}

export class SqliteEventWatchRepository implements IEventWatchRepository {
  private readonly listStmt: Database.Statement<[], EventWatchRow>;
  private readonly getStmt: Database.Statement<[number], EventWatchRow>;
  private readonly createStmt: Database.Statement<
    [number, string, string, string, string, string, string | null, string | null, string, string]
  >;
  private readonly replaceStmt: Database.Statement<
    [string, string, string, string, string, string | null, string | null, string, string, number, string]
  >;
  private readonly deleteStmt: Database.Statement<[number]>;
  private readonly deleteIfCurrentStmt: Database.Statement<[number, string]>;
  private readonly recordSuccessStmt: Database.Statement<
    [number | null, string | null, string | null, number | null, string | null, string | null, string, number, number, string, number, string]
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
        (telegram_id, revision, event_id, event_id_kind, event_name, event_username,
         registration_id, registration_id_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.replaceStmt = db.prepare(
      `UPDATE user_event_watches
       SET revision = ?,
           event_id = ?,
           event_id_kind = ?,
           event_name = ?,
           event_username = ?,
           registration_id = ?,
           registration_id_kind = ?,
           last_seen_round = NULL,
           last_seen_round_id = NULL,
           last_seen_round_id_kind = NULL,
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
           last_seen_round_id = ?,
           last_seen_round_id_kind = ?,
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
    const eventId = encodeEventId(watch.eventId);
    const registrationId = encodeTypedId(watch.registrationId);
    const result = this.createStmt.run(
      watch.telegramId,
      revision,
      eventId.value,
      eventId.kind,
      watch.eventName,
      watch.eventUsername,
      registrationId?.value ?? null,
      registrationId?.kind ?? null,
      watch.createdAt,
      watch.createdAt,
    );
    return result.changes > 0 ? this.get(watch.telegramId) : null;
  }

  async replace(watch: EventWatchDraft, expectedRevision: string): Promise<EventWatch | null> {
    const revision = newRevision();
    const eventId = encodeEventId(watch.eventId);
    const registrationId = encodeTypedId(watch.registrationId);
    const result = this.replaceStmt.run(
      revision,
      eventId.value,
      eventId.kind,
      watch.eventName,
      watch.eventUsername,
      registrationId?.value ?? null,
      registrationId?.kind ?? null,
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
      ? { round: null, roundId: null, table: null, opponent: null, result: null }
      : observation.snapshot ?? {
          round: null,
          roundId: null,
          table: null,
          opponent: null,
          result: null,
        };
    const roundId = encodeRoundId(snapshot.roundId);
    const changedAt = observation.changed ? observation.checkedAt : null;
    return this.recordSuccessStmt.run(
      snapshot.round,
      roundId?.value ?? null,
      roundId?.kind ?? null,
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
