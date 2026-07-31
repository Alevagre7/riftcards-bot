import { Event } from '../entities/event.js';
import { EventRegistration } from '../entities/event-registration.js';
import { EventDetail, EventPairing, EventStanding } from '../entities/event-detail.js';

// EventLocation is the per-call location passed to IEventRepository.
// The location may come from the user's saved preference, the global
// config default, or a one-off override (future feature). See
// ADR-0006 and the /events command implementation.
export interface EventLocation {
  readonly latitude: number;
  readonly longitude: number;
  // The upstream events API takes a radius in statute miles, so the
  // unit is encoded in the field name to avoid km/mile conversion
  // bugs at the call sites.
  readonly numMiles: number;
}

export interface IEventRepository {
  getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<Event[]>;

  getEventById(
    id: number,
    location: EventLocation,
  ): Promise<Event | null>;

  getEventRegistrations(
    id: number,
    location: EventLocation,
  ): Promise<EventRegistration[]>;

  /** Fetch the pairings for a specific round. Used by the leaderboard/
   *  all-tables handler to render a non-current round when the user
   *  navigates with the ←/→ round buttons. Returns an empty array
   *  when the round has no pairings (e.g. UPCOMING). */
  getEventMatches(roundId: number): Promise<EventPairing[]>;

  /** Fetch the standings for a specific round. Used by the leaderboard
   *  handler to render standings for a past round. Returns an empty
   *  array when the round has no standings yet. */
  getEventStandings(roundId: number): Promise<EventStanding[]>;

  /** Fetch the live detail bundle
   *  round's pairings/standings). Returns null if the event doesn't
   *  exist (404). Throws ApiResponseError / ApiTimeoutError on
   *  transient failures.
   *
   *  `options.fresh` — skip any in-adapter cache and don't write the
   *  result back. The watcher uses this to see round transitions the
   *  moment the upstream publishes them rather than reading a detail
   *  that was captured up to CACHE_TTL_MS earlier. */
  getEventDetail(
    id: number,
    location: EventLocation,
    options?: { fresh?: boolean },
  ): Promise<EventDetail | null>;
}
