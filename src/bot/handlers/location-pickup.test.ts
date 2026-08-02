import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import {
  createLocationPickupHandler,
  createNexusUsernamePickupHandler,
} from './location-pickup.js';
import { setupFlow } from '../state/setup-flow.js';

const USER_ID = 987;

function context(message: Record<string, unknown>): Context {
  return {
    from: { id: USER_ID, is_bot: false, first_name: 'Test' },
    message,
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function settings() {
  return {
    getLocation: vi.fn(),
    setLocation: vi.fn().mockResolvedValue(undefined),
    clearLocation: vi.fn(),
    getNexusUsername: vi.fn(),
    setNexusUsername: vi.fn().mockResolvedValue(undefined),
    clearNexusUsername: vi.fn(),
  };
}

describe('setup-flow pickup handlers', () => {
  beforeEach(() => {
    setupFlow.cancel(USER_ID);
  });

  it('keeps the Nexus setup flow alive after invalid input', async () => {
    const repo = settings();
    const handler = createNexusUsernamePickupHandler({ userSettingsRepository: repo });
    setupFlow.start(USER_ID, 'mytable-set-username');

    const ctx = context({ text: 'invalid<>username' });
    await handler(ctx);

    expect(repo.setNexusUsername).not.toHaveBeenCalled();
    expect(setupFlow.consume(USER_ID)).toBe('mytable-set-username');
  });

  it('does not consume setup for another command and supports /cancel', async () => {
    const repo = settings();
    const handler = createNexusUsernamePickupHandler({ userSettingsRepository: repo });
    setupFlow.start(USER_ID, 'mytable-set-username');

    await handler(context({ text: '/help' }));
    expect(setupFlow.consume(USER_ID)).toBe('mytable-set-username');

    setupFlow.start(USER_ID, 'mytable-set-username');
    const cancelContext = context({ text: '/cancel' });
    await handler(cancelContext);
    expect(setupFlow.consume(USER_ID)).toBeNull();
    expect(cancelContext.reply).toHaveBeenCalled();
  });

  it('saves a valid location with the configured radius', async () => {
    const repo = settings();
    const handler = createLocationPickupHandler({
      userSettingsRepository: repo,
      defaultRadiusKm: 25,
    });
    setupFlow.start(USER_ID, 'events-set-location');

    await handler(context({ location: { latitude: 40, longitude: -3 } }));

    expect(repo.setLocation).toHaveBeenCalledWith(USER_ID, {
      latitude: 40,
      longitude: -3,
      radiusKm: 25,
    });
    expect(setupFlow.consume(USER_ID)).toBeNull();
  });
});
