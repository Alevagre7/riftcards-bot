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

/**
 * Build a minimal HTML page with an RSC flight chunk containing a React Query
 * dehydrated state for the given section (e.g. standings-section).
 *
 * The RSC payload format mirrors what Next.js emits:
 *   N:["$","$L58",null,{"data-testid":"<sectionId>","children":["$","$L3b",null,{"state":<state>}]}]
 */
function buildRscPage(
  sectionTestId: string,
  state: object,
): string {
  const dataTestIdAttr = `data-testid":"${sectionTestId}"`;
  const serialized = JSON.stringify(state);

  // Build the RSC chunk content: the numeric prefix + the React serialized array
  const chunkContent = `1:["$","$L58",null,{"title":"Test","${dataTestIdAttr}","children":["$","$L3b",null,{"state":${serialized}}]}]`;

  // The RSC chunk is wrapped in self.__next_f.push([1,"..."]) where the string
  // is JSON-escaped (nested quotes are \")
  const escaped = JSON.stringify(chunkContent).slice(1, -1); // remove outer quotes

  return `<html><body>
    <h1>Test Event</h1>
    <h1>Round 1</h1>
    <script>self.__next_f.push([1,"${escaped}"])</script>
  </body></html>`;
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

      // Verify individual pairings (names from RSC data)
      const table1 = data!.pairings.find((p) => p.tableNumber === 1)!;
      expect(table1).toBeDefined();
      expect([table1.player1, table1.player2]).toContain('James C');
      expect([table1.player1, table1.player2]).toContain('Andrew A');
    });

    it('parses the roster', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      expect(data).not.toBeNull();
      expect(data!.roster.length).toBeGreaterThanOrEqual(10);

      // Known roster entries
      const names = data!.roster.map((r) => r.displayName);
      expect(names).toContain('soul');
      expect(names).toContain('TheLastBed');
      expect(names).toContain('ScoobertDoobert');

      // Statuses (RSC data uses 'DROPPED' uppercase → mapped to 'Dropped')
      const dropped = data!.roster.filter((r) => r.status === 'Dropped');
      expect(dropped.length).toBeGreaterThan(0);
    });

    it('de-duplicates by table number (no mirror duplicates)', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      // RSC data has 5 unique pairings already (no mirroring in JSON)
      expect(data!.pairings.length).toBe(5);

      // No duplicate table numbers
      const tableNumbers = data!.pairings.map((p) => p.tableNumber);
      expect(new Set(tableNumbers).size).toBe(5);
    });

    it('parses standings from RSC flight data', async () => {
      const standingsState = {
        mutations: [],
        queries: [
          {
            state: {
              data: {
                page_size: 10,
                count: 3,
                total: 3,
                current_page_number: 1,
                results: [
                  {
                    player: { id: 1, best_identifier: 'Alice' },
                    user_event_status: {
                      matches_won: 3,
                      matches_lost: 1,
                      matches_drawn: 0,
                      total_match_points: 9,
                    },
                  },
                  {
                    player: { id: 2, best_identifier: 'Bob' },
                    user_event_status: {
                      matches_won: 2,
                      matches_lost: 2,
                      matches_drawn: 0,
                      total_match_points: 6,
                    },
                  },
                  {
                    player: { id: 3, best_identifier: 'Charlie' },
                    user_event_status: {
                      matches_won: 1,
                      matches_lost: 3,
                      matches_drawn: 0,
                      total_match_points: 3,
                    },
                  },
                ],
              },
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              status: 'success',
            },
            queryKey: ['roundStandings', 1, { page: 1, page_size: 10 }],
          },
        ],
      };

      const html = buildRscPage('standings-section', standingsState);
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(999);

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

    it('parses IN_PROGRESS pairings with null scores', async () => {
      const html = loadFixture();
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(735205);

      // All 5 pairings in the fixture are IN_PROGRESS → null scores
      for (const pairing of data!.pairings) {
        expect(pairing.score1).toBeNull();
        expect(pairing.score2).toBeNull();
      }
    });

    it('excludes bye matches from pairings', async () => {
      // Build a fake pairings response with one bye match (table_number=0,
      // match_is_bye=true, single relationship) and 2 real tables
      const pairingsState = {
        mutations: [],
        queries: [
          {
            state: {
              data: {
                page_size: 10,
                count: 3,
                total: 3,
                current_page_number: 1,
                results: [
                  {
                    id: 1,
                    table_number: 1,
                    status: 'COMPLETE',
                    games_won_by_winner: 2,
                    games_won_by_loser: 1,
                    match_is_bye: false,
                    winning_player: 101,
                    player_match_relationships: [
                      {
                        player_order: 1,
                        is_starting_player: false,
                        player: { id: 101, best_identifier: 'WinnerA' },
                      },
                      {
                        player_order: 2,
                        is_starting_player: true,
                        player: { id: 102, best_identifier: 'LoserB' },
                      },
                    ],
                  },
                  {
                    id: 2,
                    table_number: 0,
                    status: 'COMPLETE',
                    games_won_by_winner: null,
                    games_won_by_loser: null,
                    match_is_bye: true,
                    winning_player: null,
                    player_match_relationships: [
                      {
                        player_order: null,
                        is_starting_player: false,
                        player: { id: 103, best_identifier: 'ByePlayer' },
                      },
                    ],
                  },
                  {
                    id: 3,
                    table_number: 2,
                    status: 'PENDING',
                    games_won_by_winner: null,
                    games_won_by_loser: null,
                    match_is_bye: false,
                    winning_player: null,
                    player_match_relationships: [
                      {
                        player_order: 1,
                        is_starting_player: false,
                        player: { id: 104, best_identifier: 'PlayerX' },
                      },
                      {
                        player_order: 2,
                        is_starting_player: true,
                        player: { id: 105, best_identifier: 'PlayerY' },
                      },
                    ],
                  },
                ],
              },
              dataUpdateCount: 1,
              status: 'success',
            },
            queryKey: ['tournamentRoundsMatchesPaginatedList', 1],
          },
        ],
      };

      const html = buildRscPage('pairings-section', pairingsState);
      stubFetch(fetchSpy, 200, html);

      const adapter = makeAdapter();
      const data = await adapter.getEventData(999);

      expect(data).not.toBeNull();
      expect(data!.pairings).toHaveLength(2);

      // Table 1: COMPLETE with scores
      const t1 = data!.pairings.find((p) => p.tableNumber === 1)!;
      expect(t1).toBeDefined();
      expect(t1.player1).toBe('WinnerA');
      expect(t1.player2).toBe('LoserB');
      expect(t1.score1).toBe(2);
      expect(t1.score2).toBe(1);

      // Table 2 (original table 2 is bye, excluded) → what was table 3 is now second
      const t2 = data!.pairings.find((p) => p.tableNumber === 2)!;
      expect(t2).toBeDefined();
      expect(t2.player1).toBe('PlayerX');
      expect(t2.player2).toBe('PlayerY');
      expect(t2.score1).toBeNull();
      expect(t2.score2).toBeNull();
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
