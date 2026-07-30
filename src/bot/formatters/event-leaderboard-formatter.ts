// formatEventLeaderboard — renders overall player standings.

import { LocatorEventData } from '../../core/ports/locator-repository.js';

export function formatEventLeaderboard(data: LocatorEventData): string {
  const lines: string[] = [];

  lines.push(
    `\uD83C\uDFC6 ${data.name} \u2014 Round ${data.currentRound ?? '?'}`,
  );
  lines.push('');

  if (data.standings.length === 0) {
    lines.push('No standings available yet.');
    return lines.join('\n');
  }

  for (const entry of data.standings) {
    const wins = entry.wins != null ? String(entry.wins) : '?';
    const losses = entry.losses != null ? String(entry.losses) : '?';
    lines.push(`#${entry.rank} ${entry.name} (${wins}-${losses})`);
  }

  return lines.join('\n');
}
