import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';

// ---------------------------------------------------------------------------
// FallbackEventsAdapter
// ---------------------------------------------------------------------------

// Composite adapter that wraps the riftfound adapter (primary) and the old
// EventsAdapter (fallback). Implements IEventRepository so the command
// handler is unaware of the fallback.
//
// Failure modes captured: timeout, 5xx, ZodError, network — all caught by
// the try/catch. The fallback's own throws are NOT caught here — if both
// fail, the user sees a real error and the operator gets the real log.

export class FallbackEventsAdapter implements IEventRepository {
  constructor(
    private primary: IEventRepository,
    private fallback: IEventRepository,
  ) {}

  async getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<Event[]> {
    try {
      return await this.primary.getEvents(startAfter, startBefore, location);
    } catch (error) {
      console.warn('[Events] riftfound failed, falling back to old API:', error);
      return await this.fallback.getEvents(startAfter, startBefore, location);
    }
  }

  async getEventById(
    id: string,
    location: EventLocation,
  ): Promise<Event | null> {
    try {
      const result = await this.primary.getEventById(id, location);
      if (result != null) return result;
      // primary returned null — try fallback (handles the case where the
      // list was served by fallback but the detail fetch hit a different
      // path, and any stale-IDs case)
      return await this.fallback.getEventById(id, location);
    } catch (error) {
      console.warn('[Events] riftfound getEventById failed, falling back:', error);
      return await this.fallback.getEventById(id, location);
    }
  }

  async getEventRegistrations(
    id: string,
    location: EventLocation,
  ): Promise<EventRegistration[]> {
    // Only the fallback supports registrations. For riftfound IDs the old
    // API will 404; the caller's .catch converts that to 'unavailable' for
    // the detail view.
    return await this.fallback.getEventRegistrations(id, location);
  }
}
