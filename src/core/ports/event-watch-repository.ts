import { EventWatch } from '../entities/event-watch.js';

export interface IEventWatchRepository {
  list(): Promise<EventWatch[]>;
  get(telegramId: number): Promise<EventWatch | null>;
  upsert(watch: EventWatch): Promise<void>;
  delete(telegramId: number): Promise<void>;
  updateLastSeen(
    telegramId: number,
    snapshot: {
      round: number | null;
      table: number | null;
      opponent: string | null;
      result: 'win' | 'loss' | 'draw' | 'bye' | null;
    },
  ): Promise<void>;
}
