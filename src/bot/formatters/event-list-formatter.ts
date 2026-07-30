import { Event } from '../../core/entities/event.js';

const tz = 'Europe/Madrid';

const buttonDateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  timeZone: tz,
});

// Match eventType case-insensitively against the known riftfound type
// substrings and return a colored circle emoji. The icons are part of
// the button label only — never stored on the Event entity. Substring
// match is intentional: defensive against upstream name tweaks
// ("Summoner Skirmish" vs. "Skirmish"). "pre" matches "Pre-Rift",
// "Pre Rift", "Prerift", etc.
function eventTypeIcon(eventType: string): string {
  const t = eventType.toLowerCase();
  if (t.includes('skirmish')) return '\uD83D\uDD35';   // \U0001f535
  if (t.includes('nexus night')) return '\uD83D\uDFE3'; // \U0001f7e3
  if (t.includes('pre')) return '\uD83D\uDFE2';         // \U0001f7e2
  return '\u26AA';                                       // ⚪
}

const MAX_BUTTON_LABEL = 64;

function makeButton(ev: Event): EventListButton {
  const dayStr = buttonDateFmt.format(ev.startDate);
  const parts = [
    `${eventTypeIcon(ev.eventType)} ${dayStr}`,        // 🔵 Tue 21
    ev.eventType || 'Event',
    ev.storeName,
    `${ev.capacity.registered}/${ev.capacity.max}`,
  ];
  const full = parts.join(' · ');                          // " · "
  const label = full.length <= MAX_BUTTON_LABEL
    ? full
    : full.slice(0, MAX_BUTTON_LABEL - 1) + '…';          // …
  return { label, callbackData: `event:${ev.id}` };
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface EventListButton {
  readonly label: string;
  readonly callbackData: string;
}

export interface FormattedEventList {
  readonly body: string;
  readonly buttons: readonly EventListButton[][];
}

// ---------------------------------------------------------------------------
// formatEventList
// ---------------------------------------------------------------------------

// Renders a paginated window of events.
//
// Body: a single count line — e.g. "12 events in the next 7 days".
//       Empty state keeps "No events found in your area in the next N days."
//
// Buttons: one row per event on the current page (≤ pageSize rows).
//          If there are more events than one page, the last row is a
//          pagination row: ← Prev | Page N of M | Next →
//
// The caller is responsible for sorting events by startDate ascending.

export function formatEventList(
  events: readonly Event[],
  daysAhead: number,
  currentPage: number = 0,
  pageSize: number = 8,
): FormattedEventList {
  const dayLabel = daysAhead === 1 ? '1 day' : `${daysAhead} days`;

  if (events.length === 0) {
    return {
      body: `No events found in your area in the next ${dayLabel}.`,
      buttons: [],
    };
  }

  // Body: single count line
  const eventLabel = events.length === 1 ? 'event' : 'events';
  const body = `${events.length} ${eventLabel} in the next ${dayLabel}`;

  const totalPages = Math.ceil(events.length / pageSize);
  // Clamp currentPage to valid range
  const page = Math.max(0, Math.min(currentPage, totalPages - 1));
  const start = page * pageSize;
  const end = Math.min(start + pageSize, events.length);
  const pageEvents = events.slice(start, end);

  const buttonRows: EventListButton[][] = [];

  // One row per event on this page
  for (const ev of pageEvents) {
    buttonRows.push([makeButton(ev)]);
  }

  // Pagination row (only when total > 1 page)
  if (totalPages > 1) {
    const row: EventListButton[] = [];

    if (page > 0) {
      row.push({ label: '\u2190 Prev', callbackData: `event:page:${page - 1}` });
    }

    row.push({
      label: `Page ${page + 1} of ${totalPages}`,
      callbackData: `event:page:${page}`,
    });

    if (page < totalPages - 1) {
      row.push({ label: 'Next \u2192', callbackData: `event:page:${page + 1}` });
    }

    buttonRows.push(row);
  }

  return { body, buttons: buttonRows };
}
