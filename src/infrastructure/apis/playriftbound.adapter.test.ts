import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PlayRiftboundAdapter } from './playriftbound.adapter.js';
import type { EventLocation } from '../../core/ports/event-repository.js';
import type { EventId, RoundId } from '../../core/entities/event-id.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__');
type JsonObject = Record<string, any>;
type RequestBody = {
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
  readonly extensions: { readonly persistedQuery: { readonly sha256Hash: string } };
};

function loadFixture(name: string): JsonObject {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as JsonObject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const location: EventLocation = { latitude: 37.39, longitude: -5.99, numMiles: 50 };
const eventId = 'riot:700000000000000001' as EventId;
const round1Id = 'riot:700000000000000001:700000000000000031:700000000000000032:1' as RoundId;
const round5Id = 'riot:700000000000000001:700000000000000031:700000000000000032:5' as RoundId;

function makeAdapter(): PlayRiftboundAdapter {
  return new PlayRiftboundAdapter({ baseUrl: 'https://events.test', timeoutMs: 5000, retryAttempts: 1 });
}

function makeOfficialRouter(fetchSpy: ReturnType<typeof vi.fn>, tournament = loadFixture('playriftbound-tournament.json')): void {
  fetchSpy.mockImplementation(async (_input: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as RequestBody;
    if (request.operationName === 'GetCompeteTournamentForRiftboundPlayer') return jsonResponse(tournament);
    if (request.operationName === 'OrganizerSummary') return jsonResponse(loadFixture('playriftbound-organizer.json'));
    if (request.operationName === 'CompeteTournamentSearch') return jsonResponse(loadFixture('playriftbound-search.json'));
    throw new Error(`Unexpected operation ${request.operationName}`);
  });
}

describe('PlayRiftboundAdapter.getEvents', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('paginates sorted results, keeps 2v2 listings, and stops after validating the upper-bound page', async () => {
    const firstPage = loadFixture('playriftbound-search.json');
    const firstEdges = firstPage.data.competeTournamentSearch.edges as JsonObject[];
    const twoVTwo = clone(firstEdges[0]!);
    twoVTwo.node.tournament.id = '700000000000000002';
    twoVTwo.node.tournament.name = 'Sample 2v2 Tournament';
    twoVTwo.node.tournament.config.playerFormat = 'TWO_V_TWO';
    twoVTwo.node.tournament.startsAt = '2026-10-18T15:30:00Z';
    const future = clone(firstEdges[0]!);
    future.node.tournament.id = '700000000000000003';
    future.node.tournament.startsAt = '2026-10-18T17:00:00Z';
    firstPage.data.competeTournamentSearch.edges = [firstEdges[0], twoVTwo, future];
    firstPage.data.competeTournamentSearch.pageInfo = { endCursor: 'page-1', hasNextPage: true };

    fetchSpy.mockImplementation(async (_input: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RequestBody;
      expect(request.operationName).toBe('CompeteTournamentSearch');
      return jsonResponse(firstPage);
    });

    const adapter = makeAdapter();
    const events = await adapter.getEvents(
      new Date('2026-10-18T14:00:00Z'),
      new Date('2026-10-18T16:00:00Z'),
      location,
    );

    expect(events.map((event) => event.id)).toEqual([
      'riot:700000000000000001',
      'riot:700000000000000002',
    ]);
    expect(events[1]?.name).toBe('Sample 2v2 Tournament');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as RequestBody;
    expect(request.variables.filter).toEqual({
      rb: {
        coords: { latitude: location.latitude, longitude: location.longitude },
        startDate: '2026-10-18T14:00:00.000Z',
        distanceMeters: 80467,
      },
    });
    expect(JSON.stringify(request.variables)).not.toContain('endDate');
    expect(JSON.stringify(request.variables)).not.toContain('playerFormats');
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).not.toHaveProperty('cookie');
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).not.toHaveProperty('authorization');
  });

  it('requests a second page until the sorted stream passes the requested window', async () => {
    const first = loadFixture('playriftbound-search.json');
    first.data.competeTournamentSearch.pageInfo = { endCursor: 'cursor-1', hasNextPage: true };
    const second = loadFixture('playriftbound-search.json');
    const edge = second.data.competeTournamentSearch.edges[0] as JsonObject;
    edge.cursor = 'cursor-2';
    edge.node.tournament.id = '700000000000000002';
    edge.node.tournament.startsAt = '2026-10-18T17:00:00Z';
    second.data.competeTournamentSearch.pageInfo = { endCursor: 'cursor-2', hasNextPage: true };
    let page = 0;
    fetchSpy.mockImplementation(async (_input: string | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as RequestBody;
      if (page++ === 0) {
        expect(request.variables.after).toBeUndefined();
        return jsonResponse(first);
      }
      expect(request.variables.after).toBe('cursor-1');
      return jsonResponse(second);
    });

    const events = await makeAdapter().getEvents(
      new Date('2026-10-18T14:00:00Z'),
      new Date('2026-10-18T16:00:00Z'),
      location,
    );

    expect(events).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects non-monotonic date order instead of returning a possibly incomplete window', async () => {
    const response = loadFixture('playriftbound-search.json');
    const first = response.data.competeTournamentSearch.edges[0] as JsonObject;
    const second = clone(first);
    second.node.tournament.id = '700000000000000002';
    first.node.tournament.startsAt = '2026-10-18T15:30:00Z';
    second.node.tournament.startsAt = '2026-10-18T15:00:00Z';
    response.data.competeTournamentSearch.edges = [first, second];
    fetchSpy.mockResolvedValue(jsonResponse(response));

    await expect(makeAdapter().getEvents(
      new Date('2026-10-18T14:00:00Z'),
      new Date('2026-10-18T16:00:00Z'),
      location,
    )).rejects.toThrow('Search results were not ordered');
  });

  it('rejects radii over the supported limit before making a request', async () => {
    await expect(makeAdapter().getEvents(
      new Date('2026-10-18T00:00:00Z'),
      new Date('2026-10-19T00:00:00Z'),
      { ...location, numMiles: 100.01 },
    )).rejects.toThrow('no more than 100 miles');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('PlayRiftboundAdapter detail and tracking', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('maps stable Riot identities, status-independent outcomes, prior standings, timezone, and bye', async () => {
    const tournament = loadFixture('playriftbound-tournament.json');
    const registrant = tournament.data.competeTournaments[0].tournamentRegistrants.find((item: JsonObject) =>
      item.player?.id === '00000000-0000-4000-8000-000000000002',
    );
    registrant.player.id = '00000000-0000-4000-8000-000000000002'.toUpperCase();
    makeOfficialRouter(fetchSpy, tournament);
    const adapter = makeAdapter();
    const detail = await adapter.getEventDetail(eventId, location);

    expect(detail?.event.id).toBe(eventId);
    expect(detail?.event.locatorUrl).toBe('https://events.playriftbound.com/en-US/events/700000000000000001');
    expect(detail?.event.store.id).toBe('00000000-0000-7000-8000-000000000001');
    expect(detail?.event.store.timezone).toBe('Africa/Ndjamena');
    expect(detail?.event.timezone).toBe('Africa/Ndjamena');
    expect(detail?.event.supportsTracking).toBe(true);
    expect(detail?.currentRound?.roundNumber).toBe(5);
    expect(detail?.standingsRoundNumber).toBe(1);
    expect(detail?.standingsRoundId).toBe(round1Id);
    expect(detail?.standings[0]?.playerId).toBe('00000000-0000-4000-8000-000000000003');
    expect(detail?.registrations.find((registration) => registration.id === '00000000-0000-4000-8000-000000000002')).toMatchObject({
      name: 'Player 1#TEST',
      status: 'Dropped',
    });
    expect(detail?.pairings).toEqual([
      expect.objectContaining({
        isBye: true,
        player1: 'Player 3#TEST',
        player1Id: '00000000-0000-4000-8000-000000000006',
        winnerId: '00000000-0000-4000-8000-000000000006',
        outcome: 'bye',
      }),
    ]);

    const round1Matches = await adapter.getEventMatches(round1Id);
    expect(round1Matches[0]).toMatchObject({
      player1Id: '00000000-0000-4000-8000-000000000002',
      player2Id: '00000000-0000-4000-8000-000000000003',
      winnerId: '00000000-0000-4000-8000-000000000003',
      outcome: 'win',
      status: 'IN_PROGRESS',
    });
  });

  it('returns standings for the exact requested round without borrowing a prior round', async () => {
    makeOfficialRouter(fetchSpy);
    const adapter = makeAdapter();
    expect(await adapter.getEventStandings(round5Id)).toEqual([]);
    expect(await adapter.getEventStandings(round1Id)).toHaveLength(2);
  });

  it('does not infer a winner from games when explicit match outcomes are incomplete', async () => {
    const tournament = loadFixture('playriftbound-tournament.json');
    const round = tournament.data.competeTournaments[0].stages[0].sections[0].rounds[0];
    round.matches[0].teamOutcomes = [{ esportsTeamId: '700000000000000034', outcome: 'WIN' }];
    makeOfficialRouter(fetchSpy, tournament);

    const [pairing] = await makeAdapter().getEventMatches(round1Id);
    expect(pairing?.outcome).toBe('unavailable');
    expect(pairing?.winnerId).toBeNull();
  });

  it('maps an explicit tie even while the Riot match status remains in progress', async () => {
    const tournament = loadFixture('playriftbound-tournament.json');
    const round = tournament.data.competeTournaments[0].stages[0].sections[0].rounds[0];
    round.matches[0].teamOutcomes = [
      { esportsTeamId: '700000000000000034', outcome: 'TIE' },
      { esportsTeamId: '700000000000000033', outcome: 'TIE' },
    ];
    makeOfficialRouter(fetchSpy, tournament);

    const [pairing] = await makeAdapter().getEventMatches(round1Id);
    expect(pairing).toMatchObject({ outcome: 'draw', winnerId: null, drawType: null, status: 'IN_PROGRESS' });
  });

  it('keeps 2v2 events visible but disables player tracking when team shape is unsupported', async () => {
    const tournament = loadFixture('playriftbound-tournament.json');
    tournament.data.competeTournaments[0].config.playerFormat = 'TWO_V_TWO';
    makeOfficialRouter(fetchSpy, tournament);

    const detail = await makeAdapter().getEventDetail(eventId, location);
    expect(detail?.event.supportsTracking).toBe(false);
    expect(detail?.pairings).toEqual([]);
    expect(detail?.standings).toEqual([]);
    expect(detail?.standingsRoundId).toBeUndefined();
    expect(detail?.registrations.length).toBeGreaterThan(0);
  });

  it('returns null only for a valid empty event result and rejects GraphQL errors and malformed records', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: { competeTournaments: [] } }));
    expect(await makeAdapter().getEventById(eventId, location)).toBeNull();

    fetchSpy.mockResolvedValueOnce(jsonResponse({
      errors: [{ message: 'service unavailable', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
      data: null,
    }));
    await expect(makeAdapter().getEventById(eventId, location)).rejects.toThrow('GraphQL INTERNAL_SERVER_ERROR');

    const malformed = loadFixture('playriftbound-tournament.json');
    delete malformed.data.competeTournaments[0].tournamentParticipants;
    fetchSpy.mockResolvedValueOnce(jsonResponse(malformed));
    await expect(makeAdapter().getEventById(eventId, location)).rejects.toThrow('Invalid GetCompeteTournamentForRiftboundPlayer response');

    const invalidPlayer = loadFixture('playriftbound-tournament.json');
    invalidPlayer.data.competeTournaments[0].tournamentRegistrants[0].player.id = 'not-a-uuid';
    fetchSpy.mockResolvedValueOnce(jsonResponse(invalidPlayer));
    await expect(makeAdapter().getEventById(eventId, location)).rejects.toThrow('Invalid GetCompeteTournamentForRiftboundPlayer response');
  });

  it.each([undefined, 'not-standings'])('still rejects missing or malformed standings: %s', async (value) => {
    const tournament = loadFixture('playriftbound-tournament.json');
    tournament.data.competeTournaments[0].stages[0].sections[0].rounds[0].endOfRoundStandings = value;
    makeOfficialRouter(fetchSpy, tournament);
    await expect(makeAdapter().getEventDetail(eventId, location)).rejects.toThrow('Invalid GetCompeteTournamentForRiftboundPlayer response');
  });

  it('bypasses the short cache for fresh detail requests while coalescing identical fresh reads', async () => {
    makeOfficialRouter(fetchSpy);
    const adapter = makeAdapter();
    await adapter.getEventDetail(eventId, location);
    await adapter.getEventDetail(eventId, location);
    expect(fetchSpy.mock.calls.filter((call) => {
      const request = JSON.parse(String(call[1]?.body)) as RequestBody;
      return request.operationName === 'GetCompeteTournamentForRiftboundPlayer';
    })).toHaveLength(1);

    await Promise.all([
      adapter.getEventDetail(eventId, location, { fresh: true }),
      adapter.getEventDetail(eventId, location, { fresh: true }),
    ]);
    expect(fetchSpy.mock.calls.filter((call) => {
      const request = JSON.parse(String(call[1]?.body)) as RequestBody;
      return request.operationName === 'GetCompeteTournamentForRiftboundPlayer';
    })).toHaveLength(2);
  });
});

describe('PlayRiftboundAdapter public persisted query discovery', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('coalesces rotated-hash recovery and ignores AST hashes in same-origin public bundles', async () => {
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname === '/api/gql') {
        const request = JSON.parse(String(init?.body)) as RequestBody;
        if (request.extensions.persistedQuery.sha256Hash !== 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
          return jsonResponse({
            errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }],
          });
        }
        return jsonResponse(loadFixture('playriftbound-search.json'));
      }
      if (url.pathname === '/en-US/events/') {
        return new Response('<script src="/_next/static/chunks/loader.js"></script>', { status: 200 });
      }
      if (url.pathname === '/_next/static/chunks/loader.js') {
        return new Response('l0={__meta__:{hash:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}};Promise.all(["static/chunks/events.js"].map(t=>e.l(t)))', { status: 200 });
      }
      if (url.pathname === '/_next/static/chunks/events.js') {
        return new Response('{"id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","name":"CompeteTournamentSearch"}', { status: 200 });
      }
      throw new Error(`Unexpected discovery URL ${url.toString()}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const adapter = new PlayRiftboundAdapter({ baseUrl: 'https://events.test', timeoutMs: 5000, retryAttempts: 1 });
    const [events, concurrent] = await Promise.all([
      adapter.getEvents(new Date('2026-10-18T14:00:00Z'), new Date('2026-10-18T16:00:00Z'), location),
      adapter.getEvents(new Date('2026-10-18T14:00:00Z'), new Date('2026-10-18T16:00:00Z'), location),
    ]);

    expect(events).toHaveLength(1);
    expect(concurrent).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(7);
    const postRequests = fetchSpy.mock.calls
      .filter(([input]) => new URL(String(input)).pathname === '/api/gql')
      .map(([, init]) => JSON.parse(String(init?.body)) as RequestBody);
    expect(postRequests).toHaveLength(4);
    expect(postRequests.slice(2).every((request) => request.extensions.persistedQuery.sha256Hash === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
  });
});
