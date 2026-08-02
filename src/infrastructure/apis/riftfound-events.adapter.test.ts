import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiftfoundEventsAdapter } from './riftfound-events.adapter.js';
import { EventLocation } from '../../core/ports/event-repository.js';

const location: EventLocation = { latitude: 37.389416, longitude: -5.992558, numMiles: 25 };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function payload(data: unknown[]) {
  return { data, pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 } };
}

const base = {
  externalId: '762945',
  name: 'Seville Event',
  location: 'Long Store Name',
  startDate: '2026-08-02T10:00:00.000Z',
  endDate: '2026-08-02T15:00:00.000Z',
  eventType: 'Summoner Skirmish',
  playerCount: 8,
  capacity: 32,
};

describe('RiftfoundEventsAdapter', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftfoundEventsAdapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new RiftfoundEventsAdapter({
      baseUrl: 'https://www.riftfound.com/api',
      timeoutMs: 5000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the verified calendar query and maps listing modes and IDs', async () => {
    fetchSpy.mockResolvedValue(response(payload([
      base,
      { ...base, externalId: '2', eventType: 'Nexus Night' },
      { ...base, externalId: '3', eventType: 'Pre-Rift' },
      { ...base, externalId: '4', eventType: 'Unknown' },
    ])));

    const events = await adapter.getEvents(
      new Date('2026-07-25T22:00:00.000Z'),
      new Date('2026-09-05T22:00:00.000Z'),
      location,
    );

    const url = new URL(fetchSpy.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/events');
    expect(url.searchParams.get('calendarMode')).toBe('true');
    expect(url.searchParams.get('startDateFrom')).toBe('2026-07-25T22:00:00.000Z');
    expect(url.searchParams.get('startDateTo')).toBe('2026-09-05T22:00:00.000Z');
    expect(url.searchParams.get('lat')).toBe('37.389416');
    expect(url.searchParams.get('lng')).toBe('-5.992558');
    expect(Number(url.searchParams.get('radiusKm'))).toBeCloseTo(40.234, 3);
    expect(events.map((event) => [event.id, event.mode])).toEqual([
      [762945, 'Skirmish'], [2, 'Nexus Night'], [3, 'Pre-Rift'], [4, 'Other'],
    ]);
    expect(events[0]).toMatchObject({ storeName: 'Long Store Name', registeredCount: 8, capacity: 32 });
  });

  it('accepts a valid empty response', async () => {
    fetchSpy.mockResolvedValue(response(payload([])));
    await expect(adapter.getEvents(new Date(), new Date(), location)).resolves.toEqual([]);
  });

  it('rejects malformed external IDs and non-success responses', async () => {
    fetchSpy.mockResolvedValueOnce(response(payload([{ ...base, externalId: 'rift-762945' }])));
    await expect(adapter.getEvents(new Date(), new Date(), location)).rejects.toThrow('Schema parse failed');

    fetchSpy.mockResolvedValueOnce(response({}, 503));
    await expect(adapter.getEvents(new Date(), new Date(), location)).rejects.toThrow('status 503');
  });
});
