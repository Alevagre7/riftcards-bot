import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { escapeHtml } from './card-formatter.js';

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

export function formatEventDetail(
  event: Event,
  registrations: readonly EventRegistration[] | 'unavailable',
  options?: { privateChat?: boolean; isStarted?: boolean; showBackToList?: boolean },
): EventDetailResult {
  const tz = event.timezone || 'Europe/Madrid';
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
  const dateStr = dateFmt.format(start);
  const startTime = timeFmt.format(start);
  const endTime = timeFmt.format(end);
  lines.push(
    `\uD83D\uDD50 <b>${dateStr} \u00B7 ${startTime}\u2013${endTime}</b> (${event.timezone})`,
  );

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
    const currency = event.currency || 'EUR';
    const amountFmt = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    });
    lines.push(`\uD83D\uDCB0 <b>${amountFmt.format(event.costInCents / 100)}</b>`);
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

  // Watch button only in private chats
  if (options?.privateChat === true) {
    buttons.push([{ text: '\uD83D\uDC41 Watch', callback_data: `event:${event.id}:watch:start` }]);
  }

  // "Back to list" makes no sense when the user opened the detail
  // from /events <id> or a locator URL — there is no list to go back
  // to. The event-id command path passes showBackToList: false.
  if (options?.showBackToList !== false) {
    buttons.push([{ text: '\u2190 Back to list', callback_data: 'event:list' }]);
  }

  return {
    body: lines.join('\n'),
    buttons,
  };
}
