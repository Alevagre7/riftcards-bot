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

const costFmt = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  currencyDisplay: 'symbol',
});

// ---------------------------------------------------------------------------
// formatEventDetail
// ---------------------------------------------------------------------------

// Renders a single event's full detail as an HTML string. The caller is
// responsible for attaching the Back button to the inline keyboard.
//
// registrations: pass the upstream registration list, or the literal
// string 'unavailable' when the endpoint failed.

export function formatEventDetail(
  event: Event,
  registrations: readonly EventRegistration[] | 'unavailable',
): string {
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

  // Cost
  if (event.isFree) {
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

  // Locator URL (always present since id is required on Event)
  lines.push(`Locator: ${event.locatorUrl}`);

  return lines.join('\n');
}
