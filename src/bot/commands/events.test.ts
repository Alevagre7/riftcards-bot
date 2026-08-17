import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Context } from 'telegraf';
import {
  createEventsCommand,
  renderEventWindowMenu,
} from './events.js';
import { setupFlow } from '../state/setup-flow.js';
import type { IEventNavigationContext } from '../state/event-navigation-context.js';
import { createEventNavigationContext } from '../state/event-navigation-context.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { Event } from '../../core/entities/event.js';
import { EventListing } from '../../core/entities/event-listing.js';
import { createEventActionHandler } from '../actions/event-callback.js';

const TEST_USER_ID = 123;
let navigationContext: IEventNavigationContext;

beforeEach(() => {
  navigationContext = createEventNavigationContext();
});

function makeCtx(text?: string): Context {
  // Test mock: the only fields the command under test reads are `from`,
  // `message.text`, and `sendChatAction` (for the typing indicator).
  // Cast to Context at the boundary.
  const mock: {
    from: { id: number; is_bot: boolean; first_name: string };
    reply: ReturnType<typeof vi.fn>;
    sendChatAction: ReturnType<typeof vi.fn>;
    message?: { text: string };
  } = {
    from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test' },
    reply: vi.fn(),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
  };
  if (text !== undefined) {
    mock.message = { text };
  }
  return mock as unknown as Context;
}

function mockUserSettingsRepo(): IUserSettingsRepository & {
  setLocation: Mock;
} {
  return {
    getLocation: vi.fn().mockResolvedValue(null),
    setLocation: vi.fn().mockResolvedValue(undefined),
    clearLocation: vi.fn().mockResolvedValue(undefined),
    getNexusUsername: vi.fn().mockResolvedValue(null),
    setNexusUsername: vi.fn().mockResolvedValue(undefined),
    clearNexusUsername: vi.fn().mockResolvedValue(undefined),
  };
}

function mockEventRepo(): IEventRepository & { getEvents: Mock } {
  return {
    getEvents: vi.fn().mockResolvedValue([]),
    getEventById: vi.fn().mockResolvedValue(null),
    getEventRegistrations: vi.fn().mockResolvedValue([]),
    getEventMatches: vi.fn().mockResolvedValue([]),
    getEventStandings: vi.fn().mockResolvedValue([]),
    getEventDetail: vi.fn().mockResolvedValue(null),
  };
}

function getReplyText(ctx: Context): string {
  const call = (ctx.reply as Mock).mock.calls[0];
  return call?.[0] ?? '';
}

function getReplyMarkup(ctx: Context): unknown {
  const call = (ctx.reply as Mock).mock.calls[0];
  return call?.[1]?.reply_markup;
}

function getReplyKeyboard(
  ctx: Context,
): { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined {
  const call = (ctx.reply as Mock).mock.calls.at(-1);
  return call?.[1]?.reply_markup as
    | { inline_keyboard: { text: string; callback_data?: string }[][] }
    | undefined;
}

describe('createEventsCommand — /events set inline coords', () => {
  let userSettings: ReturnType<typeof mockUserSettingsRepo>;
  let eventRepo: ReturnType<typeof mockEventRepo>;

  beforeEach(() => {
    userSettings = mockUserSettingsRepo();
    eventRepo = mockEventRepo();
    // Singleton setupFlow may carry state between tests; reset for the user
    // id used in these tests so order-dependent failures don't sneak in.
    setupFlow.cancel(TEST_USER_ID);
  });

  function makeCmd() {
    return createEventsCommand({
      eventRepository: eventRepo,
      eventListingRepository: eventRepo,
      userSettingsRepository: userSettings,
      eventNavigationContext: navigationContext,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
      defaultRadiusKm: 80,
      daysAhead: 7,
    });
  }

  it('saves inline coords and replies with a confirmation', async () => {
    const ctx = makeCtx('/events set 42.5, -83.8');
    const cmd = makeCmd();

    await cmd(ctx);

    expect(userSettings.setLocation).toHaveBeenCalledWith(TEST_USER_ID, {
      latitude: 42.5,
      longitude: -83.8,
      radiusKm: 80,
    });
    const text = getReplyText(ctx);
    expect(text).toContain('Location saved');
    expect(text).toContain('42.5');
  });

  it('accepts high-precision coords with extra whitespace', async () => {
    const ctx = makeCtx(
      '/events set   42.58836934328923  ,  -83.87718629792093  ',
    );
    const cmd = makeCmd();

    await cmd(ctx);

    expect(userSettings.setLocation).toHaveBeenCalledWith(TEST_USER_ID, {
      latitude: 42.58836934328923,
      longitude: -83.87718629792093,
      radiusKm: 80,
    });
  });

  it.each([
    ['/events set 42.5'],
    ['/events set 42.5, -83.8, 100'],
    ['/events set abc, def'],
    ['/events set 42.5; -83.8'],
  ])('rejects invalid input "%s" without calling setLocation', async (text) => {
    const ctx = makeCtx(text);
    const cmd = makeCmd();

    await cmd(ctx);

    expect(userSettings.setLocation).not.toHaveBeenCalled();
    expect(getReplyText(ctx)).toContain('Invalid coordinates');
  });

  it.each([
    ['/events set 91, 0'],
    ['/events set 0, 181'],
    ['/events set -91, 0'],
    ['/events set 0, -181'],
  ])('rejects out-of-range input "%s" without calling setLocation', async (text) => {
    const ctx = makeCtx(text);
    const cmd = makeCmd();

    await cmd(ctx);

    expect(userSettings.setLocation).not.toHaveBeenCalled();
    expect(getReplyText(ctx)).toContain('out of range');
  });

  it('still opens the pin flow when /events set has no subargs', async () => {
    const startSpy = vi.spyOn(setupFlow, 'start');
    const ctx = makeCtx('/events set');
    const cmd = makeCmd();

    await cmd(ctx);

    const text = getReplyText(ctx);
    expect(text).toContain('Send a location pin');
    expect(getReplyMarkup(ctx)).toBeDefined();
    expect(startSpy).toHaveBeenCalledWith(TEST_USER_ID, 'events-set-location');
    expect(userSettings.setLocation).not.toHaveBeenCalled();

    startSpy.mockRestore();
  });

  it('cancels any in-flight pin flow when inline coords save', async () => {
    // Pre-condition: a pin flow is pending for this user.
    setupFlow.start(TEST_USER_ID, 'events-set-location');
    expect(setupFlow.consume(TEST_USER_ID)).toBe('events-set-location');

    const ctx = makeCtx('/events set 42.5, -83.8');
    const cmd = makeCmd();

    await cmd(ctx);

    // The inline path must cancel the pending flow so a stray later
    // pin doesn't clobber the freshly-saved coords.
    expect(setupFlow.consume(TEST_USER_ID)).toBeNull();
  });
});

describe('createEventsCommand — /events <id> and <url> debug path', () => {
  let userSettings: ReturnType<typeof mockUserSettingsRepo>;
  let eventRepo: ReturnType<typeof mockEventRepo>;
  beforeEach(() => {
    userSettings = mockUserSettingsRepo();
    eventRepo = mockEventRepo();
    setupFlow.cancel(TEST_USER_ID);
  });

  function makeCmd() {
    return createEventsCommand({
      eventRepository: eventRepo,
      eventListingRepository: eventRepo,
      userSettingsRepository: userSettings,
      eventNavigationContext: navigationContext,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
      defaultRadiusKm: 80,
      daysAhead: 7,
    });
  }

  it('/events <id> (>= 1000) renders detail for that event id', async () => {
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 498515 })], 7);

    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce(null);

    const ctx = makeCtx('/events 498515');
    await makeCmd()(ctx);

    expect(eventRepo.getEventById).toHaveBeenCalledWith(498515, expect.anything());
    // The detail page is sent as a reply (not edit) because the
    // command path is not a callback query.
    const replyCall = (ctx.reply as Mock).mock.calls.find((c) => typeof c[0] === 'string');
    expect(replyCall).toBeDefined();
    expect(replyCall?.[0]).toContain('<b>Test Event</b>');
    expect(navigationContext.getEventList(TEST_USER_ID)).toBeNull();

    const texts = (getReplyKeyboard(ctx)?.inline_keyboard ?? []).flat().map((button) => button.text);
    expect(texts).not.toContain('\u2190 Back to list');
  });

  it('/events <locator-url> extracts the id and renders detail', async () => {
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 498515 })], 7);

    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce(null);

    const ctx = makeCtx('/events https://locator.riftbound.uvsgames.com/events/498515');
    await makeCmd()(ctx);

    expect(eventRepo.getEventById).toHaveBeenCalledWith(498515, expect.anything());
    const replyCall = (ctx.reply as Mock).mock.calls.find((c) => typeof c[0] === 'string');
    expect(replyCall).toBeDefined();
    expect(replyCall?.[0]).toContain('<b>Test Event</b>');
    expect(navigationContext.getEventList(TEST_USER_ID)).toBeNull();

    const texts = (getReplyKeyboard(ctx)?.inline_keyboard ?? []).flat().map((button) => button.text);
    expect(texts).not.toContain('\u2190 Back to list');
  });

  it('/events <small number> still means days (no event lookup)', async () => {
    (eventRepo.getEvents as Mock).mockResolvedValueOnce([]);
    const ctx = makeCtx('/events 5');
    await makeCmd()(ctx);

    expect(eventRepo.getEvents).toHaveBeenCalledTimes(1);
    expect(eventRepo.getEventById).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Helpers for the /events show-path tests
// ---------------------------------------------------------------------------

function makeShowCtx(text?: string): Context {
  // Same shape as makeCtx but allows the test to also pass through
  // ctx.callbackQuery (for the action-handler tests below).
  return makeCtx(text);
}

function baseEvent(over: Partial<Event> = {}): Event {
  return {
    id: 1,
    name: 'Test Event',
    displayStatus: 'upcoming',
    eventStatus: 'SCHEDULED',
    startDatetime: '2026-08-01T18:00:00+00:00',
    endDatetime: '2026-08-01T22:00:00+00:00',
    timezone: 'Europe/Madrid',
    capacity: 8,
    registeredCount: 0,
    startingPlayerCount: 0,
    store: {
      id: 1,
      name: 'Test Store',
      fullAddress: '',
      latitude: 0,
      longitude: 0,
      timezone: 'Europe/Madrid',
      country: 'ES',
    },
    gameplayFormatName: '',
    headerImageUrl: null,
    queueStatus: 'ACCEPTING_SIGNUPS',
    eventType: '',
    eventFormat: '',
    description: '',
    costInCents: 0,
    currency: 'EUR',
    isOnDemand: false,
    isTestEvent: false,
    tournamentPhases: [],
    ...over,
  };
}
function baseListing(over: Partial<EventListing> = {}): EventListing {
  return {
    id: 1,
    name: 'Test Event',
    startDatetime: '2026-08-01T18:00:00+00:00',
    endDatetime: '2026-08-01T22:00:00+00:00',
    mode: 'Other',
    storeName: 'Test Store',
    registeredCount: 0,
    capacity: 8,
    ...over,
  };
}
function multiEventListings(): EventListing[] {
  return Array.from({ length: 9 }, (_, index) => {
    const start = new Date(Date.UTC(2999, 0, index + 1, 12));
    return baseListing({
      id: 100 + index,
      name: `Event ${index + 1}`,
      startDatetime: start.toISOString(),
      endDatetime: new Date(start.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    });
  });
}

// ---------------------------------------------------------------------------
// /events window menu + in-progress

describe('createEventsCommand — /events window menu', () => {
  let userSettings: ReturnType<typeof mockUserSettingsRepo>;
  let eventRepo: ReturnType<typeof mockEventRepo>;

  beforeEach(() => {
    userSettings = mockUserSettingsRepo();
    eventRepo = mockEventRepo();
  });

  function makeCmd(over: Partial<{ now: () => Date }> = {}) {
    return createEventsCommand({
      eventRepository: eventRepo,
      eventListingRepository: eventRepo,
      userSettingsRepository: userSettings,
      eventNavigationContext: navigationContext,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
      defaultRadiusKm: 80,
      daysAhead: 7,
      ...over,
    });
  }

  it('/events (no args) shows the menu and does NOT fetch', async () => {
    const ctx = makeShowCtx('/events');
    const cmd = makeCmd();

    await cmd(ctx);

    expect(eventRepo.getEvents).not.toHaveBeenCalled();
    const text = (ctx.reply as Mock).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Pick a time window');

    const kb = getReplyKeyboard(ctx);
    expect(kb).toBeDefined();
    const rows = kb!.inline_keyboard;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[0]!.text)).toEqual(['1 day', '3 days', '5 days', '1 week']);
    expect(rows.map((r) => r[0]!.callback_data)).toEqual([
      'event:range:1',
      'event:range:3',
      'event:range:5',
      'event:range:7',
    ]);
  });

  it('/events <N> calls getEvents with the right window and lookback', async () => {
    const fixedNow = new Date('2026-08-01T00:00:00Z');
    const ctx = makeShowCtx('/events 5');
    const cmd = makeCmd({ now: () => fixedNow });

    await cmd(ctx);

    expect(eventRepo.getEvents).toHaveBeenCalledTimes(1);
    const [startAfter, startBefore] = (eventRepo.getEvents as Mock).mock.calls[0] as [
      Date,
      Date,
      EventLocation,
    ];
    expect(startAfter.toISOString()).toBe('2026-07-31T12:00:00.000Z');
    expect(startBefore.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });

  it('includes an in-progress event', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z');
    const inProgress = baseListing({
      id: 1,
      name: 'In-Progress Tournament',
      startDatetime: new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      endDatetime: new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    });
    eventRepo.getEvents.mockResolvedValueOnce([inProgress]);
    const ctx = makeShowCtx('/events 1');
    await makeCmd({ now: () => fixedNow })(ctx);
    const ids = getReplyKeyboard(ctx)!.inline_keyboard.flat()
      .map((button) => button.callback_data)
      .filter((value): value is string => typeof value === 'string');
    expect(ids).toContain('event:list:1');
  });

  it('excludes a finished event', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z');
    const finished = baseListing({
      id: 1,
      name: 'Already Over',
      startDatetime: new Date(fixedNow.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      endDatetime: new Date(fixedNow.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    });
    eventRepo.getEvents.mockResolvedValueOnce([finished]);
    const ctx = makeShowCtx('/events 1');
    await makeCmd({ now: () => fixedNow })(ctx);
    expect((ctx.reply as Mock).mock.calls.at(-1)?.[0]).toContain('No events found');
  });

  it('includes an upcoming event within the window', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z');
    const upcoming = baseListing({
      id: 1,
      name: 'Weekend Skirmish',
      startDatetime: new Date(fixedNow.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      endDatetime: new Date(fixedNow.getTime() + 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000).toISOString(),
    });
    eventRepo.getEvents.mockResolvedValueOnce([upcoming]);
    const ctx = makeShowCtx('/events 5');
    await makeCmd({ now: () => fixedNow })(ctx);
    const ids = getReplyKeyboard(ctx)!.inline_keyboard.flat()
      .map((button) => button.callback_data)
      .filter((value): value is string => typeof value === 'string');
    expect(ids).toContain('event:list:1');
  });
});

// ---------------------------------------------------------------------------
// renderEventWindowMenu (standalone)
// ---------------------------------------------------------------------------

describe('renderEventWindowMenu', () => {
  it('sends the menu with 4 buttons and the prompt', async () => {
    const ctx = makeShowCtx();
    await renderEventWindowMenu(ctx);

    const text = (ctx.reply as Mock).mock.calls[0]?.[0] ?? '';
    expect(text).toContain('Pick a time window');

    const kb = getReplyKeyboard(ctx);
    expect(kb!.inline_keyboard).toHaveLength(4);
    expect(kb!.inline_keyboard[0]?.[0]?.callback_data).toBe('event:range:1');
    expect(kb!.inline_keyboard[3]?.[0]?.callback_data).toBe('event:range:7');
  });
});

// ---------------------------------------------------------------------------
// event:list back-to-list fix — uses the last-picked daysAhead
// ---------------------------------------------------------------------------
function makeCallbackCtx(data: string, telegramUserId = TEST_USER_ID): Context {
  const ctx: {
    from: { id: number; is_bot: boolean; first_name: string };
    reply: ReturnType<typeof vi.fn>;
    answerCbQuery: ReturnType<typeof vi.fn>;
    sendChatAction: ReturnType<typeof vi.fn>;
    editMessageText: Mock;
    callbackQuery: { data: string; message: unknown };
  } = {
    from: { id: telegramUserId, is_bot: false, first_name: 'Test' },
    reply: vi.fn(),
    answerCbQuery: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    callbackQuery: { data, message: { message_id: 1, chat: { id: 1, type: 'private' } } },
  };
  return ctx as unknown as Context;
}

describe('createEventActionHandler — event:list back-to-list fix', () => {
  let eventRepo: ReturnType<typeof mockEventRepo>;
  let userSettings: ReturnType<typeof mockUserSettingsRepo>;

  beforeEach(() => {
    eventRepo = mockEventRepo();
    userSettings = mockUserSettingsRepo();
  });

  function makeHandler(defaultDaysAhead: number) {
    return createEventActionHandler({
      eventRepository: eventRepo,
      eventListingRepository: eventRepo,
      watchManager: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        getStatus: vi.fn(),
        refreshStatus: vi.fn(),
        requestSubscription: vi.fn(),
        replaceSubscription: vi.fn(),
        stop: vi.fn(),
      } as never,
      userSettingsRepository: userSettings,
      eventNavigationContext: navigationContext,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
      daysAhead: defaultDaysAhead,
      adminTelegramIds: [],
    });
  }

  it('event:list uses the user\'s last-picked daysAhead from navigation context', async () => {
    const fixedNow = new Date('2026-08-01T00:00:00Z');
    // Pre-populate: user picked 14 days earlier.
    navigationContext.rememberEventList(TEST_USER_ID, [], 14);
    (eventRepo.getEvents as Mock).mockResolvedValueOnce([]);

    const ctx = makeCallbackCtx('event:list');
    const handler = makeHandler(/* config default */ 7);
    // Inject a fake clock for the renderEventList call.
    await handler(ctx);

    expect(eventRepo.getEvents).toHaveBeenCalledTimes(1);
    const [startAfter, startBefore] = (eventRepo.getEvents as Mock).mock.calls[0] as [Date, Date];
    // 14 days + 12h lookback.
    const delta = startBefore.getTime() - startAfter.getTime();
    expect(delta).toBe(14 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  });

  it('event:list falls back to deps.daysAhead when no navigation context is set', async () => {
    const fixedNow = new Date('2026-08-01T00:00:00Z');
    (eventRepo.getEvents as Mock).mockResolvedValueOnce([]);

    const ctx = makeCallbackCtx('event:list');
    const handler = makeHandler(/* config default */ 7);
    await handler(ctx);

    expect(eventRepo.getEvents).toHaveBeenCalledTimes(1);
    const [startAfter, startBefore] = (eventRepo.getEvents as Mock).mock.calls[0] as [Date, Date];
    const delta = startBefore.getTime() - startAfter.getTime();
    expect(delta).toBe(7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000);
  });

  it('renders an active Event list page without refetching listings', async () => {
    const listings = multiEventListings();
    navigationContext.rememberEventList(TEST_USER_ID, listings, 14);

    const ctx = makeCallbackCtx('event:page:1');
    await makeHandler(7)(ctx);

    expect(eventRepo.getEvents).not.toHaveBeenCalled();
    const editMessageText = (ctx as unknown as { editMessageText: Mock }).editMessageText;
    expect(editMessageText).toHaveBeenCalledTimes(1);
    const [body, options] = editMessageText.mock.calls[0] as [
      string,
      { reply_markup?: { inline_keyboard: { callback_data?: string }[][] } },
    ];
    expect(body).toContain('<b>9</b> events in the next 14 days');
    const callbackData = (options.reply_markup?.inline_keyboard ?? [])
      .flat()
      .map((button) => button.callback_data);
    expect(callbackData).toContain('event:list:108');
    expect(callbackData).toContain('event:page:0');
  });

  it('refetches expired Event list pagination with the configured default window', async () => {
    let now = 1_000_000;
    navigationContext = createEventNavigationContext(() => now);
    navigationContext.rememberEventList(TEST_USER_ID, multiEventListings(), 14);
    now += 5 * 60 * 1000 + 1;

    const recovered = baseListing({
      id: 999,
      name: 'Recovered Event',
      startDatetime: '2999-01-01T12:00:00Z',
      endDatetime: '2999-01-01T16:00:00Z',
    });
    eventRepo.getEvents.mockResolvedValueOnce([recovered]);

    const ctx = makeCallbackCtx('event:page:0');
    await makeHandler(7)(ctx);

    expect(eventRepo.getEvents).toHaveBeenCalledTimes(1);
    const [startAfter, startBefore] = (eventRepo.getEvents as Mock).mock.calls[0] as [Date, Date];
    expect(startBefore.getTime() - startAfter.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
    );

    const editMessageText = (ctx as unknown as { editMessageText: Mock }).editMessageText;
    expect(editMessageText).toHaveBeenCalledTimes(1);
    const [body, options] = editMessageText.mock.calls[0] as [
      string,
      { reply_markup?: { inline_keyboard: { callback_data?: string }[][] } },
    ];
    expect(body).toContain('<b>1</b> event in the next 7 days');
    const callbackData = (options.reply_markup?.inline_keyboard ?? [])
      .flat()
      .map((button) => button.callback_data);
    expect(callbackData).toContain('event:list:999');
  });

  it('does not reuse an Event list context across TelegramUsers', async () => {
    const listings = multiEventListings();
    navigationContext.rememberEventList(TEST_USER_ID, listings, 14);

    const recovered = baseListing({
      id: 999,
      name: 'Recovered Event',
      startDatetime: '2999-01-01T12:00:00Z',
      endDatetime: '2999-01-01T16:00:00Z',
    });
    eventRepo.getEvents.mockResolvedValueOnce([recovered]);

    const ctx = makeCallbackCtx('event:page:1', 456);
    await makeHandler(7)(ctx);

    expect(eventRepo.getEvents).toHaveBeenCalledTimes(1);
    const editMessageText = (ctx as unknown as { editMessageText: Mock }).editMessageText;
    expect(editMessageText).toHaveBeenCalledTimes(1);
    const body = editMessageText.mock.calls[0]?.[0] as string;
    expect(body).toContain('<b>1</b> event in the next 7 days');
    expect(body).not.toContain('<b>9</b> events in the next 14 days');
    expect(navigationContext.getEventList(TEST_USER_ID)).toEqual({
      events: listings,
      daysAhead: 14,
    });
  });

  it('hides Back to list on event:<id> callback re-render when the user fetched by id/URL (no list context)', async () => {
    // A fresh context represents the direct /events <id> path with no list.
    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);
    // A started event: isStarted true → Leaderboard/All tables shown.
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce({
      currentRound: { id: 9, roundNumber: 1, status: 'IN_PROGRESS' },
    });

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:498515');
    // Detail render edits in place because makeCallbackCtx carries a
    // callbackQuery.message.
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    expect(editMessageText).toHaveBeenCalled();
    const call = editMessageText.mock.calls[0] as [string, { reply_markup?: { inline_keyboard: { text: string }[][] } }];
    const texts = (call[1]?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(texts).not.toContain('\u2190 Back to list');
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
  });

  it('keeps direct-origin suppression through leaderboard, rounds, and back-to-event', async () => {
    navigationContext.openEventDirectly(TEST_USER_ID, 498515);
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 498515 })], 7);

    const currentRound = {
      id: 9,
      roundNumber: 1,
      status: 'IN_PROGRESS' as const,
      pairingsStatus: 'GENERATED',
      standingsStatus: 'GENERATED',
    };
    const detail = {
      event: {
        ...baseEvent({ id: 498515 }),
        tournamentPhases: [{
          id: 1,
          status: 'IN_PROGRESS' as const,
          orderInPhases: 1,
          phaseName: 'Swiss',
          rounds: [currentRound],
        }],
      },
      currentRound,
      registrations: [],
      pairings: [],
      standings: [{
        rank: 1,
        name: 'Alice',
        roundNumber: 1,
        matchRecord: '1-0-0',
        points: 3,
        opponentMatchWinPercentage: 0.5,
        gameWinPercentage: 0.5,
        opponentGameWinPercentage: 0.5,
      }],
      fetchedAt: '2026-08-01T00:00:00Z',
    };
    (eventRepo.getEventById as Mock).mockResolvedValue(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValue([]);
    (eventRepo.getEventDetail as Mock).mockResolvedValue(detail);

    const handler = makeHandler(7);
    async function renderCallback(data: string): Promise<string[]> {
      const editMessageText = vi.fn().mockResolvedValue(undefined);
      const ctx = makeCallbackCtx(data);
      const callbackContext = ctx as unknown as { editMessageText: Mock };
      callbackContext.editMessageText = editMessageText;
      await handler(ctx);
      const call = editMessageText.mock.calls[0] as [
        string,
        { reply_markup?: { inline_keyboard: { text: string }[][] } },
      ];
      return (call[1]?.reply_markup?.inline_keyboard ?? []).flat().map((button) => button.text);
    }

    await renderCallback('event:498515:leaderboard');
    await renderCallback('event:498515:rounds');
    const texts = await renderCallback('event:498515');

    expect(texts).not.toContain('\u2190 Back to list');
  });

  it('keeps Back to list hidden on direct-fetched events even after a stale list-context re-arm', async () => {
    // Direct fetch marks the (user, event) origin (as the /events <id>
    // path does); a stale "Back to list" tap re-arms the list context.
    // The button must stay hidden for this direct-fetched event.
    navigationContext.openEventDirectly(TEST_USER_ID, 498515);
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 498515 })], 7);
    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce({
      currentRound: { id: 9, roundNumber: 1, status: 'IN_PROGRESS' },
    });

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:498515');
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    const call = editMessageText.mock.calls[0] as [string, { reply_markup?: { inline_keyboard: { text: string }[][] } }];
    const texts = (call[1]?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(texts).not.toContain('\u2190 Back to list');
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
  });

  it('shows Back to list on event:<id> callback re-render when the user has a list context', async () => {
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 498515 })], 7);
    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:498515');
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    const call = editMessageText.mock.calls[0] as [string, { reply_markup?: { inline_keyboard: { text: string }[][] } }];
    const texts = (call[1]?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(texts).toContain('\u2190 Back to list');
  });

  it('restores Back to list after opening an event from a list row', async () => {
    navigationContext.openEventDirectly(TEST_USER_ID, 498515);
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 498515 })], 7);
    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:list:498515');
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    const call = editMessageText.mock.calls[0] as [string, { reply_markup?: { inline_keyboard: { text: string }[][] } }];
    const texts = (call[1]?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(texts).toContain('\u2190 Back to list');
  });

  it('leaderboard falls back to the latest round that has standings data', async () => {
    const round1 = { id: 1, roundNumber: 1, status: 'COMPLETE' as const, pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' };
    const round2 = { id: 2, roundNumber: 2, status: 'IN_PROGRESS' as const, pairingsStatus: 'GENERATED', standingsStatus: 'NOT_GENERATED' };
    const detail = {
      event: {
        ...baseEvent({ id: 498515 }),
        tournamentPhases: [{ id: 1, status: 'IN_PROGRESS' as const, orderInPhases: 1, phaseName: 'P', rounds: [round1, round2] }],
      },
      currentRound: round2,
      registrations: [],
      pairings: [],
      standings: [], // current round has no standings yet
      fetchedAt: '2026-08-01T00:00:00Z',
    };
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce(detail);
    (eventRepo.getEventStandings as Mock).mockResolvedValueOnce([
      { rank: 1, name: 'Alice', wins: 1, losses: 0, draws: 0, matchPoints: 3, matchRecord: '1-0-0' },
    ]);

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:498515:leaderboard');
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    expect(eventRepo.getEventStandings).toHaveBeenCalledWith(1);
    const call = editMessageText.mock.calls[0] as [string, unknown];
    expect(String(call[0])).toContain('Round <b>1</b>');
    expect(String(call[0])).toContain('<b>Alice</b>');
  });

  it('orders round navigation by phase order when round numbers repeat', async () => {
    const phaseOneRound = {
      id: 11,
      roundNumber: 1,
      status: 'COMPLETE' as const,
      pairingsStatus: 'GENERATED',
      standingsStatus: 'GENERATED',
    };
    const phaseTwoRound = {
      id: 22,
      roundNumber: 1,
      status: 'IN_PROGRESS' as const,
      pairingsStatus: 'GENERATED',
      standingsStatus: 'GENERATED',
    };
    const detail = {
      event: {
        ...baseEvent({ id: 498515 }),
        tournamentPhases: [
          { id: 2, status: 'IN_PROGRESS' as const, orderInPhases: 2, phaseName: 'Top Cut', rounds: [phaseTwoRound] },
          { id: 1, status: 'COMPLETE' as const, orderInPhases: 1, phaseName: 'Swiss', rounds: [phaseOneRound] },
        ],
      },
      currentRound: phaseTwoRound,
      registrations: [],
      pairings: [],
      standings: [],
      fetchedAt: '2026-08-01T00:00:00Z',
    };
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce(detail);

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:498515:rounds');
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    const keyboard = (editMessageText.mock.calls[0] as [string, { reply_markup: { inline_keyboard: { callback_data?: string }[][] } }])[1]
      .reply_markup.inline_keyboard;
    expect(keyboard[0]?.[0]?.callback_data).toBe('event:498515:rounds:round:11');
  });

  it('shows Back to list for a different event opened from a list after a direct fetch', async () => {
    // Direct-fetching event 498515 must not hide the button for event
    // 800104 opened from a list: the origin is per (user, event).
    navigationContext.openEventDirectly(TEST_USER_ID, 498515);
    navigationContext.rememberEventList(TEST_USER_ID, [baseListing({ id: 800104 })], 7);
    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 800104 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce({
      currentRound: { id: 9, roundNumber: 1, status: 'IN_PROGRESS' },
    });

    const editMessageText = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCallbackCtx('event:800104');
    (ctx as unknown as { editMessageText: Mock }).editMessageText = editMessageText;
    await makeHandler(7)(ctx);

    const call = editMessageText.mock.calls[0] as [string, { reply_markup?: { inline_keyboard: { text: string }[][] } }];
    const texts = (call[1]?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
    expect(texts).toContain('\u2190 Back to list');
  });
});
