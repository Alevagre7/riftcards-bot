import { z } from 'zod';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { Event } from '../../core/entities/event.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';

const EventApiSchema = z.object({
  name: z.string(),
  start_datetime: z.string(),
  end_datetime: z.string(),
  gameplay_format: z.object({
    name: z.string(),
  }).optional().nullable(),
  store: z.object({
    name: z.string(),
  }).optional().nullable(),
});

const EventsResponseSchema = z.object({
  results: z.array(EventApiSchema),
});

interface EventsAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
  latitude: number;
  longitude: number;
  numMiles: number;
}

export class EventsAdapter implements IEventRepository {
  constructor(private options: EventsAdapterOptions) {}

  private buildUrl(path: string, queryParams: URLSearchParams): string {
    const url = new URL(path, this.options.baseUrl);
    url.search = queryParams.toString();
    return url.toString();
  }

  async getEvents(startAfter: Date, startBefore: Date): Promise<Event[]> {
    const params = new URLSearchParams();
    params.set('start_date_after', startAfter.toISOString());
    params.set('start_date_before', startBefore.toISOString());
    params.set('display_statuses', 'upcoming');
    params.append('display_statuses', 'inProgress');
    params.set('game_slug', 'riftbound');
    params.set('latitude', String(this.options.latitude));
    params.set('longitude', String(this.options.longitude));
    params.set('num_miles', String(this.options.numMiles));
    params.set('upcoming_only', 'true');
    params.set('page', '1');
    params.set('page_size', '25');

    try {
      const response = await fetchWithRetry(
        this.buildUrl('/hydraproxy/api/v2/events/', params),
        {
          timeout: this.options.timeoutMs,
          retries: this.options.retryAttempts,
          headers: {
            Accept: '*/*',
            Origin: 'https://locator.riftbound.uvsgames.com',
          },
        },
      );

      if (!response.ok) {
        throw new ApiResponseError('Events API', response.status);
      }

      const json = await response.json();
      const parsed = EventsResponseSchema.parse(json);

      return parsed.results.map((api) => ({
        name: api.name,
        storeName: api.store?.name ?? '',
        startDate: new Date(api.start_datetime),
        endDate: new Date(api.end_datetime),
        format: api.gameplay_format?.name ?? '',
      }));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ApiTimeoutError('Events API');
    }
  }
}
