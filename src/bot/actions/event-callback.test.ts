import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { createEventActionHandler } from './event-callback.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { EventDetail } from '../../core/entities/event-detail.js';
import type { EventWatch } from '../../core/entities/event-watch.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';

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

function makeHandler(detailValue: EventDetail, watchManager: IEventWatchManager) {
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
  };
  const handler = createEventActionHandler({
    eventRepository,
    eventListingRepository,
    watchManager,
    userSettingsRepository,
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
