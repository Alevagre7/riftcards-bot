import { Event } from '../entities/event.js';

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
}
