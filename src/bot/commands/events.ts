import { Context, Markup } from 'telegraf';
import { Event } from '../../core/entities/event.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { ILocatorRepository } from '../../core/ports/locator-repository.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { formatEventList } from '../formatters/event-list-formatter.js';
import { formatEventDetail } from '../formatters/event-detail-formatter.js';
import { setupFlow } from '../state/setup-flow.js';
import { eventsPaginationState } from '../state/events-pagination-state.js';
import { stripCommand } from '../utils/strip-command.js';
import { kmToMiles } from '../../utils/units.js';

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
  locatorRepository?: ILocatorRepository;
  watchRepository?: IEventWatchRepository;
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

  // Sort by startDate ascending
  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // Store in pagination state for Prev/Next navigation
  if (userId != null) {
    eventsPaginationState.set(userId, sorted, days);
  }

  await renderEventListWithPage(ctx, deps, sorted, days, 0);
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

  const result = formatEventDetail(event, registrations, {
    privateChat: ctx.chat?.type === 'private',
  });

  // Always edit in place (called from a callback)
  await ctx.editMessageText(result.body, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: result.buttons },
  });
}

// ---------------------------------------------------------------------------
// renderEventListWithPage — internal helper that builds and sends/edits a
// specific page of events. Used by renderEventList and renderEventsPage.
// ---------------------------------------------------------------------------

async function renderEventListWithPage(
  ctx: Context,
  deps: EventsCommandDeps,
  sorted: readonly Event[],
  days: number,
  page: number,
): Promise<void> {
  const { body, buttons } = formatEventList(sorted, days, page, 8);

  if (buttons.length === 0) {
    await ctx.reply(body, { parse_mode: 'HTML' });
    return;
  }

  const keyboard = Markup.inlineKeyboard(
    buttons.map((row) => row.map((b) => Markup.button.callback(b.label, b.callbackData))),
  );

  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(body, { parse_mode: 'HTML', ...keyboard });
  } else {
    await ctx.reply(body, { parse_mode: 'HTML', ...keyboard });
  }
}

// ---------------------------------------------------------------------------
// renderEventsPage — Called from the Prev/Next callback. Reads stored
// pagination state and renders the requested page. Falls back to refetch
// if the state expired.
// ---------------------------------------------------------------------------

export async function renderEventsPage(
  ctx: Context,
  deps: EventsCommandDeps,
  page: number,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) return;

  const state = eventsPaginationState.get(userId);
  if (!state) {
    // State expired or never set — refetch and re-render from page 0.
    await renderEventList(ctx, deps, deps.daysAhead);
    return;
  }

  // Clamp to valid range
  const totalPages = Math.ceil(state.events.length / 8);
  const clampedPage = Math.max(0, Math.min(page, totalPages - 1));

  await renderEventListWithPage(ctx, deps, state.events, state.daysAhead, clampedPage);
}

// ---------------------------------------------------------------------------
// Subcommand parser
// ---------------------------------------------------------------------------

type EventsAction = 'show' | 'set' | 'clear' | 'unwatch' | 'usage';

function parseAction(rawArgs: string): EventsAction {
  const arg = rawArgs.trim().toLowerCase();
  if (arg === '') return 'show';
  if (arg === 'set') return 'set';
  if (arg === 'clear') return 'clear';
  if (arg === 'unwatch') return 'unwatch';
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
          '/events clear \u2014 forget your saved location\n' +
          '/events unwatch \u2014 stop watching the current event',
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

    if (action === 'unwatch') {
      const userId = ctx.from?.id;
      if (userId != null && deps.watchRepository) {
        await deps.watchRepository.delete(userId);
        await ctx.reply('Watcher stopped.');
      } else if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
      } else {
        await ctx.reply('Watch service not available.');
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

