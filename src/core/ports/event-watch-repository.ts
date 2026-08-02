import { EventWatch } from '../entities/event-watch.js';

export interface EventWatchDraft {
  readonly telegramId: number;
  readonly eventId: number;
  readonly eventName: string;
  readonly eventUsername: string;
  readonly createdAt: string;
}

export interface EventWatchSnapshot {
  readonly round: number | null;
  readonly table: number | null;
  readonly opponent: string | null;
  readonly result: 'win' | 'loss' | 'draw' | 'bye' | null;
}

export type EventWatchObservation =
  | {
      readonly kind: 'success';
      readonly checkedAt: string;
      readonly snapshot?: EventWatchSnapshot;
      readonly clearSnapshot?: boolean;
      readonly changed: boolean;
    }
  | {
      readonly kind: 'transient-failure';
      readonly checkedAt: string;
    }
  | {
      readonly kind: 'not-found';
      readonly checkedAt: string;
    };

export interface IEventWatchRepository {
  list(): Promise<EventWatch[]>;
  get(telegramId: number): Promise<EventWatch | null>;
  create(watch: EventWatchDraft): Promise<EventWatch | null>;
  replace(watch: EventWatchDraft, expectedRevision: string): Promise<EventWatch | null>;
  delete(telegramId: number): Promise<void>;
  deleteIfCurrent(telegramId: number, revision: string): Promise<boolean>;
  recordObservation(
    telegramId: number,
    revision: string,
    observation: EventWatchObservation,
  ): Promise<boolean>;
}
