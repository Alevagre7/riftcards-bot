import { z } from 'zod';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';
import { milesToKm } from '../../utils/units.js';

// ---------------------------------------------------------------------------
// Zod schemas (riftfound wire format)
// ---------------------------------------------------------------------------

const RiftfoundEventApiSchema = z.object({
  id: z.string(),
  externalId: z.string().optional().default(''),
  name: z.string(),
  description: z.string().optional().default(''),
  location: z.string().optional().default(''),
  address: z.string().optional().default(''),
  city: z.string().nullable().optional().default(null),
  state: z.string().nullable().optional().default(null),
  country: z.string().nullable().optional().default(null),
  latitude: z.coerce.number().optional().default(0),
  longitude: z.coerce.number().optional().default(0),
  startDate: z.string(),
  startTime: z.string().nullable().optional().default(null),
  endDate: z.string(),
  eventType: z.string().optional().default(''),
  organizer: z.string().optional().default(''),
  playerCount: z.coerce.number().optional().default(0),
  capacity: z.coerce.number().optional().default(0),
  price: z.string().optional().default(''),
  url: z.string().nullable().optional().default(null),
  imageUrl: z.string().optional().default(''),
  createdAt: z.string().optional().default(''),
  updatedAt: z.string().optional().default(''),
  scrapedAt: z.string().optional().default(''),
  shopLatitude: z.coerce.number().optional().default(0),
  shopLongitude: z.coerce.number().optional().default(0),
}).passthrough();

const RiftfoundListResponseSchema = z.object({
  data: z.array(RiftfoundEventApiSchema),
});

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRiftfoundEvent(api: z.infer<typeof RiftfoundEventApiSchema>): Event {
  return {
    id: api.id,
    name: api.name,
    storeName: api.organizer || api.location,
    storeAddress: api.address,
    storeWebsite: '',
    storeEmail: '',
    startDate: new Date(api.startDate),
    endDate: new Date(api.endDate),
    format: '',
    category: '',
    eventType: api.eventType,
    meetingType: '',
    capacity: { registered: api.playerCount, max: api.capacity },
    isFree: api.price.toLowerCase() === 'free',
    costAmount: null,
    costCurrency: '',
    price: api.price,
    description: api.description,
    imageUrl: api.imageUrl,
    externalUrl: api.url,
    locatorUrl: `https://locator.riftbound.uvsgames.com/events/${api.id}`,
    locatorEventId: Number(api.id),
  };
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

interface RiftfoundAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RiftfoundAdapter implements IEventRepository {
  constructor(private options: RiftfoundAdapterOptions) {}

  private buildUrl(path: string, queryParams: URLSearchParams): string {
    const url = new URL(path, this.options.baseUrl);
    url.search = queryParams.toString();
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
    };
  }

  async getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<Event[]> {
    const params = new URLSearchParams();
    params.set('calendarMode', 'true');
    params.set('startDateFrom', startAfter.toISOString());
    params.set('startDateTo', startBefore.toISOString());
    params.set('lat', String(location.latitude));
    params.set('lng', String(location.longitude));
    params.set('radiusKm', String(Math.round(milesToKm(location.numMiles))));

    try {
      const response = await fetchWithRetry(
        this.buildUrl('/api/events', params),
        {
          timeout: this.options.timeoutMs,
          retries: this.options.retryAttempts,
          headers: this.buildHeaders(),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const snippet = body.slice(0, 500);
        console.error(`[Riftfound API] getEvents status=${response.status} body=${snippet}`);
        throw new ApiResponseError('Riftfound API', response.status, snippet);
      }

      const json = await response.json();
      const parsed = RiftfoundListResponseSchema.parse(json);

      return parsed.data.map(mapRiftfoundEvent);
    } catch (error) {
      if (error instanceof DomainError) throw error;

      console.error(`[Riftfound API] getEvents error:`, error);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiTimeoutError('Riftfound API');
      }

      if (error instanceof z.ZodError) {
        const snippet = error.message.slice(0, 200);
        throw new ApiResponseError('Riftfound API', 502, `Schema parse failed: ${snippet}`);
      }

      throw new ApiTimeoutError('Riftfound API');
    }
  }

  async getEventById(
    id: string,
    _location: EventLocation,
  ): Promise<Event | null> {
    const url = `${this.options.baseUrl}/api/events/${encodeURIComponent(id)}`;

    try {
      const response = await fetchWithRetry(url, {
        timeout: this.options.timeoutMs,
        retries: this.options.retryAttempts,
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        const body = await response.text().catch(() => '');
        const snippet = body.slice(0, 500);
        console.error(`[Riftfound API] getEventById status=${response.status} body=${snippet}`);
        throw new ApiResponseError('Riftfound API', response.status, snippet);
      }

      // The upstream SPA serves index.html (HTTP 200) for unknown IDs.
      // Try parsing as JSON; if it fails OR the id doesn't match, return null.
      let parsed: z.infer<typeof RiftfoundEventApiSchema>;
      try {
        const json = await response.json();
        // Accept both { data: { ... } } envelope and the event object directly
        const data = 'data' in json ? json.data : json;
        parsed = RiftfoundEventApiSchema.parse(data);
      } catch {
        // Not JSON → HTML page for unknown ID
        return null;
      }

      if (parsed.id !== id) return null;

      return mapRiftfoundEvent(parsed);
    } catch (error) {
      if (error instanceof DomainError) throw error;

      console.error(`[Riftfound API] getEventById error:`, error);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiTimeoutError('Riftfound API');
      }

      if (error instanceof z.ZodError) {
        const snippet = error.message.slice(0, 200);
        throw new ApiResponseError('Riftfound API', 502, `Schema parse failed: ${snippet}`);
      }

      throw new ApiTimeoutError('Riftfound API');
    }
  }

  async getEventRegistrations(
    _id: string,
    _location: EventLocation,
  ): Promise<EventRegistration[]> {
    // riftfound has no registrations endpoint.
    // Throwing matches the existing .catch in the events command which
    // converts ApiResponseError to 'unavailable' for the detail view.
    throw new ApiResponseError('Riftfound API', 404, 'Registrations not supported');
  }
}
