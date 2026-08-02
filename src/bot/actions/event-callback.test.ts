import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { createEventActionHandler } from './event-callback.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { EventDetail } from '../../core/entities/event-detail.js';
import type { EventWatch } from '../../core/entities/event-watch.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
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
    callbackQuery: { id: 'callback', data, chat_instance: 'chat', message: {} } as never,
    answerCbQuery: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  } as unknown as Context;
}

function makeHandler(detailValue: EventDetail, watchRepository: IEventWatchRepository) {
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
    watchRepository,
    userSettingsRepository,
    defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    daysAhead: 7,
    adminTelegramIds: [],
  });
  return { handler, eventRepository };
}
function watchRepository(): IEventWatchRepository & { upsert: ReturnType<typeof vi.fn> } {
  const upsert = vi.fn<[EventWatch], Promise<void>>().mockResolvedValue(undefined);
  return {
    list: vi.fn(),
    get: vi.fn(),
    upsert,
    delete: vi.fn(),
    updateLastSeen: vi.fn(),
  } as unknown as IEventWatchRepository & { upsert: ReturnType<typeof vi.fn> };

}
describe('event watch callbacks', () => {
  it('renders page 2 and gives the ninth player a stable selection callback', async () => {
    const watch = watchRepository();
    const { handler } = makeHandler(detail(), watch);
    const ctx = makeContext('event:42:watch:page:1');

    await handler(ctx);

    const keyboard = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]![1]
      .reply_markup.inline_keyboard;
    expect(keyboard[0]![0]!.text).toBe('Player 9 (Active)');
    expect(keyboard[0]![0]!.callback_data).toBe('event:42:watch:select:108');
    expect(watch.upsert).not.toHaveBeenCalled();
  });

  it('selects the refreshed registration by ID, not by stale page index', async () => {
    const watch = watchRepository();
    const reordered = [registrations[8]!, ...registrations.slice(0, 8)];
    const { handler } = makeHandler(detail(reordered), watch);
    const ctx = makeContext('event:42:watch:select:108');

    await handler(ctx);

    expect(watch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 42,
      eventUsername: 'Player 9',
    }));
  });

  it('alerts instead of upserting when a registration ID disappeared', async () => {
    const watch = watchRepository();
    const { handler } = makeHandler(detail(registrations.slice(0, 8)), watch);
    const ctx = makeContext('event:42:watch:select:108');

    await handler(ctx);

    expect(watch.upsert).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenLastCalledWith('Roster changed, please try again.', { show_alert: true });
  });
});
