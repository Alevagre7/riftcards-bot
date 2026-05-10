import { Event } from '../../core/entities/event.js';

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

export function formatEventList(events: Event[]): string {
  if (events.length === 0) {
    return 'No events found in your area this week.';
  }

  const parts: string[] = [];
  parts.push('<b>Upcoming Events (next 7 days)</b>');
  parts.push('');

  for (const event of events) {
    const dateStr = fmtDate(event.startDate);
    const startTime = fmtTime(event.startDate);
    const endTime = fmtTime(event.endDate);

    parts.push(`\uD83D\uDCC5 <b>${event.name}</b>`);
    parts.push(`\uD83C\uDFEA ${event.storeName}`);
    parts.push(`\uD83D\uDD50 ${dateStr} \u2014 ${startTime} to ${endTime}`);
    if (event.format) {
      parts.push(`\uD83C\uDFAE ${event.format}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
