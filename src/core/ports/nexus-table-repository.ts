import { NexusTable } from '../entities/nexus-table.js';
import type { EventId } from '../entities/event-id.js';

export interface NexusTableStoreLookup {
  readonly organizerId: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string;
}

export interface GetNexusTableOptions {
  readonly username: string;
  /** Explicitly selected Riot organizer; required because player lookup is store-scoped. */
  readonly store: NexusTableStoreLookup;
  /** Optional one-off event selection used to disambiguate same-day tournaments. */
  readonly eventId?: EventId;
}

export interface INexusTableRepository {
  getTable(options: GetNexusTableOptions): Promise<NexusTable>;
}
