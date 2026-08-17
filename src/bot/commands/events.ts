import { Context, Markup } from 'telegraf';
import { EventListing } from '../../core/entities/event-listing.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';
import { formatEventList } from '../formatters/event-list-formatter.js';
import { formatEventDetail, EventWatchDetailState } from '../formatters/event-detail-formatter.js';
import { setupFlow } from '../state/setup-flow.js';
import type { IEventNavigationContext } from '../state/event-navigation-context.js';
import { eventDetailOrigin } from '../state/event-detail-origin.js';
import { stripCommand } from '../utils/strip-command.js';
import { kmToMiles, milesToKm } from '../../utils/units.js';

// Module-level constants for the window-picker menu. The button count
// is fixed at 4 so the keyboard is a single row; if the array grows
// past 4, Markup.inlineKeyboard will wrap to additional rows
// automatically.
const EVENT_WINDOW_OPTIONS: readonly { label: string; days: number }[] = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '5 days', days: 5 },
  { label: '1 week', days: 7 },
];

// IN_PROGRESS_LOOKBACK_HOURS widens the /events fetch window backwards
// from `now` so events that have already started but not yet ended are
// returned by the upstream. The upstream filters on startDate, not
// endDate, so a [now, now+days] window silently drops in-progress
// events — exactly when the Watch flow is most useful. 12h covers
// typical 4-8h tournaments, including ones that started yesterday
// morning and are still running.
const IN_PROGRESS_LOOKBACK_HOURS = 12;

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------
export interface EventsCommandDeps {
  eventRepository: IEventRepository;
  eventListingRepository: IEventListingRepository;
  userSettingsRepository: IUserSettingsRepository;
  eventNavigationContext: IEventNavigationContext;
  // The global location fallback. When the user has not configured
  // their own location, the /events command uses this so the bot
  // still has a useful default behaviour. The radius here is in
  // miles (the upstream API's unit).
  defaultLocation: EventLocation;
  // The radius saved with a new user location. Keeping this in km matches
  // the persistence contract and avoids baking the historical 80 km
  // default into command logic.
  defaultRadiusKm?: number;
  // Days ahead for the events window. 7 by default, matches the
  // existing CLI; env-overridable via EVENTS_DAYS_AHEAD.
  daysAhead: number;
  watchManager?: IEventWatchManager;
  // Optional: override Date.now() for testability.
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Location resolution
// ---------------------------------------------------------------------------

export async function resolveEventLocation(
  userId: number | undefined,
  deps: Pick<EventsCommandDeps, 'defaultLocation' | 'userSettingsRepository'>,
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
  const location = await resolveEventLocation(userId, deps);

  const now = deps.now ? deps.now() : new Date();
  // Widen the window backwards by IN_PROGRESS_LOOKBACK_HOURS so events
  // that have already started but not yet ended are returned by the
  // upstream.
  const startAfter = new Date(now.getTime() - IN_PROGRESS_LOOKBACK_HOURS * 60 * 60 * 1000);
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const rawEvents = await deps.eventListingRepository.getEvents(startAfter, end, location);

  // Post-filter: drop events whose end datetime is already in the past.
  // The upstream may return events that started within the lookback
  // but have since ended (e.g. a 1h event that started 11h ago).
  const events = rawEvents.filter(
    (ev) => new Date(ev.endDatetime).getTime() >= now.getTime(),
  );

  // Sort by start ascending — in-progress events (started in the
  // past) bubble to the top automatically.
  const sorted = [...events].sort(
    (a, b) => new Date(a.startDatetime).getTime() - new Date(b.startDatetime).getTime(),
  );

  // Remember the successful filtered and sorted list for page and Back-to-list navigation.
  deps.eventNavigationContext.rememberEventList(userId, sorted, days);

  await renderEventListWithPage(ctx, deps, sorted, days, 0);
}

// ---------------------------------------------------------------------------
// renderEventWindowMenu — exported so callbacks can re-use
// ---------------------------------------------------------------------------

// Sends the window-picker menu: 4 inline buttons, one per
// pre-configured time window. Tapping a button dispatches
// `event:range:<days>`, which the action handler turns into a
// `renderEventList(ctx, deps, days)` call.

export async function renderEventWindowMenu(ctx: Context): Promise<void> {
  const keyboard = Markup.inlineKeyboard(
    EVENT_WINDOW_OPTIONS.map((opt) => [
      Markup.button.callback(opt.label, `event:range:${opt.days}`),
    ]),
  );
  await ctx.reply('Pick a time window:', keyboard);
}

// ---------------------------------------------------------------------------
// renderEventDetail — exported so callbacks can re-use
// ---------------------------------------------------------------------------

export async function renderEventDetail(
  ctx: Context,
  deps: EventsCommandDeps,
  id: number,
  options?: { showBackToList?: boolean },
): Promise<void> {
  await ctx.sendChatAction('typing');

  const userId = ctx.from?.id;
  const location = await resolveEventLocation(userId, deps);

  // Fetch event + registrations in parallel
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

  // Determine if the event has started via the detail bundle
  // (detail endpoint failure must not break the detail page)
  let isStarted: boolean | undefined;
  try {
    const detail = await deps.eventRepository.getEventDetail(event.id, location);
    isStarted = detail?.currentRound != null ? true : false;
  } catch {
    // Detail failure → isStarted stays undefined (show everything)
  }

  let watchState: EventWatchDetailState | undefined;
  if (ctx.chat?.type === 'private' && userId != null && deps.watchManager) {
    const active = await deps.watchManager.getStatus(userId);
    if (!active) watchState = { kind: 'none' };
    else if (active.watch.eventId === event.id) {
      watchState = { kind: 'current', username: active.watch.eventUsername };
    } else {
      watchState = { kind: 'other' };
    }
  }

  // Default: show "Back to list" only when the user has a live list
  // context and this event was not opened directly. Direct-origin
  // suppression remains on the legacy marker until its later migration.
  const showBackToList = options?.showBackToList
    ?? (userId != null
      && deps.eventNavigationContext.getEventList(userId) != null
      && !eventDetailOrigin.isDirect(userId, id));
  const result = formatEventDetail(event, registrations, {
    privateChat: ctx.chat?.type === 'private',
    ...(isStarted !== undefined ? { isStarted } : {}),
    ...(showBackToList === false ? { showBackToList: false } : {}),
    ...(watchState ? { watchState } : {}),
  });

  const sendOptions = {
    parse_mode: 'HTML' as const,
    reply_markup: { inline_keyboard: result.buttons },
  };
  // When invoked from a callback query, edit in place. When invoked
  // from a plain command (e.g. /events 498515), reply with a new
  // message — editMessageText requires a callback message to edit.
  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    await ctx.editMessageText(result.body, sendOptions);
  } else {
    await ctx.reply(result.body, sendOptions);
  }
}

// ---------------------------------------------------------------------------
// renderEventListWithPage — internal helper that builds and sends/edits a
// specific page of events. Used by renderEventList and renderEventsPage.
// ---------------------------------------------------------------------------

async function renderEventListWithPage(
  ctx: Context,
  deps: EventsCommandDeps,
  sorted: readonly EventListing[],
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
// renderEventsPage — Called from the Prev/Next callback. Reads the shared
// navigation context and renders the requested page. Falls back to refetch
// if the context expired.

export async function renderEventsPage(
  ctx: Context,
  deps: EventsCommandDeps,
  page: number,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) return;

  const state = deps.eventNavigationContext.getEventList(userId);
  if (!state) {
    // Context expired or was never set — refetch and re-render from page 0.
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

type EventsAction = 'show' | 'set' | 'clear' | 'usage' | 'event-id';

// EVENT_ID_THRESHOLD disambiguates `/events <N>` between a days
// window (small N) and a direct event lookup (large N). V2 event
// ids are 6-digit; a days window past 1000 days is nonsensical.
const EVENT_ID_THRESHOLD = 1000;

function parseAction(rawArgs: string): EventsAction {
  const arg = rawArgs.trim().toLowerCase();
  if (arg === '') return 'show';
  if (arg === 'set' || arg.startsWith('set ')) return 'set';
  if (arg === 'clear') return 'clear';
  // Locator URL → direct event lookup (debug path).
  if (/^https?:\/\/locator\.riftbound\.uvsgames\.com\/events\/\d+/.test(arg)) {
    return 'event-id';
  }
  // Numeric arg: large (>= EVENT_ID_THRESHOLD) = event id, small = days.
  if (/^\d+$/.test(arg)) {
    return Number(arg) >= EVENT_ID_THRESHOLD ? 'event-id' : 'show';
  }
  return 'usage';
}
// parseCoords: accept "<lat>, <lon>" with optional whitespace and
// negatives. Local helper, not exported — only the inline-coords
// branch of `createEventsCommand` calls it. Returns null on any
// deviation (semicolons, single number, non-numeric, etc.).
function parseCoords(input: string): { latitude: number; longitude: number } | null {
  const match = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  return { latitude: parseFloat(match[1]!), longitude: parseFloat(match[2]!) };
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
          '/events &lt;id&gt; \u2014 show a specific event by id (debug)\n' +
          '/events &lt;locator-url&gt; \u2014 show the event at that locator link\n' +
          '/events set \u2014 share your location (or use the Share button)\n' +
          '/events clear \u2014 forget your saved location',
      );
      return;
    }

    if (action === 'event-id') {
      const trimmed = rawArgs.trim();
      const id = /^\d+$/.test(trimmed)
        ? Number(trimmed)
        : Number(trimmed.match(/\/events\/(\d+)/i)?.[1] ?? '0') || null;
      if (id == null) {
        await ctx.reply('Could not read the event id. Use a bare number or a locator URL.');
        return;
      }
      // Clear the shared list context while retaining the legacy direct-origin
      // marker and explicit detail override until the direct-origin migration.
      const userId = ctx.from?.id;
      if (userId != null) {
        deps.eventNavigationContext.openEventDirectly(userId, id);
        eventDetailOrigin.markDirect(userId, id);
      }
      await renderEventDetail(ctx, deps, id, { showBackToList: false });
      return;
    }

    if (action === 'set') {
      const rest = rawArgs.trim().slice(3).trim(); // strip the leading "set"
      if (rest === '') {
        // Existing pin flow.
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

      // Inline coordinates.
      const coords = parseCoords(rest);
      if (!coords) {
        await ctx.reply(
          'Invalid coordinates. Use "lat, lon" — for example:\n' +
            '/events set 42.58836934328923, -83.87718629792093',
        );
        return;
      }
      const { latitude, longitude } = coords;
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        await ctx.reply(
          'Coordinates out of range. Latitude must be in [-90, 90], longitude in [-180, 180].',
        );
        return;
      }
      const userId = ctx.from?.id;
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      // Cancel any in-flight pin flow so a stray pin the user sends later
      // doesn't overwrite the freshly-saved inline coords.
      setupFlow.cancel(userId);
      await deps.userSettingsRepository.setLocation(userId, {
        latitude,
        longitude,
        radiusKm: deps.defaultRadiusKm ?? milesToKm(deps.defaultLocation.numMiles),
      });
      await ctx.reply(
        `Location saved (${latitude}, ${longitude}). Use /events to find upcoming events near you.`,
      );
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

    // action === 'show' — empty args opens the window-picker menu;
    // a positive integer N is the power-user path that fetches
    // directly for N days.
    const trimmed = rawArgs.trim();
    if (trimmed.length === 0) {
      await renderEventWindowMenu(ctx);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed <= 0) {
      await ctx.reply(
        'Pick a time window with the /events menu, or type /events <N> for any positive N.\n' +
          'Example: /events 14  (show events in the next 14 days)',
      );
      return;
    }

    await renderEventList(ctx, deps, parsed);
  };
}
