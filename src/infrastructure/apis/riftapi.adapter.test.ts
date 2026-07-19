import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RiftapiAdapter } from './riftapi.adapter.js';
import { RiftapiCard } from './riftapi-mapper.js';

// A minimal wire card; the mapper tests cover the field-by-field
// translation. The adapter tests only need to verify the right URLs
// are hit, the right envelope is parsed, and the right methods
// are called on the repository.
const wireCard: RiftapiCard = {
  id: 'ogn-011',
  name: 'Magma Wurm',
  riftbound_id: 'ogn-011',
  collector_number: 11,
  classification: { type: 'Unit', rarity: 'Common', domain: ['Fury'] },
  set: { set_id: 'OGN', label: 'Origins' },
};

const searchEnvelope = (cards: RiftapiCard[], total = cards.length) => ({
  items: cards,
  total,
  page: 1,
  size: cards.length,
  pages: 1,
});

function mockFetchOk(body: unknown, status = 200) {
  return vi.fn().mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function mockFetchSequence(bodies: Array<{ body: unknown; status?: number }>) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const next = bodies[i++];
    if (!next) throw new Error(`fetch called too many times (call #${i})`);
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

describe('RiftapiAdapter', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftapiAdapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new RiftapiAdapter({
      baseUrl: 'http://riftapi.test',
      timeoutMs: 1000,
      retryAttempts: 1,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searchCards hits /cards/search with the right query params', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify(searchEnvelope([wireCard])), { status: 200 }),
      ),
    );

    const result = await adapter.searchCards({ query: 'magma', limit: 5, page: 2 });

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]?.id).toBe('ogn-011/11');
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.hasMore).toBe(false);

    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    const u = new URL(calledUrl);
    expect(u.pathname).toBe('/cards/search');
    expect(u.searchParams.get('query')).toBe('magma');
    expect(u.searchParams.get('size')).toBe('5');
    expect(u.searchParams.get('page')).toBe('2');
  });

  it('searchCards returns empty result envelope when the upstream returns no items', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, page: 1, size: 0, pages: 0 }), { status: 200 })),
    );

    const result = await adapter.searchCards({ query: 'nothing' });
    expect(result.cards).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getCardById parses the composite key and resolves via the riftbound id', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify([wireCard]), { status: 200 })),
    );

    const card = await adapter.getCardById('ogn-011/11');

    expect(card?.id).toBe('ogn-011/11');
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    // The adapter strips the /collectorNumber half and delegates to
    // getCardByRiftboundId, which hits /cards/riftbound/{id}. The
    // mock returns an array (single-element) since that endpoint
    // returns a list.
    expect(new URL(calledUrl).pathname).toBe('/cards/riftbound/ogn-011');
  });

  it('getCardById treats a bare riftbound id (no slash) as the riftbound id half', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify([wireCard]), { status: 200 })),
    );

    // No slash in the id → treat the whole string as the riftbound
    // id. Lenient parsing: callers can pass either form. The
    // adapter then calls /cards/riftbound/{id} which returns an
    // array — so the mock returns a single-element array.
    const card = await adapter.getCardById('ogn-011');
    expect(card?.id).toBe('ogn-011/11');
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    // The adapter delegates to getCardByRiftboundId which hits
    // /cards/riftbound/{id} (returns an array, take the first).
    expect(new URL(calledUrl).pathname).toBe('/cards/riftbound/ogn-011');
  });

  it('getCardByRiftboundId returns the first match from the /cards/riftbound array', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify([wireCard]), { status: 200 })),
    );

    const card = await adapter.getCardByRiftboundId('ogn-011');
    expect(card?.id).toBe('ogn-011/11');
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    expect(new URL(calledUrl).pathname).toBe('/cards/riftbound/ogn-011');
  });

  it('getCardByRiftboundId returns null when the array is empty', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response('[]', { status: 200 })),
    );

    const card = await adapter.getCardByRiftboundId('unknown');
    expect(card).toBeNull();
  });

  it('getCardByName uses /cards/name?exact=', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify(searchEnvelope([wireCard])), { status: 200 })),
    );

    const card = await adapter.getCardByName('Magma Wurm');
    expect(card?.name).toBe('Magma Wurm');
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    const u = new URL(calledUrl);
    expect(u.pathname).toBe('/cards/name');
    expect(u.searchParams.get('exact')).toBe('Magma Wurm');
  });

  it('getCardByName returns null when no exact match', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [], total: 0, page: 1, size: 0, pages: 0 }), { status: 200 })),
    );

    expect(await adapter.getCardByName('Not A Card')).toBeNull();
  });

  it('getCardByTcgPlayerId always returns null (riftapi carries no tcgplayer_id)', async () => {
    expect(await adapter.getCardByTcgPlayerId('12345')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getRandomCard hits /cards/random and returns the mapped card', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify(wireCard), { status: 200 })),
    );

    const card = await adapter.getRandomCard();
    expect(card?.id).toBe('ogn-011/11');
    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    expect(new URL(calledUrl).pathname).toBe('/cards/random');
  });

  it('getSets hits /sets?size=100 and maps each entry', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            items: [
              { id: 'OGN', name: 'Origins', set_id: 'OGN', card_count: 352 },
              { id: 'UNL', name: 'Unleashed', set_id: 'UNL', card_count: 288 },
            ],
            total: 2,
            page: 1,
            size: 2,
            pages: 1,
          }),
          { status: 200 },
        ),
      ),
    );

    const sets = await adapter.getSets();
    expect(sets).toHaveLength(2);
    expect(sets[0]).toEqual({ id: 'OGN', code: 'OGN', name: 'Origins', cardCount: 352 });
  });

  it('returns null on a 404 response (no fetch error)', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response('not found', { status: 404 })),
    );

    expect(await adapter.getCardByRiftboundId('unknown')).toBeNull();
  });

  it('throws on a 500 response (server error)', async () => {
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response('boom', { status: 500 })),
    );

    await expect(adapter.getRandomCard()).rejects.toThrow();
  });
});
