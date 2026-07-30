import { z } from 'zod';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const EventApiSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  start_datetime: z.string(),
  end_datetime: z.string(),
  store: z.object({
    name: z.string().nullable().optional().default(''),
    full_address: z.string().nullable().optional().default(''),
    website: z.string().nullable().optional().default(''),
    email: z.string().nullable().optional().default(''),
  }).nullable().optional(),
  gameplay_format: z.object({
    name: z.string().optional().default(''),
  }).nullable().optional(),
  event_type: z.string().optional().default(''),
  tournament_phases: z.array(z.object({
    first_round_type: z.string().optional().default(''),
  })).optional().default([]),
  registered_user_count: z.coerce.number().optional().default(0),
  capacity: z.coerce.number().optional().default(0),
  cost_in_cents: z.coerce.number().optional().default(0),
  currency: z.string().optional().default(''),
}).passthrough();

const EventsResponseSchema = z.object({
  results: z.array(EventApiSchema),
});

const EventRegistrationItemSchema = z.object({
  best_identifier: z.string().optional().default(''),
  registration_status: z.string().optional().default(''),
}).passthrough();

const EventRegistrationsResponseSchema = z.object({
  results: z.array(EventRegistrationItemSchema),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeMeetingType(raw: string): string {
  return raw === 'PLAYER_MEETING' ? 'Player Meeting' : '';
}

function buildLocatorUrl(id: string): string {
  return `https://locator.riftbound.uvsgames.com/events/${id}`;
}

function normalizeRegistrationStatus(raw: string): string {
  switch (raw) {
    case 'COMPLETE':
      return 'Registered';
    case 'PENDING':
      return 'Pending';
    case 'CANCELLED':
      return 'Cancelled';
    case 'WAITLIST':
      return 'Waitlist';
    default:
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapApiEvent(api: z.infer<typeof EventApiSchema>): Event {
  const firstRoundType = api.tournament_phases[0]?.first_round_type ?? '';
  return {
    id: String(api.id),
    name: api.name,
    storeName: api.store?.name ?? '',
    storeAddress: api.store?.full_address ?? '',
    storeWebsite: api.store?.website ?? '',
    storeEmail: api.store?.email ?? '',
    startDate: new Date(api.start_datetime),
    endDate: new Date(api.end_datetime),
    format: api.gameplay_format?.name ?? '',
    category: api.event_type ?? '',
    meetingType: normalizeMeetingType(firstRoundType),
    capacity: {
      registered: api.registered_user_count,
      max: api.capacity,
    },
    isFree: api.cost_in_cents === 0,
    costAmount: api.cost_in_cents === 0 ? null : api.cost_in_cents / 100,
    costCurrency: api.currency ?? '',
    locatorUrl: buildLocatorUrl(String(api.id)),
    eventType: '',
    price: '',
    description: '',
    imageUrl: '',
    externalUrl: null,
    locatorEventId: api.id,
  };
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

interface EventsAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

// EventsAdapter no longer takes a location in its constructor. The
// location is per-user now (see ADR-0006) and is supplied at every
// getEvents() call. The adapter itself is otherwise stateless.
export class EventsAdapter implements IEventRepository {
  constructor(private options: EventsAdapterOptions) {}

  private buildUrl(path: string, queryParams: URLSearchParams): string {
    const url = new URL(path, this.options.baseUrl);
    url.search = queryParams.toString();
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    return {
      Accept: '*/*',
      Origin: 'https://locator.riftbound.uvsgames.com',
    };
  }

  async getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<Event[]> {
    const params = new URLSearchParams();
    params.set('start_date_after', startAfter.toISOString());
    params.set('start_date_before', startBefore.toISOString());
    params.set('display_statuses', 'upcoming');
    params.append('display_statuses', 'inProgress');
    params.set('game_slug', 'riftbound');
    params.set('latitude', String(location.latitude));
    params.set('longitude', String(location.longitude));
    params.set('num_miles', String(Math.round(location.numMiles)));
    params.set('upcoming_only', 'true');
    params.set('page', '1');
    params.set('page_size', '25');

    try {
      const response = await fetchWithRetry(
        this.buildUrl('/hydraproxy/api/v2/events/', params),
        {
          timeout: this.options.timeoutMs,
          retries: this.options.retryAttempts,
          headers: this.buildHeaders(),
        },
      );

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const snippet = body.slice(0, 500);
        console.error(`[Events API] status=${response.status} body=${snippet}`);
        throw new ApiResponseError('Events API', response.status, snippet);
      }

      const json = await response.json();
      const parsed = EventsResponseSchema.parse(json);

      return parsed.results.map(mapApiEvent);
    } catch (error) {
      if (error instanceof DomainError) throw error;

      // Log the actual error before masking — the catch block swallows
      // the original cause, which is why the previous deployment's
      // "timeout" message was untrustworthy.
      console.error(`[Events API] getEvents error:`, error);

      // AbortError is the real timeout signal from AbortController
      // (see src/utils/api-client.ts — setTimeout → controller.abort()).
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiTimeoutError('Events API');
      }

      // ZodError means the upstream changed its response shape; the
      // request succeeded but parsing failed. Surface as 502-style
      // ApiResponseError (not a user-facing "timeout" — that would
      // mislead both the user and the operator reading the logs).
      if (error instanceof z.ZodError) {
        const snippet = error.message.slice(0, 200);
        throw new ApiResponseError('Events API', 502, `Schema parse failed: ${snippet}`);
      }

      // Network/DNS/other failures — still report as timeout to the
      // user (the symptom is the same: no response), but the log line
      // above carries the real cause.
      throw new ApiTimeoutError('Events API');
    }
  }

  async getEventById(
    id: string,
    location: EventLocation,
  ): Promise<Event | null> {
    const url = `${this.options.baseUrl}/hydraproxy/api/v2/events/${encodeURIComponent(id)}`;

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
        console.error(`[Events API] getEventById status=${response.status} body=${snippet}`);
        throw new ApiResponseError('Events API', response.status, snippet);
      }

      const json = await response.json();
      const parsed = EventApiSchema.parse(json);
      return mapApiEvent(parsed);
    } catch (error) {
      if (error instanceof DomainError) throw error;

      // Log the actual error before masking — the catch block swallows
      // the original cause, which is why the previous deployment's
      // "timeout" message was untrustworthy.
      console.error(`[Events API] getEventById error:`, error);

      // AbortError is the real timeout signal from AbortController
      // (see src/utils/api-client.ts — setTimeout → controller.abort()).
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiTimeoutError('Events API');
      }

      // ZodError means the upstream changed its response shape; the
      // request succeeded but parsing failed. Surface as 502-style
      // ApiResponseError (not a user-facing "timeout" — that would
      // mislead both the user and the operator reading the logs).
      if (error instanceof z.ZodError) {
        const snippet = error.message.slice(0, 200);
        throw new ApiResponseError('Events API', 502, `Schema parse failed: ${snippet}`);
      }

      // Network/DNS/other failures — still report as timeout to the
      // user (the symptom is the same: no response), but the log line
      // above carries the real cause.
      throw new ApiTimeoutError('Events API');
    }
  }

  async getEventRegistrations(
    id: string,
    _location: EventLocation,
  ): Promise<EventRegistration[]> {
    const url = `${this.options.baseUrl}/hydraproxy/api/v2/events/${encodeURIComponent(id)}/registrations`;

    try {
      const response = await fetchWithRetry(url, {
        timeout: this.options.timeoutMs,
        retries: this.options.retryAttempts,
        headers: this.buildHeaders(),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const snippet = body.slice(0, 500);
        console.error(`[Events API] getEventRegistrations status=${response.status} body=${snippet}`);
        throw new ApiResponseError('Events API', response.status, snippet);
      }

      const json = await response.json();
      const parsed = EventRegistrationsResponseSchema.parse(json);
      return parsed.results.map((item) => ({
        name: item.best_identifier ?? '',
        status: normalizeRegistrationStatus(item.registration_status ?? ''),
      }));
    } catch (error) {
      if (error instanceof DomainError) throw error;

      // Log the actual error before masking — the catch block swallows
      // the original cause, which is why the previous deployment's
      // "timeout" message was untrustworthy.
      console.error(`[Events API] getEventRegistrations error:`, error);

      // AbortError is the real timeout signal from AbortController
      // (see src/utils/api-client.ts — setTimeout → controller.abort()).
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiTimeoutError('Events API');
      }

      // ZodError means the upstream changed its response shape; the
      // request succeeded but parsing failed. Surface as 502-style
      // ApiResponseError (not a user-facing "timeout" — that would
      // mislead both the user and the operator reading the logs).
      if (error instanceof z.ZodError) {
        const snippet = error.message.slice(0, 200);
        throw new ApiResponseError('Events API', 502, `Schema parse failed: ${snippet}`);
      }

      // Network/DNS/other failures — still report as timeout to the
      // user (the symptom is the same: no response), but the log line
      // above carries the real cause.
      throw new ApiTimeoutError('Events API');
    }
  }
}
