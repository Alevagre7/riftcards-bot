import { EventListing } from '../../core/entities/event-listing.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { EventLocation } from '../../core/ports/event-repository.js';

export class FallbackEventListingRepository implements IEventListingRepository {
  constructor(
    private readonly primary: IEventListingRepository,
    private readonly fallback: IEventListingRepository,
    private readonly logger: (message: string, ...args: unknown[]) => void = console.error,
  ) {}

  async getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<EventListing[]> {
    try {
      return await this.primary.getEvents(startAfter, startBefore, location);
    } catch (error) {
      this.logger('[Events] Riftfound listing failed; using official V2 fallback:', error);
      return this.fallback.getEvents(startAfter, startBefore, location);
    }
  }
}
