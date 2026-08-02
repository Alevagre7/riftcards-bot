// events-pagination-state: small in-memory state for paginated event lists.
//
// When the user clicks "Next →" or "← Prev" on a paginated event list, the
// bot needs the original event data to re-render the page. This singleton
// stores the sorted event list + daysAhead per telegramId with a 5-minute
// TTL.  It is NOT persistent: a bot restart abandons any in-flight pagination
// state, and the user can just re-run /events. This matches the behaviour of
// setup-flow.ts (the location-setup flow).
//
// See also: setup-flow.ts

import { EventListing } from '../../core/entities/event-listing.js';

const TTL_MS = 5 * 60 * 1000;

interface PaginationEntry {
  readonly events: readonly EventListing[];
  readonly daysAhead: number;
  readonly expiresAt: number;
}

class EventsPaginationState {
  private readonly pending = new Map<number, PaginationEntry>();

  set(telegramId: number, events: readonly EventListing[], daysAhead: number, ttlMs: number = TTL_MS): void {
    this.pending.set(telegramId, { events, daysAhead, expiresAt: Date.now() + ttlMs });
  }

  // Returns null if missing or expired. Expired entries are evicted lazily.
  get(telegramId: number): { events: readonly EventListing[]; daysAhead: number } | null {
    const entry = this.pending.get(telegramId);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.pending.delete(telegramId);
      return null;
    }
    return { events: entry.events, daysAhead: entry.daysAhead };
  }

  clear(telegramId: number): void {
    this.pending.delete(telegramId);
  }
}

export const eventsPaginationState = new EventsPaginationState();
