import { Context, Markup } from 'telegraf';
import { Event } from '../../core/entities/event.js';
import { EventId } from '../../core/entities/event-id.js';
import { NexusTable } from '../../core/entities/nexus-table.js';
import { MytableLookupError } from '../../core/errors/index.js';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { INexusTableRepository, NexusTableStoreLookup } from '../../core/ports/nexus-table-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { formatNexusTable } from '../formatters/nexus-table-formatter.js';
import { setupFlow } from '../state/setup-flow.js';
import { stripCommand } from '../utils/strip-command.js';
import { NEXUS_USERNAME_RE } from '../utils/nexus-username.js';

export interface MytableCommandDeps {
  nexusTableRepository: INexusTableRepository;
  userSettingsRepository: IUserSettingsRepository;
  eventRepository: IEventRepository;
  /** Passed alongside the Riot event repository used by the table adapter. */
  eventListingRepository: IEventListingRepository;
  defaultLocation: EventLocation;
}

type MytableAction = 'show' | 'set' | 'clear' | 'store' | 'clearStore' | 'event';

interface ParsedArguments {
  readonly action: MytableAction;
  readonly value: string;
  readonly extra: string;
}

const OFFICIAL_EVENT_HOSTS = new Set([
  'playriftbound.com',
  'www.playriftbound.com',
  'events.playriftbound.com',
]);

function parseArguments(rawArgs: string): ParsedArguments {
  const args = rawArgs.trim();
  const firstWhitespace = args.search(/\s/);
  const first = firstWhitespace === -1 ? args : args.slice(0, firstWhitespace);
  const rest = firstWhitespace === -1 ? '' : args.slice(firstWhitespace).trim();
  const command = first.toLowerCase();

  if (args === '') return { action: 'show', value: '', extra: '' };
  if (command === 'show') return { action: 'show', value: rest, extra: '' };
  if (command === 'set') return { action: 'set', value: rest, extra: '' };
  if (command === 'clear') return { action: 'clear', value: '', extra: '' };
  if (command === 'store') return { action: 'store', value: rest, extra: '' };
  if (command === 'clearstore') return { action: 'clearStore', value: '', extra: '' };
  if (command === 'event') {
    const eventWhitespace = rest.search(/\s/);
    return eventWhitespace === -1
      ? { action: 'event', value: rest, extra: '' }
      : {
          action: 'event',
          value: rest.slice(0, eventWhitespace),
          extra: rest.slice(eventWhitespace).trim(),
        };
  }
  // The published one-off syntax is `/mytable <player name or Riot ID>`.
  return { action: 'show', value: args, extra: '' };
}

function parseOfficialEventUrl(rawValue: string): EventId | null {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !OFFICIAL_EVENT_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const candidates = [
    ...url.pathname.split('/').filter(Boolean).reverse(),
    url.searchParams.get('eventId') ?? '',
    url.searchParams.get('tournamentId') ?? '',
    url.searchParams.get('id') ?? '',
  ];
  const rawId = candidates.find((candidate) => /^\d{6,}$/.test(candidate));
  return rawId ? `riot:${rawId}` : null;
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function storeLookupFromEvent(event: Event, requestedTimezone?: string): NexusTableStoreLookup {
  const organizerId = String(event.store.id);
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(organizerId)) {
    throw new MytableLookupError(
      'This official event did not include a Riot organizer ID, so it cannot be saved as a /mytable store.',
    );
  }
  if (!Number.isFinite(event.store.latitude) || !Number.isFinite(event.store.longitude)) {
    throw new MytableLookupError(
      'This official event did not include store coordinates, so it cannot be saved for /mytable.',
    );
  }

  const timezone = requestedTimezone ?? event.store.timezone ?? event.timezone ?? 'UTC';
  if (!isValidTimezone(timezone)) {
    throw new MytableLookupError(
      `"${timezone}" is not a valid IANA timezone. Example: Europe/Madrid.`,
    );
  }
  return {
    organizerId,
    name: event.store.name,
    latitude: event.store.latitude,
    longitude: event.store.longitude,
    timezone,
  };
}

async function getEventFromOfficialUrl(
  deps: MytableCommandDeps,
  rawUrl: string,
): Promise<{ eventId: EventId; event: Event } | null> {
  const eventId = parseOfficialEventUrl(rawUrl);
  if (eventId == null) return null;
  const event = await deps.eventRepository.getEventById(eventId, deps.defaultLocation);
  return event == null ? null : { eventId, event };
}

function validPlayerName(value: string): boolean {
  return NEXUS_USERNAME_RE.test(value.trim());
}

function currentSavedPlayer(settings: IUserSettingsRepository, telegramId: number) {
  return settings.getNexusUsername(telegramId);
}

export async function renderMytable(
  ctx: Context,
  deps: MytableCommandDeps,
  username: string,
  store: NexusTableStoreLookup,
  eventId?: EventId,
): Promise<NexusTable | undefined> {
  try {
    const table = await deps.nexusTableRepository.getTable(
      eventId == null ? { username, store } : { username, store, eventId },
    );
    await ctx.reply(formatNexusTable(table), { parse_mode: 'HTML' });
    return table;
  } catch (error) {
    if (error instanceof MytableLookupError) {
      await ctx.reply(error.message);
      return;
    }
    throw error;
  }
}

export function createMytableCommand(deps: MytableCommandDeps) {
  return async (ctx: Context) => {
    const text =
      ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string'
        ? ctx.message.text
        : '';
    const parsed = parseArguments(stripCommand(text, 'mytable'));
    const userId = ctx.from?.id;

    if (parsed.action === 'set') {
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      if (parsed.value.length > 0) {
        const username = parsed.value.trim();
        if (!validPlayerName(username)) {
          await ctx.reply(
            'Invalid player name or Riot ID. Use a name or name#tag with letters, numbers, spaces, _, -, and . (up to 64 characters).',
          );
          return;
        }
        await deps.userSettingsRepository.setNexusUsername(userId, username);
        await ctx.reply(
          `Player name saved as "${username}". Use /mytable to see the pairing at your selected store.`,
          Markup.removeKeyboard(),
        );
        return;
      }
      setupFlow.start(userId, 'mytable-set-username');
      await ctx.reply(
        'Send me your Riot display name or Riot ID in the form name#tag (or /cancel to abort).',
        Markup.removeKeyboard(),
      );
      return;
    }

    if (parsed.action === 'clear') {
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      await deps.userSettingsRepository.clearNexusUsername(userId);
      setupFlow.cancel(userId);
      await ctx.reply(
        'Your saved player name was cleared. Your selected store stays saved; use /mytable clearstore to forget it.',
        Markup.removeKeyboard(),
      );
      return;
    }

    if (parsed.action === 'store') {
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      const firstSpace = parsed.value.search(/\s/);
      const rawUrl = firstSpace === -1 ? parsed.value : parsed.value.slice(0, firstSpace);
      const requestedTimezone = firstSpace === -1 ? undefined : parsed.value.slice(firstSpace).trim();
      if (!rawUrl) {
        await ctx.reply(
          'Select a store with /mytable store <official PlayRiftbound event URL> [IANA timezone]. Example: /mytable store https://playriftbound.com/en-US/events/123456789 Europe/Madrid',
        );
        return;
      }
      const resolved = await getEventFromOfficialUrl(deps, rawUrl);
      if (resolved == null) {
        await ctx.reply(
          'I could not resolve that official PlayRiftbound event URL. Use the event page link from playriftbound.com.',
        );
        return;
      }
      const store = storeLookupFromEvent(resolved.event, requestedTimezone || undefined);
      await deps.userSettingsRepository.setMytableStore(userId, store);
      setupFlow.cancel(userId);
      const timezoneNote =
        requestedTimezone == null && resolved.event.store.timezone == null
          ? ' No store timezone was available, so UTC is selected. Include an IANA timezone if that is not the store\'s local timezone.'
          : '';
      await ctx.reply(
        `Saved ${store.name} as your /mytable store. Store-day lookups use ${store.timezone}.${timezoneNote}`,
        Markup.removeKeyboard(),
      );
      return;
    }

    if (parsed.action === 'clearStore') {
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      await deps.userSettingsRepository.clearMytableStore(userId);
      setupFlow.cancel(userId);
      await ctx.reply('Your selected /mytable store was forgotten.', Markup.removeKeyboard());
      return;
    }

    if (parsed.action === 'event') {
      const resolved = await getEventFromOfficialUrl(deps, parsed.value);
      if (resolved == null) {
        await ctx.reply(
          'I could not resolve that official PlayRiftbound event URL. Use the event page link from playriftbound.com.',
        );
        return;
      }
      const savedStore = userId == null
        ? null
        : await deps.userSettingsRepository.getMytableStore(userId);
      const eventStore = storeLookupFromEvent(resolved.event);
      if (savedStore != null && savedStore.organizerId !== eventStore.organizerId) {
        await ctx.reply(
          `That event is at ${eventStore.name}, but your selected /mytable store is ${savedStore.name}. Use /mytable store with an event from the correct store, or clear the store first.`,
        );
        return;
      }
      const store: NexusTableStoreLookup = savedStore ?? eventStore;
      const username = parsed.extra || (userId == null ? null : await currentSavedPlayer(deps.userSettingsRepository, userId));
      if (username == null) {
        await ctx.reply('Include a player name or set one first with /mytable set.');
        return;
      }
      if (!validPlayerName(username)) {
        await ctx.reply(
          'Invalid player name or Riot ID. Use a name or name#tag with letters, numbers, spaces, _, -, and . (up to 64 characters).',
        );
        return;
      }
      if (resolved.event.supportsTracking === false) {
        await ctx.reply('This event uses a team format. /mytable currently supports 1v1 events.');
        return;
      }
      await renderMytable(ctx, deps, username.trim(), store, resolved.eventId);
      return;
    }

    // action === 'show'; an inline name is a one-off query and is never saved.
    const username = parsed.value || (userId == null
      ? null
      : await currentSavedPlayer(deps.userSettingsRepository, userId));
    if (username == null) {
      await ctx.reply(
        'You have not set a player name yet. Use /mytable set, or /mytable <name#tag> for a one-off lookup.',
      );
      return;
    }
    if (!validPlayerName(username)) {
      await ctx.reply(
        'Invalid player name or Riot ID. Use a name or name#tag with letters, numbers, spaces, _, -, and . (up to 64 characters).',
      );
      return;
    }
    if (userId == null) {
      await ctx.reply('Could not identify your account. Please try again.');
      return;
    }
    const store = await deps.userSettingsRepository.getMytableStore(userId);
    if (store == null) {
      await ctx.reply(
        'Choose your store before looking up a table: /mytable store <official PlayRiftbound event URL> [IANA timezone].',
      );
      return;
    }
    await renderMytable(ctx, deps, username.trim(), store);
  };
}
