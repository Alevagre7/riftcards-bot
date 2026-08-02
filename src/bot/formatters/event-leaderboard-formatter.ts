// formatEventLeaderboard — renders overall player standings for an
// event's current round.

import { EventStanding } from '../../core/entities/event-detail.js';
import { escapeHtml } from './card-formatter.js';

export interface LeaderboardData {
  readonly name: string;
  readonly currentRound: number | null;
  readonly standings: readonly EventStanding[];
}

// Top-3 get medals, everyone else a plain #rank. The medal prefix
// makes the podium readable at a glance.
function rankLabel(rank: number): string {
  if (rank === 1) return '\uD83E\uDD47'; // 🥇
  if (rank === 2) return '\uD83E\uDD48'; // 🥈
  if (rank === 3) return '\uD83E\uDD49'; // 🥉
  return `#${rank}`;
}

const percentFmt = new Intl.NumberFormat('en-GB', {
  style: 'percent',
  maximumFractionDigits: 1,
});

export function formatEventLeaderboard(data: LeaderboardData): string {
  const lines: string[] = [];

  lines.push(
    `\uD83C\uDFC6 <b>${escapeHtml(data.name)}</b> \u2014 Round <b>${data.currentRound ?? '?'}</b>`,
  );
  lines.push('');

  if (data.standings.length === 0) {
    lines.push('\uD83E\uDD37 No standings available yet.');
    return lines.join('\n');
  }

  for (const entry of data.standings) {
    lines.push(
      `${rankLabel(entry.rank)} <b>${escapeHtml(entry.name)}</b> \u2014 <b>${escapeHtml(entry.matchRecord)}</b> \u00B7 <i>${entry.points} pts</i>`,
    );
    lines.push(
      `   OMW ${percentFmt.format(entry.opponentMatchWinPercentage)} \u00B7 GW ${percentFmt.format(entry.gameWinPercentage)} \u00B7 OGW ${percentFmt.format(entry.opponentGameWinPercentage)}`,
    );
  }

  return lines.join('\n');
}
