import { Event } from '../entities/event.js';

export interface IEventRepository {
  getEvents(startAfter: Date, startBefore: Date): Promise<Event[]>;
}
