import { Context, Markup } from 'telegraf';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { formatEventList } from '../formatters/event-formatter.js';
import { setupFlow } from '../state/setup-flow.js';
import { stripCommand } from '../utils/strip-command.js';
import { kmToMiles } from '../../utils/units.js';

interface EventsCommandDeps {
  eventRepository: IEventRepository;
  userSettingsRepository: IUserSettingsRepository;
  // The global location fallback. When the user has not configured
  // their own location, the /events command uses this so the bot
  // still has a useful default behaviour. The radius here is in
  // miles (the upstream API's unit).
  defaultLocation: EventLocation;
  // Days ahead for the events window. 7 by default, matches the
  // existing CLI; env-overridable via EVENTS_DAYS_AHEAD.
  daysAhead: number;
}

// Subcommand parser. Only the two subcommands the spec called for
// (`/events set`, `/events clear`) are recognised. Empty args fall
// through to the show action. Anything else prints a usage hint.
type EventsAction = 'show' | 'set' | 'clear' | 'usage';

function parseAction(rawArgs: string): EventsAction {
  const arg = rawArgs.trim().toLowerCase();
  if (arg === '') return 'show';
  if (arg === 'set') return 'set';
  if (arg === 'clear') return 'clear';
  return 'usage';
}

export function createEventsCommand(deps: EventsCommandDeps) {
  return async (ctx: Context) => {
    const text =
      ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string'
        ? ctx.message.text
        : '';
    const rawArgs = stripCommand(text, 'events');
    const action = parseAction(rawArgs);

    if (action === 'usage') {
      await ctx.reply(
        'Usage:\n' +
          '/events \u2014 upcoming events at your location\n' +
          '/events set \u2014 share your location (or use the Share button)\n' +
          '/events clear \u2014 forget your saved location',
      );
      return;
    }

    if (action === 'set') {
      // The ReplyKeyboard with a request_location button is the only
      // way Telegram exposes a native "ask for location" affordance
      // (inline keyboards do not support request_location). The
      // keyboard is one-shot so the user is not stuck with it
      // afterwards.
      const keyboard = Markup.keyboard([
        [Markup.button.locationRequest('Share location')],
      ])
        .oneTime()
        .resize();
      await ctx.reply('Send a location pin or tap the button below.', keyboard);
      const userId = ctx.from?.id;
      if (userId != null) {
        setupFlow.start(userId, 'events-set-location');
      }
      return;
    }

    if (action === 'clear') {
      const userId = ctx.from?.id;
      if (userId != null) {
        await deps.userSettingsRepository.clearLocation(userId);
        setupFlow.cancel(userId);
        await ctx.reply('Your saved location has been forgotten.', Markup.removeKeyboard());
      } else {
        await ctx.reply('Could not identify your account. Please try again.');
      }
      return;
    }

    // action === 'show'
    await ctx.sendChatAction('typing');

    const userId = ctx.from?.id;
    let location: EventLocation = deps.defaultLocation;

    if (userId != null) {
      const saved = await deps.userSettingsRepository.getLocation(userId);
      if (saved) {
        // Per-user radius override (in km) wins over the global
        // default radius (in miles). If the user has not set a
        // radius, we keep the global default.
        const numMiles = saved.radiusKm != null
          ? kmToMiles(saved.radiusKm)
          : deps.defaultLocation.numMiles;
        location = {
          latitude: saved.latitude,
          longitude: saved.longitude,
          numMiles,
        };
      }
    }

    const now = new Date();
    const end = new Date(now.getTime() + deps.daysAhead * 24 * 60 * 60 * 1000);
    const events = await deps.eventRepository.getEvents(now, end, location);

    await ctx.reply(formatEventList(events), { parse_mode: 'HTML' });
  };
}
