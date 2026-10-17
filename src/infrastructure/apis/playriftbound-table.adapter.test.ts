import { describe, expect, it, vi } from 'vitest';
import { Event } from '../../core/entities/event.js';
import { EventDetail, EventPairing, EventStanding } from '../../core/entities/event-detail.js';
import { EventListing } from '../../core/entities/event-listing.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { PlayRiftboundTableAdapter } from './playriftbound-table.adapter.js';

const ORGANIZER_ID = 'b6e5c1f0-2233-4a55-8666-123456789abc';
const PLAYER_ID = 'ab398ee7-59b8-49ac-a12c-1d24b9010ae5';

function baseEvent(over: Partial<Event> = {}): Event {
  return {
    id: 'riot:117093196872746571',
    name: 'Friday Nexus Night',
    displayStatus: 'inProgress',
    eventStatus: 'IN_PROGRESS',
    startDatetime: '2026-10-17T09:00:00.000Z',
    endDatetime: '2026-10-17T15:00:00.000Z',
    timezone: 'UTC',
    capacity: 32,
    registeredCount: 2,
    startingPlayerCount: 2,
    store: {
      id: ORGANIZER_ID,
      name: 'Jupiter Juegos',
      fullAddress: 'Calle Example 1',
      latitude: 37.39,
      longitude: -5.99,
      timezone: null,
      country: 'ES',
    },
    gameplayFormatName: 'Constructed',
    headerImageUrl: null,
    queueStatus: 'ACCEPTING_SIGNUPS',
    eventType: 'LOCALS',
    eventFormat: 'CONSTRUCTED',
    description: '',
    costInCents: null,
    currency: 'EUR',
    isOnDemand: false,
    isTestEvent: false,
    tournamentPhases: [],
    locatorUrl: 'https://playriftbound.com/en-US/events/117093196872746571',
    supportsTracking: true,
    ...over,
  };
}

function baseRegistration(over: Partial<EventRegistration> = {}): EventRegistration {
  return {
    id: PLAYER_ID,
    name: 'Zoë#EUW',
    status: 'Active',
    profileImageUrl: null,
    matchesWon: 2,
    matchesLost: 1,
    matchesDrawn: 0,
    isGuest: false,
    finalPlaceInStandings: 2,
    ...over,
  };
}

function basePairing(over: Partial<EventPairing> = {}): EventPairing {
  return {
    tableNumber: 4,
    player1: 'Zoë#EUW',
    player2: 'Other#NA1',
    player1Id: PLAYER_ID,
    player2Id: 'opponent-player-id',
    winnerId: 'opponent-player-id',
    score1: 1,
    score2: 2,
    isBye: false,
    status: 'COMPLETE',
    outcome: 'win',
    winner: 'Other#NA1',
    drawType: null,
    gamesDrawn: 0,
    ...over,
  };
}

function baseStanding(over: Partial<EventStanding> = {}): EventStanding {
  return {
    rank: 2,
    name: 'Zoë#EUW',
    playerId: PLAYER_ID,
    roundNumber: 3,
    matchRecord: '2-1-0',
    points: 6,
    opponentMatchWinPercentage: 0.6,
    gameWinPercentage: 0.66,
    opponentGameWinPercentage: 0.5,
    ...over,
  };
}

function baseDetail(over: Partial<EventDetail> = {}): EventDetail {
  return {
    event: baseEvent(),
    currentRound: {
      id: 'riot:round-3',
      roundNumber: 3,
      status: 'IN_PROGRESS',
      pairingsStatus: 'GENERATED',
      standingsStatus: 'GENERATED',
    },
    registrations: [baseRegistration()],
    pairings: [basePairing()],
    standings: [baseStanding()],
    fetchedAt: '2026-10-17T12:00:00.000Z',
    ...over,
  };
}

function listing(id: EventListing['id'], startDatetime = '2026-10-17T09:00:00.000Z'): EventListing {
  return {
    id,
    name: 'Friday Nexus Night',
    startDatetime,
    endDatetime: '2026-10-17T15:00:00.000Z',
    timezone: 'UTC',
    mode: 'Nexus Night',
    storeName: 'Jupiter Juegos',
    registeredCount: 2,
    capacity: 32,
  };
}

function harness(details: Map<string, EventDetail>, listings: EventListing[]) {
  const eventRepository: IEventRepository = {
    getEventById: vi.fn(),
    getEventRegistrations: vi.fn(),
    getEventMatches: vi.fn(),
    getEventStandings: vi.fn(),
    getEventDetail: vi.fn(async (id) => details.get(String(id)) ?? null),
  };
  const eventListingRepository: IEventListingRepository = {
    getEvents: vi.fn(async () => listings),
  };
  const adapter = new PlayRiftboundTableAdapter({
    eventRepository,
    eventListingRepository,
    now: () => new Date('2026-10-17T12:00:00.000Z'),
  });
  return { adapter, eventRepository, eventListingRepository };
}

const store = {
  organizerId: ORGANIZER_ID,
  name: 'Jupiter Juegos',
  latitude: 37.39,
  longitude: -5.99,
  timezone: 'Europe/Madrid',
};

describe('PlayRiftboundTableAdapter', () => {
  it('uses the store-local day and maps an exact Riot player ID to the table', async () => {
    const details = new Map([['riot:117093196872746571', baseDetail()]]);
    const { adapter, eventListingRepository, eventRepository } = harness(
      details,
      [listing('riot:117093196872746571')],
    );

    const result = await adapter.getTable({ username: 'zoë#euw', store });

    expect(eventListingRepository.getEvents).toHaveBeenCalledWith(
      new Date('2026-10-16T22:00:00.000Z'),
      new Date('2026-10-17T22:00:00.000Z'),
      { latitude: 37.39, longitude: -5.99, numMiles: expect.any(Number) },
    );
    expect(eventRepository.getEventDetail).toHaveBeenCalledWith(
      'riot:117093196872746571',
      expect.any(Object),
      { fresh: true },
    );
    expect(result.tableNumber).toBe(4);
    expect(result.opponent).toEqual({ name: 'Other#NA1', score: 2 });
    expect(result.round?.result).toBe('loss');
    expect(result.record).toEqual({ wins: 2, losses: 1, draws: 0 });
    expect(result.standings).toMatchObject({ rank: 2, points: 6 });
    expect(result.event?.store.id).toBe(ORGANIZER_ID);
    expect(result.event?.store.timezone).toBe('Europe/Madrid');
    expect(result.event?.locatorUrl).toBe('https://playriftbound.com/en-US/events/117093196872746571');
  });

  it('does not match a similarly named event from another organizer', async () => {
    const detail = baseDetail({
      event: baseEvent({ store: { ...baseEvent().store, id: 'another-organizer' } }),
    });
    const { adapter } = harness(
      new Map([['riot:117093196872746571', detail]]),
      [listing('riot:117093196872746571')],
    );

    const result = await adapter.getTable({ username: 'Zoë#EUW', store });

    expect(result.event).toBeNull();
    expect(result.tableNumber).toBeNull();
  });

  it('rejects ambiguous bare names and asks for the exact Riot ID', async () => {
    const detail = baseDetail({
      registrations: [
        baseRegistration({ id: PLAYER_ID, name: 'Player#EUW' }),
        baseRegistration({ id: 'different-player-id', name: 'Player#NA1' }),
      ],
    });
    const { adapter } = harness(
      new Map([['riot:117093196872746571', detail]]),
      [listing('riot:117093196872746571')],
    );

    await expect(adapter.getTable({ username: 'Player', store })).rejects.toThrow(
      /Use the exact Riot ID, including #tag/,
    );
  });

  it('requires an event URL to disambiguate multiple same-day events for one player', async () => {
    const first = baseDetail();
    const second = baseDetail({
      event: baseEvent({ id: 'riot:another-event', name: 'Saturday Draft' }),
    });
    const { adapter } = harness(
      new Map([
        ['riot:117093196872746571', first],
        ['riot:another-event', second],
      ]),
      [listing('riot:117093196872746571'), listing('riot:another-event')],
    );

    await expect(adapter.getTable({ username: 'Zoë#EUW', store })).rejects.toThrow(
      /\/mytable event <official event URL>/,
    );
  });

  it('uses an explicit event ID without searching the day again', async () => {
    const details = new Map([['riot:117093196872746571', baseDetail()]]);
    const { adapter, eventListingRepository } = harness(details, []);

    const result = await adapter.getTable({
      username: 'Zoë#EUW',
      store,
      eventId: 'riot:117093196872746571',
    });

    expect(eventListingRepository.getEvents).not.toHaveBeenCalled();
    expect(result.tableNumber).toBe(4);
  });

  it('rejects unsupported team formats', async () => {
    const detail = baseDetail({ event: baseEvent({ supportsTracking: false }) });
    const { adapter } = harness(
      new Map([['riot:117093196872746571', detail]]),
      [listing('riot:117093196872746571')],
    );

    await expect(adapter.getTable({ username: 'Zoë#EUW', store })).rejects.toThrow(
      /currently supports 1v1 events/,
    );
  });

  it('rejects an invalid IANA timezone before making event queries', async () => {
    const { adapter, eventListingRepository } = harness(new Map(), []);

    await expect(
      adapter.getTable({ username: 'Zoë#EUW', store: { ...store, timezone: 'Not/A_Zone' } }),
    ).rejects.toThrow();
    expect(eventListingRepository.getEvents).not.toHaveBeenCalled();
  });
});
