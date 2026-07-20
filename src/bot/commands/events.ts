import { Context, Markup } from 'telegraf';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { formatEventList } from '../formatters/event-list-formatter.js';
import { formatEventDetail } from '../formatters/event-detail-formatter.js';
import { setupFlow } from '../state/setup-flow.js';
import { stripCommand } from '../utils/strip-command.js';
import { kmToMiles } from '../../utils/units.js';

const SHOW_ALL_CHUNK_SIZE = 8;

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

export interface EventsCommandDeps {
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
  // Optional: override Date.now() for testability.
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Location resolution
// ---------------------------------------------------------------------------

async function resolveLocation(
  userId: number | undefined,
  deps: EventsCommandDeps,
): Promise<EventLocation> {
  if (userId == null) return deps.defaultLocation;

  const saved = await deps.userSettingsRepository.getLocation(userId);
  if (!saved) return deps.defaultLocation;

  const numMiles = saved.radiusKm != null
    ? kmToMiles(saved.radiusKm)
    : deps.defaultLocation.numMiles;

  return {
    latitude: saved.latitude,
    longitude: saved.longitude,
    numMiles,
  };
}

// ---------------------------------------------------------------------------
// renderEventList — exported so callbacks can re-use
// ---------------------------------------------------------------------------

export async function renderEventList(
  ctx: Context,
  deps: EventsCommandDeps,
  days: number,
): Promise<void> {
  await ctx.sendChatAction('typing');

  const userId = ctx.from?.id;
  const location = await resolveLocation(userId, deps);

  const now = deps.now ? deps.now() : new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const events = await deps.eventRepository.getEvents(now, end, location);

  const { body, buttons } = formatEventList(events, days);

  if (buttons.length === 0) {
    await ctx.reply(body, { parse_mode: 'HTML' });
    return;
  }

  const keyboard = Markup.inlineKeyboard(
    buttons.map((row) => row.map((b) => Markup.button.callback(b.label, b.callbackData))),
  );

  // When called from a callback (Back action), edit the current message;
  // when called from the /events command, send a new message.
  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(body, { parse_mode: 'HTML', ...keyboard });
  }
}

// ---------------------------------------------------------------------------
// renderEventDetail — exported so callbacks can re-use
// ---------------------------------------------------------------------------

export async function renderEventDetail(
  ctx: Context,
  deps: EventsCommandDeps,
  id: string,
): Promise<void> {
  await ctx.sendChatAction('typing');

  const userId = ctx.from?.id;
  const location = await resolveLocation(userId, deps);

  // Fetch event + registrations in parallel; registrations can fail
  const [event, registrations] = await Promise.all([
    deps.eventRepository.getEventById(id, location),
    deps.eventRepository.getEventRegistrations(id, location).catch((err) => {
      console.error(`[Events] Failed to fetch registrations for event ${id}:`, err);
      return 'unavailable' as const;
    }),
  ]);

  if (!event) {
    await ctx.reply('Event not found.');
    return;
  }

  const body = formatEventDetail(event, registrations);
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('\u2190 Back to list', 'event:list')],
  ]);

  // Always edit in place (called from a callback)
  await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
}

// ---------------------------------------------------------------------------
// Subcommand parser
// ---------------------------------------------------------------------------

type EventsAction = 'show' | 'set' | 'clear' | 'usage';

function parseAction(rawArgs: string): EventsAction {
  const arg = rawArgs.trim().toLowerCase();
  if (arg === '') return 'show';
  if (arg === 'set') return 'set';
  if (arg === 'clear') return 'clear';
  return 'usage';
}

// ---------------------------------------------------------------------------
// createEventsCommand
// ---------------------------------------------------------------------------

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
          '/events \u2014 upcoming events at your location (default 7 days)\n' +
          '/events &lt;N&gt; \u2014 upcoming events in the next N days\n' +
          '/events set \u2014 share your location (or use the Share button)\n' +
          '/events clear \u2014 forget your saved location',
      );
      return;
    }

    if (action === 'set') {
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

    // action === 'show' — parse optional days argument
    let days = deps.daysAhead;
    if (rawArgs.trim().length > 0) {
      const parsed = parseInt(rawArgs.trim(), 10);
      if (isNaN(parsed) || parsed <= 0) {
        await ctx.reply(
          'Usage: /events [days]\n\n' +
            'Example: /events 14  (show events in the next 14 days)',
        );
        return;
      }
      days = parsed;
    }

    await renderEventList(ctx, deps, days);
  };
}

// ---------------------------------------------------------------------------
// sendShowAllMessages — renders the full event list as multiple text
// messages, each with up to SHOW_ALL_CHUNK_SIZE inline buttons, no body
// text (a single space is used as Telegram requires non-empty text).
// Exported so the callback handler can use it.
// ---------------------------------------------------------------------------

export async function sendShowAllMessages(
  ctx: Context,
  deps: EventsCommandDeps,
): Promise<void> {
  await ctx.sendChatAction('typing');

  const userId = ctx.from?.id;
  const location = await resolveLocation(userId, deps);

  const now = deps.now ? deps.now() : new Date();
  const end = new Date(now.getTime() + deps.daysAhead * 24 * 60 * 60 * 1000);
  const events = await deps.eventRepository.getEvents(now, end, location);

  // Sort by startDate ascending
  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  for (let i = 0; i < sorted.length; i += SHOW_ALL_CHUNK_SIZE) {
    const chunk = sorted.slice(i, i + SHOW_ALL_CHUNK_SIZE);
    const buttons = chunk.map((ev) => [
      Markup.button.callback(`\uD83D\uDCC5 ${ev.name}`, `event:${ev.id}`),
    ]);
    await ctx.reply('\u200B', Markup.inlineKeyboard(buttons));
  }
}
