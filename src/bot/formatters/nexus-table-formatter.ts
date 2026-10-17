import { NexusTable } from '../../core/entities/nexus-table.js';
import { escapeHtml } from './card-formatter.js';

function formatEventDate(date: Date, timezone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone ?? 'UTC',
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }
}

export function formatNexusTable(table: NexusTable): string {
  const lines: string[] = [];
  const username = escapeHtml(table.username);

  // Header
  lines.push(`<b>My table \u2014 ${username}</b>`);

  // Empty state: no active pairing
  if (table.event === null && table.round === null && table.opponent === null) {
    lines.push('');
    lines.push(
      `No table found for ${username} at your selected store today.`,
    );
    return lines.join('\n');
  }

  // Event block
  if (table.event !== null) {
    const eventName = escapeHtml(table.event.name);
    const storeName = escapeHtml(table.event.store.name);
    const eventDate = formatEventDate(table.event.startDate, table.event.store.timezone);
    lines.push('');
    lines.push(`${eventName} \u00B7 ${storeName} \u00B7 ${eventDate}`);
  }

  // Round / table block
  if (table.round !== null || table.tableNumber !== null) {
    lines.push('');
    if (table.round !== null && table.tableNumber !== null) {
      lines.push(`Round ${table.round.number} \u00B7 Table ${table.tableNumber}`);
    } else if (table.round !== null) {
      lines.push(`Round ${table.round.number} \u00B7 Table N/A`);
    } else {
      lines.push(`Table ${table.tableNumber}`);
    }
  }

  // Opponent block
  if (table.opponent !== null) {
    lines.push('');
    const opponentName = escapeHtml(table.opponent.name);
    lines.push(`Opponent: ${opponentName}`);
    if (table.opponent.score !== null) {
      lines.push(`Opponent Score: ${table.opponent.score}`);
    }
  }

  if (table.round?.result != null) {
    const result = { win: 'Win', loss: 'Loss', draw: 'Draw', bye: 'Bye' }[table.round.result];
    lines.push(`Result: ${result}`);
  }

  // Record block
  lines.push('');
  lines.push(`Record: ${table.record.wins}-${table.record.losses}-${table.record.draws}`);

  // Standings block
  if (table.standings !== null) {
    lines.push(
      `Standings: rank ${table.standings.rank} \u00B7 ${table.standings.points} pts`,
    );
  }

  // Status block
  lines.push('');
  if (table.status.inProgress) {
    lines.push('Status: in progress');
  } else if (table.round?.status === 'completed') {
    lines.push('Status: completed');
  } else {
    lines.push('Status: pending');
  }

  // Footer: locator link
  if (table.event !== null) {
    lines.push('');
    lines.push(
      `PlayRiftbound: ${escapeHtml(
        table.event.locatorUrl ??
          `https://events.playriftbound.com/en-US/events/${encodeURIComponent(table.event.id.replace(/^riot:/, ''))}`,
      )}`,
    );
  }

  return lines.join('\n');
}
