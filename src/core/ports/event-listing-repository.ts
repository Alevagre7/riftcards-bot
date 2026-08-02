import { EventListing } from '../entities/event-listing.js';
import { EventLocation } from './event-repository.js';

export interface IEventListingRepository {
  getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<EventListing[]>;
}
