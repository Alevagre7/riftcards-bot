import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Context } from 'telegraf';
import {
  createEventsCommand,
  renderEventWindowMenu,
} from './events.js';
import { setupFlow } from '../state/setup-flow.js';
import { eventsPaginationState } from '../state/events-pagination-state.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { Event } from '../../core/entities/event.js';
import { createEventActionHandler } from '../actions/event-callback.js';

const TEST_USER_ID = 123;

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

function mockEventRepo(): IEventRepository {
  return {
    getEvents: vi.fn().mockResolvedValue([]),
    getEventById: vi.fn().mockResolvedValue(null),
    getEventRegistrations: vi.fn().mockResolvedValue([]),
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
  let eventRepo: IEventRepository;

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
      userSettingsRepository: userSettings,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
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
  let eventRepo: IEventRepository;
  beforeEach(() => {
    userSettings = mockUserSettingsRepo();
    eventRepo = mockEventRepo();
    setupFlow.cancel(TEST_USER_ID);
  });

  function makeCmd() {
    return createEventsCommand({
      eventRepository: eventRepo,
      userSettingsRepository: userSettings,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
      daysAhead: 7,
    });
  }

  it('/events <id> (>= 1000) renders detail for that event id', async () => {
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
    expect(String(replyCall![0])).toContain('<b>Test Event</b>');
  });

  it('/events <locator-url> extracts the id and renders detail', async () => {
    (eventRepo.getEventById as Mock).mockResolvedValueOnce(baseEvent({ id: 498515 }));
    (eventRepo.getEventRegistrations as Mock).mockResolvedValueOnce([]);
    (eventRepo.getEventDetail as Mock).mockResolvedValueOnce(null);

    const ctx = makeCtx('/events https://locator.riftbound.uvsgames.com/events/498515');
    await makeCmd()(ctx);

    expect(eventRepo.getEventById).toHaveBeenCalledWith(498515, expect.anything());
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
// ---------------------------------------------------------------------------
// /events window menu + in-progress

describe('createEventsCommand — /events window menu', () => {
  let userSettings: ReturnType<typeof mockUserSettingsRepo>;
  let eventRepo: IEventRepository;

  beforeEach(() => {
    userSettings = mockUserSettingsRepo();
    eventRepo = mockEventRepo();
    eventsPaginationState.clear(TEST_USER_ID);
  });

  function makeCmd(over: Partial<{ now: () => Date }> = {}) {
    return createEventsCommand({
      eventRepository: eventRepo,
      userSettingsRepository: userSettings,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
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
    const [startAfter, startBefore, _location] = (eventRepo.getEvents as Mock).mock.calls[0] as [
      Date,
      Date,
      EventLocation,
    ];
    // Lower bound: 12h before now.
    expect(startAfter.toISOString()).toBe('2026-07-31T12:00:00.000Z');
    // Upper bound: 5 days after now.
    expect(startBefore.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });

  it('includes an in-progress event (started 2h ago, ends in 2h)', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z');
    const inProgress = baseEvent({
      id: 1,
      name: 'In-Progress Tournament',
      startDatetime: new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      endDatetime: new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    });
    (eventRepo.getEvents as Mock).mockResolvedValueOnce([inProgress]);
    const ctx = makeShowCtx('/events 1');
    const cmd = makeCmd({ now: () => fixedNow });
    await cmd(ctx);
    const kb = getReplyKeyboard(ctx);

    expect(kb).toBeDefined();
    const flatButtons = kb!.inline_keyboard.flat();
    // Button label is icon+date+type+store, not the event name; assert
    // on callback_data (which is `event:<id>`) instead.
    const ids = flatButtons
      .map((b) => b.callback_data)
      .filter((d): d is string => typeof d === 'string');
    expect(ids).toContain('event:1');
  });
  it('excludes a finished event (ended 1h ago)', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z');
    const finished = baseEvent({
      id: 1,
      name: 'Already Over',
      startDatetime: new Date(fixedNow.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      endDatetime: new Date(fixedNow.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    });
    (eventRepo.getEvents as Mock).mockResolvedValueOnce([finished]);

    const ctx = makeShowCtx('/events 1');
    const cmd = makeCmd({ now: () => fixedNow });

    await cmd(ctx);

    const text = (ctx.reply as Mock).mock.calls.at(-1)?.[0] ?? '';
    expect(text).toContain('No events found');
    const kb = getReplyKeyboard(ctx);
    // Either no keyboard or empty keyboard.
    const flat = kb?.inline_keyboard.flat() ?? [];
    expect(flat).toHaveLength(0);
  });

  it('includes an upcoming event well within the window', async () => {
    const fixedNow = new Date('2026-08-01T12:00:00Z');
    const upcoming = baseEvent({
      id: 1,
      name: 'Weekend Skirmish',
      startDatetime: new Date(fixedNow.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      endDatetime: new Date(
        fixedNow.getTime() + 3 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000,
      ).toISOString(),
    });
    (eventRepo.getEvents as Mock).mockResolvedValueOnce([upcoming]);
    const ctx = makeShowCtx('/events 5');
    const cmd = makeCmd({ now: () => fixedNow });
    await cmd(ctx);
    const kb = getReplyKeyboard(ctx);
    const flat = kb!.inline_keyboard.flat();
    const ids = flat
      .map((b) => b.callback_data)
      .filter((d): d is string => typeof d === 'string');
    expect(ids).toContain('event:1');
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
function makeCallbackCtx(data: string): Context {
  const ctx: {
    from: { id: number; is_bot: boolean; first_name: string };
    reply: ReturnType<typeof vi.fn>;
    answerCbQuery: ReturnType<typeof vi.fn>;
    sendChatAction: ReturnType<typeof vi.fn>;
    callbackQuery: { data: string; message: unknown };
  } = {
    from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test' },
    reply: vi.fn(),
    answerCbQuery: vi.fn().mockResolvedValue(undefined),
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    callbackQuery: { data, message: { message_id: 1, chat: { id: 1, type: 'private' } } },
  };
  return ctx as unknown as Context;
}

describe('createEventActionHandler — event:list back-to-list fix', () => {
  let eventRepo: IEventRepository;
  let userSettings: ReturnType<typeof mockUserSettingsRepo>;

  beforeEach(() => {
    eventRepo = mockEventRepo();
    userSettings = mockUserSettingsRepo();
    eventsPaginationState.clear(TEST_USER_ID);
  });

  function makeHandler(defaultDaysAhead: number) {
    return createEventActionHandler({
      eventRepository: eventRepo,
      watchRepository: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
        updateLastSeen: vi.fn(),
      } as never,
      userSettingsRepository: userSettings,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
      daysAhead: defaultDaysAhead,
      adminTelegramIds: [],
    });
  }

  it('event:list uses the user\'s last-picked daysAhead from pagination state', async () => {
    const fixedNow = new Date('2026-08-01T00:00:00Z');
    // Pre-populate: user picked 14 days earlier.
    eventsPaginationState.set(TEST_USER_ID, [], 14);
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

  it('event:list falls back to deps.daysAhead when no pagination state is set', async () => {
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
});
