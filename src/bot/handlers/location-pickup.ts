// createLocationPickupHandler: handles a `message.location` from a
// user who is mid-setup. The flow is owned by SetupFlow; this
// handler just consumes the pending state and writes to the
// persistent store. The only flow supported today is
// `events-set-location`; the switch leaves room for future flows
// without an interface change.

import { Context, Markup } from 'telegraf';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { setupFlow } from '../state/setup-flow.js';

interface LocationPickupDeps {
  userSettingsRepository: IUserSettingsRepository;
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

    const flow = setupFlow.consume(userId);
    if (!flow) {
      // Not in a setup flow. Ignore stray location pins so we do
      // not overwrite a saved location accidentally. The user can
      // always re-run /events set.
      return;
    }

    switch (flow) {
      case 'events-set-location': {
        const { latitude, longitude } = message.location;
        await deps.userSettingsRepository.setLocation(userId, { latitude, longitude });
        await ctx.reply(
          `Location saved (\uD83D\uDCCD ${latitude.toFixed(4)}, ${longitude.toFixed(4)}). Use /events to see upcoming events.`,
          Markup.removeKeyboard(),
        );
        return;
      }
    }
  };
}
