import { Event } from '../../core/entities/event.js';
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

function fmtDate(d: Date): string {
  return dateFmt.format(d);
}

function fmtTime(d: Date): string {
  return timeFmt.format(d);
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface EventListButton {
  label: string;
  callbackData: string;
}

export interface FormattedEventList {
  readonly body: string;
  readonly buttons: readonly EventListButton[][];
}

// ---------------------------------------------------------------------------
// formatEventList
// ---------------------------------------------------------------------------

// Renders a temporal window of events as an HTML body with inline-keyboard
// button descriptors. The caller wraps the button descriptors in
// Markup.button.callback() and Markup.inlineKeyboard().
//
// Sorting: events are sorted by startDate ascending.
// Buttons:  1–8 events → one row per event (📅 <name> · <date>).
//          >8 events → first 8 rows + a final "Show all (N)" button row.
// Body:     all events listed as text regardless of count.
//
// The daysAhead parameter is the size of the window, used to label the
// header and the empty state honestly.

export function formatEventList(events: readonly Event[], daysAhead: number): FormattedEventList {
  const dayLabel = daysAhead === 1 ? '1 day' : `${daysAhead} days`;

  if (events.length === 0) {
    return {
      body: `No events found in your area in the next ${dayLabel}.`,
      buttons: [],
    };
  }

  // Sort by startDate ascending
  const sorted = [...events].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  const parts: string[] = [];
  parts.push(`<b>Upcoming Events (next ${dayLabel})</b>`);
  parts.push('');

  for (const event of sorted) {
    const dateStr = fmtDate(event.startDate);
    const startTime = fmtTime(event.startDate);
    const endTime = fmtTime(event.endDate);

    parts.push(`\uD83D\uDCC5 <b>${escapeHtml(event.name)}</b>`);
    parts.push(`  ${dateStr} \u00B7 ${startTime}\u2013${endTime} \u00B7 ${escapeHtml(event.storeName)}`);
    parts.push('');
  }

  // Build buttons
  const buttonRows: EventListButton[][] = [];

  // Button label: "📅 <name> · <date>"
  const buttonDateFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  });

  const makeButton = (ev: Event): EventListButton => ({
    label: `\uD83D\uDCC5 ${ev.name} \u00B7 ${buttonDateFmt.format(ev.startDate)}`,
    callbackData: `event:${ev.id}`,
  });

  if (sorted.length <= 8) {
    // One row per event
    for (const ev of sorted) {
      buttonRows.push([makeButton(ev)]);
    }
  } else {
    // First 8 events + Show all row
    for (let i = 0; i < 8; i++) {
      buttonRows.push([makeButton(sorted[i]!)]);
    }
    buttonRows.push([
      { label: `Show all (${sorted.length})`, callbackData: 'event:list:show-all' },
    ]);
  }

  return {
    body: parts.join('\n'),
    buttons: buttonRows,
  };
}
