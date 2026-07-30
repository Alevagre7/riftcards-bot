import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiftfoundAdapter } from './riftfound.adapter.js';
import { EventLocation } from '../../core/ports/event-repository.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseLocation: EventLocation = {
  latitude: 37.39,
  longitude: -5.99,
  numMiles: 50,
};

const realisticRiftfoundEvent = {
  id: '123456',
  externalId: '',
  name: 'Weekly Riftbound Tournament',
  description: 'Join us for our weekly Riftbound tournament. Packs and promos for top players!',
  location: 'Card Castle',
  address: '123 Main St, Seville, Spain',
  city: 'Seville',
  state: null,
  country: 'Spain',
  latitude: 37.39,
  longitude: -5.99,
  startDate: '2026-07-29T18:00:00.000Z',
  startTime: '18:00',
  endDate: '2026-07-29T22:00:00.000Z',
  eventType: 'Nexus Night',
  organizer: 'Card Castle',
  playerCount: 8,
  capacity: 32,
  price: 'Free',
  url: null,
  imageUrl: 'https://www.riftfound.com/banners/event.jpg',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
  scrapedAt: '2026-07-28T12:00:00.000Z',
  shopLatitude: 37.39,
  shopLongitude: -5.99,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RiftfoundAdapter.getEvents', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftfoundAdapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new RiftfoundAdapter({
      baseUrl: 'https://www.riftfound.com',
      timeoutMs: 5000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs the correct URL with all query params', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const startAfter = new Date('2026-07-29T00:00:00.000Z');
    const startBefore = new Date('2026-08-05T00:00:00.000Z');

    await adapter.getEvents(startAfter, startBefore, baseLocation);

    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    const u = new URL(calledUrl);

    expect(u.pathname).toBe('/api/events');
    expect(u.searchParams.get('calendarMode')).toBe('true');
    expect(u.searchParams.get('startDateFrom')).toBe(startAfter.toISOString());
    expect(u.searchParams.get('startDateTo')).toBe(startBefore.toISOString());
    expect(u.searchParams.get('lat')).toBe('37.39');
    expect(u.searchParams.get('lng')).toBe('-5.99');
    // 50 miles → 80.467... → Math.round → 80
    expect(u.searchParams.get('radiusKm')).toBe('80');
    // No eventType filter — the bot shows all event types
    expect(u.searchParams.has('eventType')).toBe(false);
  });

  it('maps a realistic riftfound payload to Event', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: [realisticRiftfoundEvent] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const events = await adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    expect(events).toHaveLength(1);
    const ev = events[0]!;

    // Core fields
    expect(ev.id).toBe('123456');
    expect(ev.name).toBe('Weekly Riftbound Tournament');
    expect(ev.storeName).toBe('Card Castle'); // organizer
    expect(ev.storeAddress).toBe('123 Main St, Seville, Spain');
    expect(ev.startDate).toEqual(new Date('2026-07-29T18:00:00.000Z'));
    expect(ev.endDate).toEqual(new Date('2026-07-29T22:00:00.000Z'));

    // New riftfound-specific fields
    expect(ev.eventType).toBe('Nexus Night');
    expect(ev.price).toBe('Free');
    expect(ev.description).toBe(
      'Join us for our weekly Riftbound tournament. Packs and promos for top players!',
    );
    expect(ev.imageUrl).toBe('https://www.riftfound.com/banners/event.jpg');
    expect(ev.externalUrl).toBeNull();

    // Derived fields
    expect(ev.isFree).toBe(true);
    expect(ev.capacity.registered).toBe(8);
    expect(ev.capacity.max).toBe(32);
    expect(ev.storeWebsite).toBe('');
    expect(ev.storeEmail).toBe('');
    expect(ev.format).toBe('');
    expect(ev.category).toBe('');
    expect(ev.meetingType).toBe('');
    expect(ev.costAmount).toBeNull();
    expect(ev.costCurrency).toBe('');

    // Locator URL (riftfound event page)
    expect(ev.locatorUrl).toBe('https://locator.riftbound.uvsgames.com/events/123456');
  });

  it('uses organizer as storeName when organizer is set', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              ...realisticRiftfoundEvent,
              organizer: 'Empire Games',
              location: 'Old Location',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const events = await adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    expect(events[0]!.storeName).toBe('Empire Games');
  });

  it('falls back to location when organizer is empty', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              ...realisticRiftfoundEvent,
              organizer: '',
              location: 'Fallback Shop',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const events = await adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    expect(events[0]!.storeName).toBe('Fallback Shop');
  });

  it('does not send eventType param', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    const u = new URL(calledUrl);
    expect(u.searchParams.has('eventType')).toBe(false);
  });
});

describe('RiftfoundAdapter.getEventById', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftfoundAdapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new RiftfoundAdapter({
      baseUrl: 'https://www.riftfound.com',
      timeoutMs: 5000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when response is HTML (SPA for unknown ID)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<html><body>Riftbound</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const result = await adapter.getEventById('unknown-id', baseLocation);
    expect(result).toBeNull();
  });

  it('returns null when 404', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const result = await adapter.getEventById('nonexistent', baseLocation);
    expect(result).toBeNull();
  });

  it('returns null when JSON envelope id does not match requested id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { ...realisticRiftfoundEvent, id: 'different-id' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await adapter.getEventById('requested-id', baseLocation);
    expect(result).toBeNull();
  });

  it('maps and returns event when 200 + matching JSON', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: realisticRiftfoundEvent }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await adapter.getEventById('123456', baseLocation);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('123456');
    expect(result!.name).toBe('Weekly Riftbound Tournament');
    expect(result!.eventType).toBe('Nexus Night');
  });

  it('handles direct event object (no data envelope) and matching id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(realisticRiftfoundEvent),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await adapter.getEventById('123456', baseLocation);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('123456');
  });
});

describe('RiftfoundAdapter.getEventRegistrations', () => {
  let adapter: RiftfoundAdapter;

  it('throws ApiResponseError(404) with unsupported message', async () => {
    adapter = new RiftfoundAdapter({
      baseUrl: 'https://www.riftfound.com',
      timeoutMs: 5000,
      retryAttempts: 1,
    });

    await expect(
      adapter.getEventRegistrations('123456', baseLocation),
    ).rejects.toThrow(ApiResponseError);

    await expect(
      adapter.getEventRegistrations('123456', baseLocation),
    ).rejects.toThrow('Registrations not supported');
  });
});

describe('RiftfoundAdapter error handling', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftfoundAdapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new RiftfoundAdapter({
      baseUrl: 'https://www.riftfound.com',
      timeoutMs: 5000,
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

  it('ZodError → ApiResponseError(502) on list response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { id: 123, name: 'Bad type for data' } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
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

  it('5xx → ApiResponseError with status code', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', {
        status: 503,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const promise = adapter.getEvents(
      new Date('2026-07-29T00:00:00.000Z'),
      new Date('2026-08-05T00:00:00.000Z'),
      baseLocation,
    );

    await expect(promise).rejects.toThrow(ApiResponseError);
    await expect(promise).rejects.toThrow('503');
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
      '[Riftfound API] getEvents error:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
