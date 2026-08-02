import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { escapeHtml } from './card-formatter.js';
import { joinTelegramLines } from '../utils/telegram-text.js';

// ---------------------------------------------------------------------------
// formatEventDetail
// ---------------------------------------------------------------------------

// Renders a single event's full detail as an HTML string with inline
// keyboard buttons for Leaderboard, All tables, and Watch (the latter
// only in private chats).
//
// registrations: pass the upstream registration list, or the literal
// string 'unavailable' when the endpoint failed.
//
// All date rendering uses the event's own IANA timezone.

export interface EventDetailResult {
  body: string;
  buttons: InlineKeyboardButton[][];
}

export type EventWatchDetailState =
  | { readonly kind: 'none' }
  | { readonly kind: 'current'; readonly username: string }
  | { readonly kind: 'other' };

// Status chip shown next to the event name. Colorful at a glance for
// anyone scanning the chat: green = upcoming, yellow = in progress,
// red = complete. Empty string (no chip) for anything unexpected.
function statusChip(displayStatus: Event['displayStatus']): string {
  switch (displayStatus) {
    case 'upcoming':
      return '\uD83D\uDFE2'; // 🟢
    case 'inProgress':
      return '\uD83D\uDFE1'; // 🟡
    case 'complete':
      return '\uD83D\uDD34'; // 🔴
    default:
      return '';
  }
}

function safeTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
    return value;
  } catch {
    return 'UTC';
  }
}

function formatCost(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency || 'EUR',
      currencyDisplay: 'symbol',
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || 'EUR'}`;
  }
}

export function formatEventDetail(
  event: Event,
  registrations: readonly EventRegistration[] | 'unavailable',
  options?: {
    privateChat?: boolean;
    isStarted?: boolean;
    showBackToList?: boolean;
    watchState?: EventWatchDetailState;
  },
): EventDetailResult {
  const tz = safeTimeZone(event.timezone || 'Europe/Madrid');
  const dateFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });

  const lines: string[] = [];

  // Header: name + colored status chip
  const chip = statusChip(event.displayStatus);
  lines.push(`\uD83D\uDCC5 <b>${escapeHtml(event.name)}</b>${chip ? ` ${chip}` : ''}`);

  // Date/time (event's own timezone)
  const start = new Date(event.startDatetime);
  const end = new Date(event.endDatetime);
  if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
    const dateStr = dateFmt.format(start);
    const startTime = timeFmt.format(start);
    const endTime = timeFmt.format(end);
    lines.push(
      `\uD83D\uDD50 <b>${dateStr} \u00B7 ${startTime}\u2013${endTime}</b> (${escapeHtml(tz)})`,
    );
  } else {
    lines.push(`\uD83D\uDD50 Time unavailable (${escapeHtml(tz)})`);
  }

  // Store
  lines.push(`\uD83C\uDFEA <b>${escapeHtml(event.store.name)}</b>`);

  // Address
  if (event.store.fullAddress) {
    lines.push(`\uD83D\uDCCD ${escapeHtml(event.store.fullAddress)}`);
  }

  // Format / event type
  if (event.gameplayFormatName || event.eventType) {
    const fc = event.gameplayFormatName
      ? `\uD83C\uDFAE <b>${escapeHtml(event.gameplayFormatName)}</b>${event.eventType ? ` \u00B7 ${escapeHtml(event.eventType)}` : ''}`
      : `\uD83C\uDFAE ${escapeHtml(event.eventType)}`;
    lines.push(fc);
  }

  // Capacity
  lines.push(
    `\uD83D\uDC65 <b>${event.registeredCount}/${event.capacity}</b> players`,
  );

  // Description
  if (event.description) {
    lines.push(`\uD83D\uDCDD <i>${escapeHtml(event.description)}</i>`);
  }

  // Cost
  if (event.costInCents === 0) {
    lines.push('\uD83D\uDCB0 <b>Free</b>');
  } else if (event.costInCents != null) {
    lines.push(
      `\uD83D\uDCB0 <b>${escapeHtml(formatCost(event.costInCents, event.currency))}</b>`,
    );
  }

  // Players
  if (registrations === 'unavailable') {
    lines.push('\uD83D\uDC64 Players: unavailable');
  } else if (registrations.length > 0) {
    lines.push(`\uD83D\uDC64 Players (${registrations.length}):`);
    for (const r of registrations) {
      lines.push(
        `  \u2022 <b>${escapeHtml(r.name)}</b> \u2014 ${escapeHtml(r.status)}`,
      );
    }
  }

  // Locator page (synthesized — the V2 API has no locator URL field)
  const locatorUrl = `https://locator.riftbound.uvsgames.com/events/${event.id}`;
  lines.push(`\uD83D\uDD17 <a href="${locatorUrl}">${locatorUrl}</a>`);

  // Build buttons using the numeric event id for callback data
  const buttons: InlineKeyboardButton[][] = [];

  // Show Leaderboard + All tables only when the event has started
  // (isStarted=true or undefined — fallback when the detail endpoint
  // is unreachable)
  if (options?.isStarted !== false) {
    buttons.push(
      [{ text: '\uD83C\uDFC6 Leaderboard', callback_data: `event:${event.id}:leaderboard` }],
      [{ text: '\uD83D\uDCCB All tables', callback_data: `event:${event.id}:rounds` }],
    );
  }

  // Watch is only useful while the event is upcoming or in progress.
  if (
    options?.privateChat === true &&
    (event.displayStatus === 'upcoming' || event.displayStatus === 'inProgress')
  ) {
    switch (options.watchState?.kind) {
      case 'current':
        buttons.push([
          { text: `\uD83D\uDC41 Watching ${options.watchState.username}`, callback_data: 'watch:show' },
        ]);
        break;
      case 'other':
        buttons.push([{ text: '\uD83D\uDC41 Change watch', callback_data: `event:${event.id}:watch:start` }]);
        break;
      default:
        buttons.push([{ text: '\uD83D\uDC41 Watch', callback_data: `event:${event.id}:watch:start` }]);
        break;
    }
  }

  // "Back to list" makes no sense when the user opened the detail
  // from /events <id> or a locator URL — there is no list to go back
  // to. The event-id command path passes showBackToList: false.
  if (options?.showBackToList !== false) {
    buttons.push([{ text: '\u2190 Back to list', callback_data: 'event:list' }]);
  }

  return {
    body: joinTelegramLines(lines),
    buttons,
  };
}
