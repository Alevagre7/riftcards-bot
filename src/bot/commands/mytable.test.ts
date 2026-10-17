import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { Event } from '../../core/entities/event.js';
import { NexusTable } from '../../core/entities/nexus-table.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { INexusTableRepository } from '../../core/ports/nexus-table-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { setupFlow } from '../state/setup-flow.js';
import { createMytableCommand } from './mytable.js';

const USER_ID = 876;
const EVENT_URL = 'https://playriftbound.com/en-US/events/117093196872746571';
const ORGANIZER_ID = 'b6e5c1f0-2233-4a55-8666-123456789abc';

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
    supportsTracking: true,
    ...over,
  };
}

function baseTable(over: Partial<NexusTable> = {}): NexusTable {
  return {
    username: 'Zoë#EUW',
    event: null,
    round: null,
    tableNumber: null,
    opponent: null,
    standings: null,
    record: { wins: 0, losses: 0, draws: 0 },
    status: { active: false, inProgress: false },
    fetchedAt: '2026-10-17T12:00:00.000Z',
    ...over,
  };
}

function context(text: string): Context {
  return {
    from: { id: USER_ID, is_bot: false, first_name: 'Test' },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function harness() {
  const userSettingsRepository: IUserSettingsRepository = {
    getLocation: vi.fn().mockResolvedValue(null),
    setLocation: vi.fn().mockResolvedValue(undefined),
    clearLocation: vi.fn().mockResolvedValue(undefined),
    getNexusUsername: vi.fn().mockResolvedValue(null),
    setNexusUsername: vi.fn().mockResolvedValue(undefined),
    clearNexusUsername: vi.fn().mockResolvedValue(undefined),
    getMytableStore: vi.fn().mockResolvedValue(null),
    setMytableStore: vi.fn().mockResolvedValue(undefined),
    clearMytableStore: vi.fn().mockResolvedValue(undefined),
  };
  const nexusTableRepository: INexusTableRepository = {
    getTable: vi.fn().mockImplementation(async ({ username }) => baseTable({ username })),
  };
  const eventRepository: IEventRepository = {
    getEventById: vi.fn().mockResolvedValue(baseEvent()),
    getEventRegistrations: vi.fn(),
    getEventMatches: vi.fn(),
    getEventStandings: vi.fn(),
    getEventDetail: vi.fn(),
  };
  const eventListingRepository: IEventListingRepository = { getEvents: vi.fn() };
  const handler = createMytableCommand({
    userSettingsRepository,
    nexusTableRepository,
    eventRepository,
    eventListingRepository,
    defaultLocation: { latitude: 37.39, longitude: -5.99, numMiles: 25 },
  });
  return {
    handler,
    userSettingsRepository,
    nexusTableRepository,
    eventRepository,
    eventListingRepository,
  };
}

const savedStore = {
  organizerId: ORGANIZER_ID,
  name: 'Jupiter Juegos',
  latitude: 37.39,
  longitude: -5.99,
  timezone: 'Europe/Madrid',
  updatedAt: '2026-10-17T09:00:00.000Z',
};

describe('/mytable command', () => {
  beforeEach(() => {
    setupFlow.cancel(USER_ID);
  });

  it('accepts `/mytable <name#tag>` and keeps the one-off name out of settings', async () => {
    const deps = harness();
    vi.mocked(deps.userSettingsRepository.getMytableStore).mockResolvedValue(savedStore);
    const ctx = context('/mytable Zoë Player#EUW');

    await deps.handler(ctx);

    expect(deps.nexusTableRepository.getTable).toHaveBeenCalledWith({
      username: 'Zoë Player#EUW',
      store: savedStore,
    });
    expect(deps.userSettingsRepository.setNexusUsername).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('My table'), { parse_mode: 'HTML' });
  });

  it('uses the saved player name and saved store for an empty command', async () => {
    const deps = harness();
    vi.mocked(deps.userSettingsRepository.getNexusUsername).mockResolvedValue('Zoë#EUW');
    vi.mocked(deps.userSettingsRepository.getMytableStore).mockResolvedValue(savedStore);

    await deps.handler(context('/mytable'));

    expect(deps.nexusTableRepository.getTable).toHaveBeenCalledWith({
      username: 'Zoë#EUW',
      store: savedStore,
    });
  });

  it('explains that a store must be selected before a lookup', async () => {
    const deps = harness();
    const ctx = context('/mytable one-off-name');

    await deps.handler(ctx);

    expect(deps.nexusTableRepository.getTable).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/mytable store'));
  });

  it('saves a Unicode Riot ID with `set`', async () => {
    const deps = harness();
    await deps.handler(context('/mytable set 夜明け#1234'));

    expect(deps.userSettingsRepository.setNexusUsername).toHaveBeenCalledWith(USER_ID, '夜明け#1234');
  });

  it('rejects malformed Riot IDs', async () => {
    const deps = harness();
    const ctx = context('/mytable set name#');

    await deps.handler(ctx);

    expect(deps.userSettingsRepository.setNexusUsername).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Invalid player name'));
  });

  it('starts the saved-name flow when `set` has no inline value', async () => {
    const deps = harness();
    await deps.handler(context('/mytable set'));

    expect(setupFlow.consume(USER_ID)).toBe('mytable-set-username');
  });

  it('clears the player name but keeps the selected store', async () => {
    const deps = harness();
    await deps.handler(context('/mytable clear'));

    expect(deps.userSettingsRepository.clearNexusUsername).toHaveBeenCalledWith(USER_ID);
    expect(deps.userSettingsRepository.clearMytableStore).not.toHaveBeenCalled();
  });

  it('clears the store separately from the player name', async () => {
    const deps = harness();
    await deps.handler(context('/mytable clearstore'));

    expect(deps.userSettingsRepository.clearMytableStore).toHaveBeenCalledWith(USER_ID);
    expect(deps.userSettingsRepository.clearNexusUsername).not.toHaveBeenCalled();
  });

  it('resolves a store from an official event URL and saves its Riot organizer', async () => {
    const deps = harness();
    await deps.handler(context(`/mytable store ${EVENT_URL} Europe/Madrid`));

    expect(deps.eventRepository.getEventById).toHaveBeenCalledWith(
      'riot:117093196872746571',
      { latitude: 37.39, longitude: -5.99, numMiles: 25 },
    );
    expect(deps.userSettingsRepository.setMytableStore).toHaveBeenCalledWith(USER_ID, {
      organizerId: ORGANIZER_ID,
      name: 'Jupiter Juegos',
      latitude: 37.39,
      longitude: -5.99,
      timezone: 'Europe/Madrid',
    });
  });

  it('does not accept an unofficial URL as a store selection', async () => {
    const deps = harness();
    const ctx = context('/mytable store https://example.com/events/123456789');

    await deps.handler(ctx);

    expect(deps.eventRepository.getEventById).not.toHaveBeenCalled();
    expect(deps.userSettingsRepository.setMytableStore).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('official PlayRiftbound event URL'));
  });

  it('defaults to the event timezone when the selected store has no timezone', async () => {
    const deps = harness();
    await deps.handler(context(`/mytable store ${EVENT_URL}`));

    expect(deps.userSettingsRepository.setMytableStore).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ timezone: 'UTC' }),
    );
  });

  it('runs a one-off lookup for a chosen official event without saving the name', async () => {
    const deps = harness();
    const ctx = context(`/mytable event ${EVENT_URL} Zoë#EUW`);

    await deps.handler(ctx);

    expect(deps.nexusTableRepository.getTable).toHaveBeenCalledWith({
      username: 'Zoë#EUW',
      store: expect.objectContaining({ organizerId: ORGANIZER_ID }),
      eventId: 'riot:117093196872746571',
    });
    expect(deps.userSettingsRepository.setNexusUsername).not.toHaveBeenCalled();
  });

  it('rejects unsupported team events for an explicit event lookup', async () => {
    const deps = harness();
    vi.mocked(deps.eventRepository.getEventById).mockResolvedValue(
      baseEvent({ supportsTracking: false }),
    );
    const ctx = context(`/mytable event ${EVENT_URL} Zoë#EUW`);

    await deps.handler(ctx);

    expect(deps.nexusTableRepository.getTable).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('currently supports 1v1'));
  });
});
