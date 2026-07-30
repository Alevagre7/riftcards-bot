import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { escapeHtml } from './card-formatter.js';

const tz = 'Europe/Madrid';

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

// ---------------------------------------------------------------------------
// formatEventDetail
// ---------------------------------------------------------------------------

// Renders a single event's full detail as an HTML string with inline
// keyboard buttons for Scoreboard, All tables, and optionally Watch
// (only in private chats when locatorEventId is present).
//
// registrations: pass the upstream registration list, or the literal
// string 'unavailable' when the endpoint failed.

export interface EventDetailResult {
  body: string;
  buttons: InlineKeyboardButton[][];
}

export function formatEventDetail(
  event: Event,
  registrations: readonly EventRegistration[] | 'unavailable',
  options?: { privateChat?: boolean },
): EventDetailResult {
  const lines: string[] = [];

  // Header
  lines.push(`\uD83D\uDCC5 <b>${escapeHtml(event.name)}</b>`);

  // Date/time
  const dateStr = dateFmt.format(event.startDate);
  const startTime = timeFmt.format(event.startDate);
  const endTime = timeFmt.format(event.endDate);
  lines.push(`\uD83D\uDD50 ${dateStr} \u00B7 ${startTime}\u2013${endTime} (Europe/Madrid)`);

  // Store
  lines.push(`\uD83C\uDFEA ${escapeHtml(event.storeName)}`);

  // Event type (riftfound)
  if (event.eventType) {
    lines.push(`\uD83C\uDFAF ${escapeHtml(event.eventType)}`);
  }

  // Address
  if (event.storeAddress) {
    lines.push(`\uD83D\uDCCD ${escapeHtml(event.storeAddress)}`);
  }

  // Format / category
  if (event.format || event.category) {
    const fc = event.format
      ? `\uD83C\uDFAE ${event.format}${event.category ? ` \u00B7 ${event.category}` : ''}`
      : `\uD83C\uDFAE ${event.category}`;
    lines.push(fc);
  }

  // Capacity / meeting type
  const capStr = `\uD83D\uDC65 ${event.capacity.registered}/${event.capacity.max} jugadores`;
  if (event.meetingType) {
    lines.push(`${capStr} \u00B7 ${event.meetingType}`);
  } else {
    lines.push(capStr);
  }

  // Description (riftfound)
  if (event.description) {
    lines.push(`\uD83D\uDCDD ${escapeHtml(event.description)}`);
  }

  // Cost — prefer riftfound price string, fall back to legacy fields
  if (event.price) {
    lines.push(`\uD83D\uDCB0 ${escapeHtml(event.price)}`);
  } else if (event.isFree) {
    lines.push('\uD83D\uDCB0 Free');
  } else if (event.costAmount != null) {
    const currency = event.costCurrency || 'EUR';
    const amountFmt = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    });
    lines.push(`\uD83D\uDCB0 ${amountFmt.format(event.costAmount)}`);
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

  // External URL (riftfound)
  if (event.externalUrl) {
    lines.push(`\uD83D\uDD17 <a href="${escapeHtml(event.externalUrl)}">${escapeHtml(event.externalUrl)}</a>`);
  }

  // Locator URL
  lines.push(`Locator: ${event.locatorUrl}`);

  // Build buttons using locatorEventId (numeric) for callback data
  const locatorId = event.locatorEventId ?? event.id;
  const buttons: InlineKeyboardButton[][] = [
    [{ text: 'Scoreboard', callback_data: `event:${locatorId}:scoreboard` }],
    [{ text: 'All tables', callback_data: `event:${locatorId}:rounds` }],
  ];

  // Watch button only in private chats when locatorEventId is available
  if (options?.privateChat === true && event.locatorEventId != null) {
    buttons.push([{ text: 'Watch', callback_data: `event:${event.locatorEventId}:watch:start` }]);
  }

  buttons.push([{ text: '\u2190 Back to list', callback_data: 'event:list' }]);

  return {
    body: lines.join('\n'),
    buttons,
  };
}
