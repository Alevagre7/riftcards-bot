// Pickup handlers for bot setup flows.
//
// createLocationPickupHandler: handles a `message.location` from a
// user who is mid-setup. The flow is owned by SetupFlow; this
// handler just consumes the pending state and writes to the
// persistent store. The only flow supported today is
// `events-set-location`; the switch leaves room for future flows
// without an interface change.
//
// createNexusUsernamePickupHandler: sibling for `mytable-set-username`
// flow — reads the next non-command text message as a Nexus username.

import { Context, Markup } from 'telegraf';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { setupFlow } from '../state/setup-flow.js';
import { NEXUS_USERNAME_RE } from '../utils/nexus-username.js';

interface LocationPickupDeps {
  userSettingsRepository: IUserSettingsRepository;
  defaultRadiusKm: number;
}

export function createLocationPickupHandler(deps: LocationPickupDeps) {
  return async (ctx: Context) => {
    // Only respond to messages that actually carry a location.
    // Telegraf's typings expose `ctx.message.location` when present.
    const message = ctx.message as { location?: { latitude: number; longitude: number } } | undefined;
    if (!message || !message.location) return;

    const userId = ctx.from?.id;
    if (userId == null) {
      // Anonymous or channel post — nothing to persist against.
      return;
    }

    const flow = setupFlow.peek(userId);
    if (!flow) {
      // Not in a setup flow. Ignore stray location pins so we do
      // not overwrite a saved location accidentally. The user can
      // always re-run /events set.
      return;
    }

    switch (flow) {
      case 'events-set-location': {
        const { latitude, longitude } = message.location;
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          setupFlow.start(userId, flow);
          await ctx.reply('That location pin is invalid. Please send another one.');
          return;
        }
        setupFlow.consume(userId);
        await deps.userSettingsRepository.setLocation(userId, {
          latitude,
          longitude,
          radiusKm: deps.defaultRadiusKm,
        });
        await ctx.reply(
          'Location saved! Use /events to find upcoming events near you.',
          Markup.removeKeyboard(),
        );
        return;
      }
    }
  };
}

interface NexusUsernamePickupDeps {
  userSettingsRepository: IUserSettingsRepository;
}

export function createNexusUsernamePickupHandler(deps: NexusUsernamePickupDeps) {
  return async (ctx: Context) => {
    const message = ctx.message as { text?: string } | undefined;
    if (!message || !message.text) return;

    const userId = ctx.from?.id;
    if (userId == null) return;

    const flow = setupFlow.peek(userId);
    if (flow !== 'mytable-set-username') return;

    const username = message.text.trim();
    if (/^\/cancel(?:@\w+)?$/i.test(username)) {
      setupFlow.cancel(userId);
      await ctx.reply('Setup cancelled.', Markup.removeKeyboard());
      return;
    }
    // Do not let another command consume the pending setup flow. The user
    // can retry the command after handling it, or use /cancel explicitly.
    if (username.startsWith('/')) return;

    if (!NEXUS_USERNAME_RE.test(username)) {
      setupFlow.start(userId, flow);
      await ctx.reply(
        'Invalid Nexus username. Use letters, numbers, _, -, . (1-64 characters).',
      );
      return;
    }

    setupFlow.consume(userId);
    await deps.userSettingsRepository.setNexusUsername(userId, username);
    await ctx.reply(
      `Nexus username saved as "${username}". Use /mytable to see your pairing.`,
      Markup.removeKeyboard(),
    );
  };
}
