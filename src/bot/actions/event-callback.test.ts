import { encodeEventId, encodeRoundId, watchSelectionCallback, decodeWatchCallback } from '../utils/event-callback-codec.js';
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { createEventActionHandler } from './event-callback.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { EventDetail } from '../../core/entities/event-detail.js';
import type { EventWatch } from '../../core/entities/event-watch.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { createEventNavigationContext } from '../state/event-navigation-context.js';

const event = {
  id: 42,
  name: 'Test Event',
  displayStatus: 'inProgress' as const,
  eventStatus: 'IN_PROGRESS',
  startDatetime: '2026-08-01T10:00:00Z',
  endDatetime: '2026-08-01T14:00:00Z',
  timezone: 'Europe/Madrid',
  capacity: 32,
  registeredCount: 9,
  startingPlayerCount: 9,
  store: { id: 1, name: 'Store', fullAddress: '', latitude: 0, longitude: 0, timezone: null, country: null },
  gameplayFormatName: 'Constructed',
  headerImageUrl: null,
  queueStatus: 'ACCEPTING_SIGNUPS',
  eventType: 'LOCALS',
  eventFormat: 'OTHER',
  description: '',
  costInCents: 0,
  currency: 'EUR',
  isOnDemand: false,
  isTestEvent: false,
  tournamentPhases: [],
};

const registrations = Array.from({ length: 9 }, (_, index) => ({
  id: 100 + index,
  name: `Player ${index + 1}`,
  status: 'Active' as const,
  profileImageUrl: null,
  matchesWon: 0,
  matchesLost: 0,
  matchesDrawn: 0,
  isGuest: false,
  finalPlaceInStandings: null,
}));

function detail(roster = registrations): EventDetail {
  return {
    event,
    currentRound: null,
    registrations: roster,
    pairings: [],
    standings: [],
    fetchedAt: new Date().toISOString(),
  };
}

function makeContext(data: string): Context {
  return {
    from: { id: 7, is_bot: false, first_name: 'Tester' },
    chat: { id: 7, type: 'private' },
    callbackQuery: { id: 'callback', data, chat_instance: 'chat', message: {} } as never,
    answerCbQuery: vi.fn().mockResolvedValue(true),
    reply: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  } as unknown as Context;
}

function makeHandler(
  detailValue: EventDetail,
  watchManager: IEventWatchManager,
  eventNavigationContext = createEventNavigationContext(),
) {
  const eventRepository: IEventRepository = {
    getEventById: vi.fn(),
    getEventRegistrations: vi.fn(),
    getEventMatches: vi.fn(),
    getEventStandings: vi.fn(),
    getEventDetail: vi.fn().mockResolvedValue(detailValue),
  };
  const eventListingRepository: IEventListingRepository = { getEvents: vi.fn() };
  const userSettingsRepository: IUserSettingsRepository = {
    getLocation: vi.fn().mockResolvedValue(null),
    setLocation: vi.fn(),
    clearLocation: vi.fn(),
    getNexusUsername: vi.fn(),
    setNexusUsername: vi.fn(),
    clearNexusUsername: vi.fn(),
    getMytableStore: vi.fn().mockResolvedValue(null),
    setMytableStore: vi.fn(),
    clearMytableStore: vi.fn(),
  };
  const handler = createEventActionHandler({
    eventRepository,
    eventListingRepository,
    watchManager,
    userSettingsRepository,
    eventNavigationContext,
    defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    daysAhead: 7,
    adminTelegramIds: [],
  });
  return { handler, eventRepository };
}
function watchManager(): IEventWatchManager & { requestSubscription: ReturnType<typeof vi.fn> } {
  const requestSubscription = vi.fn().mockResolvedValue({
    kind: 'subscribed',
    replaced: false,
    watch: {
      telegramId: 7,
      revision: 'revision-1',
      eventId: 42,
      eventName: 'Test Event',
      eventUsername: 'Player 9',
      hasObservedPairing: false,
      lastSeenRound: null,
      lastSeenTable: null,
      lastSeenOpponent: null,
      lastSeenResult: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastCheckedAt: null,
      consecutiveFailures: 0,
      consecutiveMissing: 0,
    } satisfies EventWatch,
  });
  return {
    list: vi.fn(),
    getStatus: vi.fn(),
    refreshStatus: vi.fn(),
    requestSubscription,
    replaceSubscription: vi.fn(),
    stop: vi.fn(),
  };

}
describe('event watch callbacks', () => {
  it('renders page 2 and gives the ninth player a stable selection callback', async () => {
    const watch = watchManager();
    const { handler } = makeHandler(detail(), watch);
    const ctx = makeContext('event:42:watch:page:1');

    await handler(ctx);

    const keyboard = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .reply_markup.inline_keyboard;
    expect(keyboard[0]![0]!.text).toBe('Player 9 (Active)');
    expect(keyboard[0]![0]!.callback_data).toBe('event:42:watch:select:108');
    expect(watch.requestSubscription).not.toHaveBeenCalled();
  });

  it('selects the refreshed registration by ID, not by stale page index', async () => {
    const watch = watchManager();
    const reordered = [registrations[8]!, ...registrations.slice(0, 8)];
    const { handler } = makeHandler(detail(reordered), watch);
    const ctx = makeContext('event:42:watch:select:108');

    await handler(ctx);

    expect(watch.requestSubscription).toHaveBeenCalledWith(7, expect.objectContaining({
      eventId: 42,
      eventUsername: 'Player 9',
    }));
  });

  it('reports instead of upserting when a registration ID disappeared', async () => {
    const watch = watchManager();
    const { handler } = makeHandler(detail(registrations.slice(0, 8)), watch);
    const ctx = makeContext('event:42:watch:select:108');

    await handler(ctx);

    expect(watch.requestSubscription).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith('Roster changed, please try again.');
  });
});


describe('Riot event navigation and player selection', () => {
  const eventId = 'riot:117093196872746571' as const;
  const playerId = '01234567-89ab-cdef-0123-456789abcdef';
  function riotDetail(): EventDetail {
    return { ...detail(), event: { ...event, id: eventId }, registrations: [
      { ...registrations[0]!, id: playerId, name: 'Same name' },
      { ...registrations[1]!, id: '11234567-89ab-cdef-0123-456789abcdef', name: 'Same name' },
    ] };
  }

  it('renders compact roster buttons and subscribes using the selected player UUID', async () => {
    const watch = watchManager();
    const { handler } = makeHandler(riotDetail(), watch);
    const ctx = makeContext(`event:${encodeEventId(eventId)}:watch:start`);
    await handler(ctx);
    const buttons = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]![1].reply_markup.inline_keyboard;
    const data = buttons[0][0].callback_data;
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(decodeWatchCallback(data)).toEqual({ eventId, registrationId: playerId });
    await handler(makeContext(data));
    expect(watch.requestSubscription).toHaveBeenCalledWith(7, {
      eventId, supportsTracking: true, eventName: 'Test Event', eventUsername: 'Same name', registrationId: playerId,
    });
  });

  it('keeps replace confirmation within 64 bytes even when the previous watch uses a legacy revision', async () => {
    const watch = watchManager();
    watch.requestSubscription.mockResolvedValue({ kind: 'needs-confirmation', current: {
      eventId: 42, eventName: 'Previous', eventUsername: 'Other', revision: '0123456789abcdef0123456789abcdef',
    } });
    const { handler } = makeHandler(riotDetail(), watch);
    const ctx = makeContext(watchSelectionCallback(eventId, playerId));
    await handler(ctx);
    const keyboard = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]![1].reply_markup.inline_keyboard;
    const replacement = keyboard[0][0].callback_data;
    expect(Buffer.byteLength(replacement)).toBeLessThanOrEqual(64);
    expect(decodeWatchCallback(replacement)).toEqual({ eventId, registrationId: playerId,
      revision: '0123456789abcdef0123456789abcdef' });
  });

  it('resolves rounds by stable composite identity when two phases both have round one', async () => {
    const first = 'riot:117093196872746571:stage-a:section-a:1';
    const second = 'riot:117093196872746571:stage-b:section-b:1';
    const row = (id: string) => ({ id, roundNumber: 1, status: 'COMPLETE', pairingsStatus: null, standingsStatus: null });
    const value = riotDetail();
    const data = { ...value, event: { ...value.event, tournamentPhases: [
      { id: 'a', status: 'COMPLETE', orderInPhases: 0, phaseName: 'Swiss', rounds: [row(first)] },
      { id: 'b', status: 'IN_PROGRESS', orderInPhases: 1, phaseName: 'Final', rounds: [row(second)] },
    ] } };
    const { handler, eventRepository } = makeHandler(data, watchManager());
    (eventRepository.getEventMatches as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const ctx = makeContext(`event:${encodeEventId(eventId)}:rounds:round:${encodeRoundId(second)}`);
    await handler(ctx);
    expect(eventRepository.getEventMatches).toHaveBeenCalledWith(second);
    const keyboard = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]![1].reply_markup.inline_keyboard;
    const previous = keyboard[0][0].callback_data;
    expect(previous).toContain(encodeRoundId(first));
    expect(Buffer.byteLength(previous)).toBeLessThanOrEqual(64);
  });

  it('does not allow player tracking in unsupported formats or group chats', async () => {
    const watch = watchManager();
    const data = riotDetail();
    const { handler } = makeHandler({ ...data, event: { ...data.event, supportsTracking: false } }, watch);
    const ctx = makeContext(watchSelectionCallback(eventId, playerId));
    await handler(ctx);
    expect(watch.requestSubscription).not.toHaveBeenCalled();
    const group = makeContext(watchSelectionCallback(eventId, playerId));
    Object.assign(group, { chat: { id: -10, type: 'group' } });
    await handler(group);
    expect(group.reply).toHaveBeenCalledWith('Watch management is available in a private chat with me.');
  });
});
