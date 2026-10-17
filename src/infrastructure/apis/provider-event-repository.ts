import type { EventId, RoundId } from '../../core/entities/event-id.js';
import type { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';

/** Retain old UVS watches without ever falling back from a Riot request. */
export class ProviderEventRepository implements IEventRepository {
  constructor(private readonly riot: IEventRepository, private readonly legacy: IEventRepository) {}

  private repository(id: EventId | RoundId): IEventRepository {
    return typeof id === 'number' ? this.legacy : this.riot;
  }

  getEventById(id: EventId, location: EventLocation) {
    return this.repository(id).getEventById(id, location);
  }

  getEventRegistrations(id: EventId, location: EventLocation) {
    return this.repository(id).getEventRegistrations(id, location);
  }

  getEventDetail(id: EventId, location: EventLocation, options?: { fresh?: boolean }) {
    return this.repository(id).getEventDetail(id, location, options);
  }

  getEventMatches(id: RoundId) {
    return this.repository(id).getEventMatches(id);
  }

  getEventStandings(id: RoundId) {
    return this.repository(id).getEventStandings(id);
  }
}
