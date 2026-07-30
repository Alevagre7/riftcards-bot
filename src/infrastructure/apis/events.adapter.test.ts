import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EventsAdapter } from './events.adapter.js';
import { EventLocation } from '../../core/ports/event-repository.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';

// Test the Zod schemas from the adapter by re-declaring them inline
// so they stay decoupled from the adapter file.

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

// Realistic wire payload based on upstream API shape
const realisticPayload = {
  id: 1234,
  name: 'Weekly Riftbound Tournament',
  start_datetime: '2026-07-21T17:00:00Z',
  end_datetime: '2026-07-21T20:30:00Z',
  store: {
    name: 'The Card Shop',
    full_address: '456 Gaming Ave, Seville, Spain',
    website: 'https://thecardshop.example.com',
    email: 'events@thecardshop.example.com',
  },
  gameplay_format: {
    name: 'Standard',
  },
  event_type: 'LOCALS',
  tournament_phases: [
    { first_round_type: 'PLAYER_MEETING' },
  ],
  registered_user_count: 12,
  capacity: 40,
  cost_in_cents: 0,
  currency: 'EUR',
};

describe('Events API Zod schema', () => {
  it('validates a realistic wire payload', () => {
    const result = EventApiSchema.parse(realisticPayload);
    expect(result.name).toBe('Weekly Riftbound Tournament');
    expect(result.id).toBe(1234);
    expect(result.store?.name).toBe('The Card Shop');
    expect(result.store?.full_address).toBe('456 Gaming Ave, Seville, Spain');
    expect(result.event_type).toBe('LOCALS');
    expect(result.tournament_phases[0]?.first_round_type).toBe('PLAYER_MEETING');
    expect(result.registered_user_count).toBe(12);
    expect(result.capacity).toBe(40);
    expect(result.cost_in_cents).toBe(0);
    expect(result.currency).toBe('EUR');
  });

  it('handles missing optional fields with defaults', () => {
    const minimal = {
      id: 1,
      name: 'Test',
      start_datetime: '2026-07-21T00:00:00Z',
      end_datetime: '2026-07-21T01:00:00Z',
      registered_user_count: 0,
      capacity: 0,
      cost_in_cents: 0,
    };
    const result = EventApiSchema.parse(minimal);
    // When the key is absent, .optional().nullable() results in undefined
    expect(result.store).toBeUndefined();
    expect(result.gameplay_format).toBeUndefined();
    expect(result.event_type).toBe('');
    expect(result.tournament_phases).toEqual([]);
    expect(result.currency).toBe('');
  });

  it('handles null store and gameplay_format', () => {
    const payload = {
      ...realisticPayload,
      store: null,
      gameplay_format: null,
    };
    const result = EventApiSchema.parse(payload);
    expect(result.store).toBeNull();
    expect(result.gameplay_format).toBeNull();
  });

  it('accepts null store sub-fields (website, email, etc.)', () => {
    // Upstream API returns null for store.website (and other fields)
    // when the store has no website. The schema accepts null via
    // .nullable(); the mapper handles it with ?? '' at runtime.
    const payload = {
      ...realisticPayload,
      store: {
        ...realisticPayload.store,
        name: null,
        full_address: null,
        website: null,
        email: null,
      },
    };
    const result = EventApiSchema.parse(payload);
    // Schema returns null (not '') because .default() only fires
    // for undefined, not null. The mapper normalizes via ?? ''.
    expect(result.store?.name).toBeNull();
    expect(result.store?.full_address).toBeNull();
    expect(result.store?.website).toBeNull();
    expect(result.store?.email).toBeNull();
  });

  it('coerces string numbers to numbers', () => {
    const payload = {
      ...realisticPayload,
      id: '5678' as unknown as number,
      registered_user_count: '5' as unknown as number,
      capacity: '20' as unknown as number,
      cost_in_cents: '1500' as unknown as number,
    };
    const result = EventApiSchema.parse(payload);
    expect(result.id).toBe(5678);
    expect(result.registered_user_count).toBe(5);
    expect(result.capacity).toBe(20);
    expect(result.cost_in_cents).toBe(1500);
  });
});

describe('EventsAdapter.getEvents', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: EventsAdapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new EventsAdapter({
      baseUrl: 'https://events.test',
      timeoutMs: 1000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rounds num_miles to an integer in the query string', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const location: EventLocation = {
      latitude: 37.39,
      longitude: -5.99,
      numMiles: 49.70968,
    };

    await adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      location,
    );

    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    const u = new URL(calledUrl);
    expect(u.searchParams.get('num_miles')).toBe('50');
  });

  it('maps api event with defaults for new riftfound fields', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            results: [realisticPayload],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    );

    const location: EventLocation = {
      latitude: 37.39,
      longitude: -5.99,
      numMiles: 50,
    };

    const events = await adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      location,
    );

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.eventType).toBe('');
    expect(ev.price).toBe('');
    expect(ev.description).toBe('');
    expect(ev.imageUrl).toBe('');
    expect(ev.externalUrl).toBeNull();
  });

  it('throws ApiResponseError on a non-2xx response', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const location: EventLocation = {
      latitude: 37.39,
      longitude: -5.99,
      numMiles: 50,
    };

    await expect(
      adapter.getEvents(
        new Date('2026-07-29T00:00:00.000Z'),
        new Date('2026-08-05T00:00:00.000Z'),
        location,
      ),
    ).rejects.toThrow('Events API API returned status 404');
  });
});

describe('error handling', () => {
  let adapter: EventsAdapter;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const baseLocation: EventLocation = {
    latitude: 37.39,
    longitude: -5.99,
    numMiles: 50,
  };

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new EventsAdapter({
      baseUrl: 'https://test.api',
      timeoutMs: 1000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AbortError → ApiTimeoutError', async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );

    await expect(
      adapter.getEvents(
        new Date('2026-07-29T00:00:00.000Z'),
        new Date('2026-08-05T00:00:00.000Z'),
        baseLocation,
      ),
    ).rejects.toThrow(ApiTimeoutError);
  });

  it('ZodError → ApiResponseError (502)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ results: [{ id: 'not-a-number' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const promise = adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    await expect(promise).rejects.toThrow(ApiResponseError);
    await expect(promise).rejects.toThrow('Schema parse failed');
  });

  it('Generic Error → ApiTimeoutError with console.error log', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const promise = adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    await expect(promise).rejects.toThrow(ApiTimeoutError);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Events API] getEvents error:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
