// formatEventLeaderboard — renders overall player standings for an
// event's current round.

import { EventStanding } from '../../core/entities/event-detail.js';

export interface LeaderboardData {
  readonly name: string;
  readonly currentRound: number | null;
  readonly standings: readonly EventStanding[];
}

export function formatEventLeaderboard(data: LeaderboardData): string {
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
    lines.push(`#${entry.rank} ${entry.name} (${entry.wins}-${entry.losses})`);
  }

  return lines.join('\n');
}
