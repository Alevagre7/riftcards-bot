import { Context, Markup } from 'telegraf';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { formatEventList } from '../formatters/event-formatter.js';
import { setupFlow } from '../state/setup-flow.js';

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

// Subcommand parser. Returns one of three actions:
//   - 'show'   — `/events` with no args
//   - 'set'    — `/events set`
//   - 'clear'  — `/events clear`
//   - 'usage'  — anything else (printed as a hint)
type EventsAction = 'show' | 'set' | 'clear' | 'usage';

function parseAction(rawArgs: string): EventsAction {
  const arg = rawArgs.trim().toLowerCase();
  if (arg === '' || arg === 'show' || arg === 'list') return 'show';
  if (arg === 'set' || arg === 'setup' || arg === 'configure') return 'set';
  if (arg === 'clear' || arg === 'reset' || arg === 'forget') return 'clear';
  return 'usage';
}

function stripCommand(text: string, command: string): string {
  return text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`, 'i'), '').trim();
}

const KM_PER_MILE = 0.621371;

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
    let usingDefault = true;

    if (userId != null) {
      const saved = await deps.userSettingsRepository.getLocation(userId);
      if (saved) {
        // Per-user radius override (in km) wins over the global
        // default radius (in miles). If the user has not set a
        // radius, we keep the global default.
        const numMiles = saved.radiusKm != null
          ? saved.radiusKm * KM_PER_MILE
          : deps.defaultLocation.numMiles;
        location = {
          latitude: saved.latitude,
          longitude: saved.longitude,
          numMiles,
        };
        usingDefault = false;
      }
    }

    const now = new Date();
    const end = new Date(now.getTime() + deps.daysAhead * 24 * 60 * 60 * 1000);
    const events = await deps.eventRepository.getEvents(now, end, location);
    const body = formatEventList(events);

    const reply = usingDefault && events.length > 0
      ? `${body}\n\n\uD83D\uDCCD Showing the configured default location. Use /events set to use your own.`
      : body;

    await ctx.reply(reply, { parse_mode: 'HTML' });
  };
}
