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

export function formatEventDetail(
  event: Event,
  registrations: readonly EventRegistration[] | 'unavailable',
  options?: { privateChat?: boolean; isStarted?: boolean },
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

  // Header
  lines.push(`\uD83D\uDCC5 <b>${escapeHtml(event.name)}</b>`);

  // Date/time (event's own timezone)
  const start = new Date(event.startDatetime);
  const end = new Date(event.endDatetime);
  const dateStr = dateFmt.format(start);
  const startTime = timeFmt.format(start);
  const endTime = timeFmt.format(end);
  lines.push(`\uD83D\uDD50 ${dateStr} \u00B7 ${startTime}\u2013${endTime} (${event.timezone})`);

  // Store
  lines.push(`\uD83C\uDFEA ${escapeHtml(event.store.name)}`);

  // Address
  if (event.store.fullAddress) {
    lines.push(`\uD83D\uDCCD ${escapeHtml(event.store.fullAddress)}`);
  }

  // Format / event type
  if (event.gameplayFormatName || event.eventType) {
    const fc = event.gameplayFormatName
      ? `\uD83C\uDFAE ${event.gameplayFormatName}${event.eventType ? ` \u00B7 ${event.eventType}` : ''}`
      : `\uD83C\uDFAE ${event.eventType}`;
    lines.push(fc);
  }

  // Capacity
  lines.push(`\uD83D\uDC65 ${event.registeredCount}/${event.capacity} jugadores`);

  // Description
  if (event.description) {
    lines.push(`\uD83D\uDCDD ${escapeHtml(event.description)}`);
  }

  // Cost
  if (event.costInCents === 0) {
    lines.push('\uD83D\uDCB0 Free');
  } else if (event.costInCents != null) {
    const currency = event.currency || 'EUR';
    const amountFmt = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    });
    lines.push(`\uD83D\uDCB0 ${amountFmt.format(event.costInCents / 100)}`);
  }

  // Players
  if (registrations === 'unavailable') {
    lines.push('\uD83D\uDC65 Players: unavailable');
  } else if (registrations.length > 0) {
    lines.push(`Players (${registrations.length}):`);
    for (const r of registrations) {
      lines.push(`  \u2022 ${escapeHtml(r.name)} \u2014 ${r.status}`);
    }
  }

  // Locator page (synthesized — the V2 API has no locator URL field)
  lines.push(`Locator: https://locator.riftbound.uvsgames.com/events/${event.id}`);

  // Build buttons using the numeric event id for callback data
  const buttons: InlineKeyboardButton[][] = [];

  // Show Leaderboard + All tables only when the event has started
  // (isStarted=true or undefined — fallback when the detail endpoint
  // is unreachable)
  if (options?.isStarted !== false) {
    buttons.push(
      [{ text: 'Leaderboard', callback_data: `event:${event.id}:leaderboard` }],
      [{ text: 'All tables', callback_data: `event:${event.id}:rounds` }],
    );
  }

  // Watch button only in private chats
  if (options?.privateChat === true) {
    buttons.push([{ text: 'Watch', callback_data: `event:${event.id}:watch:start` }]);
  }

  buttons.push([{ text: '\u2190 Back to list', callback_data: 'event:list' }]);

  return {
    body: lines.join('\n'),
    buttons,
  };
}
