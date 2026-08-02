import { z } from 'zod';
import { EventListing, normalizeEventMode } from '../../core/entities/event-listing.js';
import { EventLocation } from '../../core/ports/event-repository.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { ApiResponseError, ApiTimeoutError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';
import { milesToKm } from '../../utils/units.js';

const RiftfoundEventSchema = z.object({
  externalId: z.string().regex(/^\d+$/),
  name: z.string(),
  location: z.string().nullable().transform((value) => value ?? ''),
  startDate: z.string(),
  endDate: z.string(),
  eventType: z.string().nullable().transform((value) => value ?? ''),
  playerCount: z.number(),
  capacity: z.number(),
});

const RiftfoundResponseSchema = z.object({
  data: z.array(RiftfoundEventSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

const MAX_PAGES = 100;

interface RiftfoundEventsAdapterOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
}

export class RiftfoundEventsAdapter implements IEventListingRepository {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;

  constructor(options: RiftfoundEventsAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.retryAttempts = options.retryAttempts;
  }

  async getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<EventListing[]> {
    const allEvents: EventListing[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_PAGES) {
      const params = new URLSearchParams();
      params.set('calendarMode', 'true');
      params.set('startDateFrom', startAfter.toISOString());
      params.set('startDateTo', startBefore.toISOString());
      params.set('lat', String(location.latitude));
      params.set('lng', String(location.longitude));
      params.set('radiusKm', String(milesToKm(location.numMiles)));
      params.set('page', String(page));
      const url = new URL('events', `${this.baseUrl}/`);
      url.search = params.toString();

      const parsed = await this.fetchPage(url.toString());
      totalPages = Math.max(1, parsed.pagination.totalPages);
      allEvents.push(
        ...parsed.data.map((event) => ({
          id: Number(event.externalId),
          name: event.name,
          startDatetime: event.startDate,
          endDatetime: event.endDate,
          mode: normalizeEventMode(event.eventType),
          storeName: event.location,
          registeredCount: event.playerCount,
          capacity: event.capacity,
        })),
      );
      page += 1;
    }

    return allEvents;
  }

  private async fetchPage(url: string): Promise<z.infer<typeof RiftfoundResponseSchema>> {
    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        timeout: this.timeoutMs,
        retries: this.retryAttempts,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ApiTimeoutError('Riftfound');
    }

    if (!response.ok) {
      throw new ApiResponseError('Riftfound', response.status);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ApiResponseError('Riftfound', 502, 'Invalid JSON response');
    }

    try {
      return RiftfoundResponseSchema.parse(json);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ApiResponseError('Riftfound', 502, `Schema parse failed: ${error.message.slice(0, 200)}`);
      }
      throw error;
    }
  }
}
