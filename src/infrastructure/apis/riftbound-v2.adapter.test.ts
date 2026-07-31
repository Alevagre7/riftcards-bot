import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { RiftboundV2Adapter } from './riftbound-v2.adapter.js';
import { EventLocation } from '../../core/ports/event-repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));
}

const baseLocation: EventLocation = {
  latitude: 37.39,
  longitude: -5.99,
  numMiles: 50,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Routes the 799609 event detail bundle: event, registrations, the
// current round's matches, and the two-page standings.
function mockDetailRoutes(
  fetchSpy: ReturnType<typeof vi.fn>,
  overrides?: {
    detail?: unknown;
    registrations?: unknown;
    matches?: unknown;
    standingsPage1?: unknown;
    standingsPage2?: unknown;
  },
): void {
  fetchSpy.mockImplementation((input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname;

    if (path.includes('/matches/paginated/')) {
      return Promise.resolve(
        jsonResponse(overrides?.matches ?? loadFixture('v2-round-1172657-matches.json')),
      );
    }
    if (path.includes('/standings/paginated/')) {
      const page = url.searchParams.get('page');
      return Promise.resolve(
        jsonResponse(
          page === '2'
            ? overrides?.standingsPage2 ?? loadFixture('v2-round-1172657-standings-page2.json')
            : overrides?.standingsPage1 ?? loadFixture('v2-round-1172657-standings.json'),
        ),
      );
    }
    if (path.includes('/registrations/')) {
      return Promise.resolve(
        jsonResponse(
          overrides?.registrations ?? loadFixture('v2-event-799609-registrations.json'),
        ),
      );
    }
    if (path.includes('/events/')) {
      return Promise.resolve(
        jsonResponse(overrides?.detail ?? loadFixture('v2-event-799609.json')),
      );
    }
    return Promise.reject(new Error(`No route for ${String(input)}`));
  });
}

function makeAdapter(): RiftboundV2Adapter {
  return new RiftboundV2Adapter({
    baseUrl: 'https://api.riftbound.uvsgames.com/api/v2',
    timeoutMs: 5000,
    retryAttempts: 1,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RiftboundV2Adapter.getEvents', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftboundV2Adapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = makeAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs the correct URL with date + location params', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(loadFixture('v2-events-list.json')));

    const startAfter = new Date('2026-07-30T00:00:00.000Z');
    const startBefore = new Date('2026-08-06T00:00:00.000Z');

    await adapter.getEvents(startAfter, startBefore, baseLocation);

    const [calledUrl] = fetchSpy.mock.calls[0] as [string];
    const u = new URL(calledUrl);

    expect(u.pathname).toBe('/api/v2/events/');
    expect(u.searchParams.get('start_date_after')).toBe('2026-07-30T00:00:00.000Z');
    expect(u.searchParams.get('start_date_before')).toBe('2026-08-06T00:00:00.000Z');
    expect(u.searchParams.getAll('display_statuses')).toEqual(['upcoming', 'inProgress']);
    expect(u.searchParams.get('game_slug')).toBe('riftbound');
    expect(u.searchParams.get('latitude')).toBe('37.39');
    expect(u.searchParams.get('longitude')).toBe('-5.99');
    expect(u.searchParams.get('num_miles')).toBe('50');
    expect(u.searchParams.get('upcoming_only')).toBe('false');
  });

  it('maps display_status upcoming and inProgress to the entity', async () => {
    const list = loadFixture('v2-events-list.json') as {
      results: Array<Record<string, unknown>>;
    };
    const modified = {
      ...list,
      results: [
        list.results[0]!,
        { ...list.results[1]!, display_status: 'inProgress' },
      ],
    };
    fetchSpy.mockResolvedValue(jsonResponse(modified));

    const events = await adapter.getEvents(
      new Date('2026-07-30T00:00:00.000Z'),
      new Date('2026-08-06T00:00:00.000Z'),
      baseLocation,
    );

    expect(events).toHaveLength(2);
    expect(events[0]!.displayStatus).toBe('upcoming');
    expect(events[1]!.displayStatus).toBe('inProgress');

    // Field mapping against the real capture
    const ev = events[0]!;
    expect(ev.id).toBe(800104);
    expect(ev.name).toBe('Torneo Semanal - La Cueva Roja Nexus Night');
    expect(ev.startDatetime).toBe('2026-07-31T15:00:00+00:00');
    expect(ev.endDatetime).toBe('2026-07-31T20:00:00+00:00');
    expect(ev.timezone).toBe('Europe/Madrid');
    expect(ev.store.name).toBe('La Cueva Roja');
    // List items carry no store timezone → mapped to null
    expect(ev.store.timezone).toBeNull();
    expect(ev.store.country).toBe('ES');
    expect(ev.gameplayFormatName).toBe('Constructed');
    expect(ev.registeredCount).toBe(5);
    expect(ev.capacity).toBe(40);
    expect(ev.eventType).toBe('LOCALS');
    expect(ev.costInCents).toBe(0);
    expect(ev.tournamentPhases).toHaveLength(1);
  });
});

describe('RiftboundV2Adapter.getEventById', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftboundV2Adapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = makeAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the mapped Event for 200', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(loadFixture('v2-event-799609.json')));

    const ev = await adapter.getEventById(799609, baseLocation);

    expect(ev).not.toBeNull();
    expect(ev!.id).toBe(799609);
    expect(ev!.name).toBe('Vendetta pre release 2');
    expect(ev!.displayStatus).toBe('complete');
    expect(ev!.eventStatus).toBe('SCHEDULED');
    expect(ev!.store.name).toBe('The POP Shop');
    expect(ev!.store.timezone).toBe('America/New_York');
    expect(ev!.gameplayFormatName).toBe('Sealed');
    expect(ev!.costInCents).toBe(3000);
    expect(ev!.currency).toBe('USD');
    expect(ev!.tournamentPhases).toHaveLength(1);
    expect(ev!.tournamentPhases[0]!.rounds).toHaveLength(3);
  });

  it('returns null on 404', async () => {
    fetchSpy.mockResolvedValue(new Response('Not Found', { status: 404 }));

    expect(await adapter.getEventById(999999, baseLocation)).toBeNull();
  });
});

describe('RiftboundV2Adapter.getEventRegistrations', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftboundV2Adapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = makeAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the mapped roster', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(loadFixture('v2-event-799609-registrations.json')));

    const regs = await adapter.getEventRegistrations(799609, baseLocation);

    expect(regs).toHaveLength(11);
    const first = regs[0]!;
    expect(first.name).toBe('TheNightman');
    expect(first.status).toBe('Active');
    expect(first.profileImageUrl).not.toBeNull();
    expect(first.matchesWon).toBe(2);
    expect(first.matchesLost).toBe(1);
    expect(first.matchesDrawn).toBe(0);
    expect(first.isGuest).toBe(false);
    expect(first.finalPlaceInStandings).toBe(6);
  });

  it('maps non-COMPLETE registration status to Dropped', async () => {
    const regs = loadFixture('v2-event-799609-registrations.json') as {
      results: Array<Record<string, unknown>>;
    };
    regs.results[1]!.registration_status = 'DROPPED';
    fetchSpy.mockResolvedValue(jsonResponse(regs));

    const out = await adapter.getEventRegistrations(799609, baseLocation);

    expect(out[0]!.status).toBe('Active');
    expect(out[1]!.status).toBe('Dropped');
  });

  it('returns an empty array on 404', async () => {
    fetchSpy.mockResolvedValue(new Response('Not Found', { status: 404 }));

    expect(await adapter.getEventRegistrations(999999, baseLocation)).toEqual([]);
  });
});

describe('RiftboundV2Adapter.getEventDetail', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let adapter: RiftboundV2Adapter;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = makeAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a full detail bundle with the derived currentRound for the 799609 capture', async () => {
    mockDetailRoutes(fetchSpy);

    const detail = await adapter.getEventDetail(799609, baseLocation);

    expect(detail).not.toBeNull();
    expect(detail!.event.id).toBe(799609);
    // All rounds COMPLETE → derivation picks the last COMPLETE in the
    // (orderInPhases desc, roundNumber desc) scan = the earliest round.
    expect(detail!.currentRound).not.toBeNull();
    expect(detail!.currentRound!.id).toBe(1172657);
    expect(detail!.currentRound!.roundNumber).toBe(1);
    expect(detail!.currentRound!.status).toBe('COMPLETE');
    expect(detail!.registrations).toHaveLength(11);
    // 6 captured matches minus the single bye
    expect(detail!.pairings).toHaveLength(5);
    expect(detail!.standings).toHaveLength(11);
    expect(detail!.fetchedAt).toBeTruthy();
  });

  it('returns null when the event 404s', async () => {
    fetchSpy.mockResolvedValue(new Response('Not Found', { status: 404 }));

    expect(await adapter.getEventDetail(999999, baseLocation)).toBeNull();
  });

  it('follows the standings next page and concatenates', async () => {
    mockDetailRoutes(fetchSpy);

    const detail = await adapter.getEventDetail(799609, baseLocation);

    const standings = detail!.standings;
    expect(standings).toHaveLength(11);
    expect(standings[0]!.rank).toBe(1);
    expect(standings[10]!.rank).toBe(11);
    expect(standings[10]!.name).toBe('Jake B');
  });

  it('uses the 30s cache on the second call', async () => {
    mockDetailRoutes(fetchSpy);

    await adapter.getEventDetail(799609, baseLocation);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    // Cold call fetches: detail + registrations + matches + 2 standings pages
    expect(callsAfterFirst).toBe(5);

    await adapter.getEventDetail(799609, baseLocation);

    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('excludes byes and attributes scores correctly', async () => {
    const matches = loadFixture('v2-round-1172657-matches.json') as {
      results: Array<Record<string, unknown>>;
    };
    matches.results = [
      ...matches.results,
      {
        id: 9999999,
        table_number: 6,
        status: 'PENDING',
        games_won_by_winner: null,
        games_won_by_loser: null,
        match_is_bye: false,
        winning_player: null,
        player_match_relationships: [
          {
            player_order: 1,
            is_starting_player: false,
            player: { id: 1, best_identifier: 'P1' },
            user_event_status: {
              id: 11,
              best_identifier: 'U1',
              registration_status: 'COMPLETE',
              matches_won: 0,
              matches_lost: 0,
              matches_drawn: 0,
              total_match_points: 0,
            },
          },
          {
            player_order: 2,
            is_starting_player: false,
            player: { id: 2, best_identifier: 'P2' },
            user_event_status: {
              id: 12,
              best_identifier: 'U2',
              registration_status: 'COMPLETE',
              matches_won: 0,
              matches_lost: 0,
              matches_drawn: 0,
              total_match_points: 0,
            },
          },
        ],
      },
    ];
    mockDetailRoutes(fetchSpy, { matches });

    const detail = await adapter.getEventDetail(799609, baseLocation);

    const pairings = detail!.pairings;
    // 7 matches (6 captured + 1 pending) minus the bye
    expect(pairings).toHaveLength(6);
    expect(pairings.some((p) => p.tableNumber === 0)).toBe(false);

    // Table 1: Khorgast beat TheNightman 2-0 (winning_player = rel 1)
    const table1 = pairings.find((p) => p.tableNumber === 1)!;
    expect(table1.player1).toBe('Khorgast');
    expect(table1.player2).toBe('TheNightman');
    expect(table1.score1).toBe(2);
    expect(table1.score2).toBe(0);
    expect(table1.isBye).toBe(false);

    // PENDING match: scores stay null
    const pending = pairings.find((p) => p.tableNumber === 6)!;
    expect(pending.score1).toBeNull();
    expect(pending.score2).toBeNull();
  });

  it('builds standings with the API rank preserved', async () => {
    mockDetailRoutes(fetchSpy);

    const detail = await adapter.getEventDetail(799609, baseLocation);

    const first = detail!.standings[0]!;
    expect(first.rank).toBe(1);
    expect(first.name).toBe('Connor M');
    expect(first.wins).toBe(2);
    expect(first.losses).toBe(1);
    expect(first.draws).toBe(0);
    expect(first.matchPoints).toBe(3);
    expect(first.matchRecord).toBe('1-0-0');
  });

  it('returns empty pairings/standings when the event has no rounds', async () => {
    const detail = loadFixture('v2-event-799609.json') as {
      tournament_phases: unknown;
    };
    mockDetailRoutes(fetchSpy, {
      detail: { ...detail, tournament_phases: [] },
    });

    const out = await adapter.getEventDetail(799609, baseLocation);

    expect(out).not.toBeNull();
    expect(out!.currentRound).toBeNull();
    expect(out!.pairings).toEqual([]);
    expect(out!.standings).toEqual([]);
    // Registrations still fetched
    expect(out!.registrations).toHaveLength(11);
  });
});
