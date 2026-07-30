// LocatorHtmlAdapter tests — parse the recorded fixture HTML.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LocatorHtmlAdapter } from './locator.adapter.js';
import { ApiResponseError } from '../../core/errors/index.js';

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  '__fixtures__/locator-event-735205.html',
);

function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(): LocatorHtmlAdapter {
  return new LocatorHtmlAdapter({
    baseUrl: 'https://locator.riftbound.uvsgames.com',
    timeoutMs: 5000,
    retryAttempts: 1,
  });
}

// Creates a mock that returns a fresh Response for each call
function stubFetch(
  fetchSpy: ReturnType<typeof vi.fn>,
  status: number,
  body: string,
): void {
  fetchSpy.mockImplementation(() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { 'content-type': 'text/html' },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocatorHtmlAdapter', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getEventData', () => {
    it('parses 5 pairings from a single page', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      expect(data).not.toBeNull();
      expect(data!.eventId).toBe(735205);
      expect(data!.name).toBe('Wednesday Evening Nexus Night');
      expect(data!.currentRound).toBe(2);
      expect(data!.pairings.length).toBe(5);
      expect(Array.isArray(data!.standings)).toBe(true);

      // Verify individual pairings
      const table1 = data!.pairings.find((p) => p.tableNumber === 1)!;
      expect(table1).toBeDefined();
      expect([table1.player1, table1.player2]).toContain('TheLastBed');
      expect([table1.player1, table1.player2]).toContain('soul');
    });

    it('parses the roster', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      expect(data).not.toBeNull();
      // The fixture has 12 players; page 1 shows 10 (pagination limitation)
      expect(data!.roster.length).toBeGreaterThanOrEqual(10);

      // Known roster entries
      const names = data!.roster.map((r) => r.displayName);
      expect(names).toContain('soul');
      expect(names).toContain('TheLastBed');
      expect(names).toContain('ScoobertDoobert');

      // Statuses
      const dropped = data!.roster.filter((r) => r.status === 'Dropped');
      expect(dropped.length).toBeGreaterThan(0);
    });

    it('de-duplicates mirrored pairings', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      // Each pairing appears twice in the HTML (mirror layout);
      // the adapter must de-dup to 5 unique pairings.
      expect(data!.pairings.length).toBe(5);

      // No duplicate table numbers with same players
      const keys = data!.pairings.map(
        (p) => `${p.tableNumber}:${[p.player1, p.player2].sort().join('|')}`,
      );
      expect(new Set(keys).size).toBe(5);
    });

    it('parses standings from RSC flight data', async () => {
      const syntheticHtml =
        '<html><body>'
        + '<h1>Test Event</h1>'
        + '<h1>Round 3</h1>'
        + '...rank:1,name:"Alice",wins:3,losses:1...'
        + '...rank:2,name:"Bob",wins:2,losses:2...'
        + '...rank:3,name:"Charlie",wins:1,losses:3...'
        + '</body></html>';
      stubFetch(fetchSpy, 200, syntheticHtml);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      expect(data).not.toBeNull();
      expect(data!.standings).toHaveLength(3);

      const alice = data!.standings.find((s) => s.name === 'Alice')!;
      expect(alice).toBeDefined();
      expect(alice.rank).toBe(1);
      expect(alice.wins).toBe(3);
      expect(alice.losses).toBe(1);

      const bob = data!.standings.find((s) => s.name === 'Bob')!;
      expect(bob.rank).toBe(2);
      expect(bob.wins).toBe(2);
      expect(bob.losses).toBe(2);
    });

    it('returns null on 404', async () => {
      stubFetch(fetchSpy, 404, 'Not Found');

      const adapter = makeAdapter();
      const data = await adapter.getEventData(999999);

      expect(data).toBeNull();
    });

    it('throws on 5xx', async () => {
      stubFetch(fetchSpy, 500, 'Server Error');

      const adapter = makeAdapter();
      await expect(adapter.getEventData(735205)).rejects.toThrow(
        ApiResponseError,
      );
    });

    it('uses cache within 30s TTL', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();

      // First call — fetches
      await adapter.getEventData(735205);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second call within 30s — uses cache
      await adapter.getEventData(735205);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('re-fetches after cache expiry', async () => {
      vi.useFakeTimers();
      try {
        const html = loadFixture();
        stubFetch(fetchSpy, 200, html);

        const adapter = makeAdapter();

        await adapter.getEventData(735205);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Advance past 30s TTL
        vi.advanceTimersByTime(31_000);

        await adapter.getEventData(735205);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
