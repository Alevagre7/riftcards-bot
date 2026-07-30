import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { Context } from 'telegraf';
import { createEventsCommand } from './events.js';
import { setupFlow } from '../state/setup-flow.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { IEventRepository } from '../../core/ports/event-repository.js';

const TEST_USER_ID = 123;

function makeCtx(text?: string): Context {
  // Test mock: the only fields the command under test reads are `from`
  // and `message.text`; we attach a `message` only when a command text
  // is supplied. Cast to Context at the boundary.
  const mock: { from: { id: number; is_bot: boolean; first_name: string }; reply: ReturnType<typeof vi.fn>; message?: { text: string } } = {
    from: { id: TEST_USER_ID, is_bot: false, first_name: 'Test' },
    reply: vi.fn(),
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
    expect(text).toContain('-83.8');
    // Inline path does NOT open a keyboard.
    expect(getReplyMarkup(ctx)).toBeUndefined();
  });

  it('accepts coords with no whitespace after the comma', async () => {
    const ctx = makeCtx('/events set 42.5,-83.8');
    const cmd = makeCmd();

    await cmd(ctx);

    expect(userSettings.setLocation).toHaveBeenCalledWith(TEST_USER_ID, {
      latitude: 42.5,
      longitude: -83.8,
      radiusKm: 80,
    });
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
