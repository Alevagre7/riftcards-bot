// formatEventRounds — renders the current round's pairings.

import { EventRoundSummary } from '../../core/entities/event.js';
import { EventPairing } from '../../core/entities/event-detail.js';
import { escapeHtml } from './card-formatter.js';

export interface RoundsData {
  /** The event display name. */
  readonly name: string;
  /** The derived current round (null when none is active). */
  readonly currentRound: EventRoundSummary | null;
  /** Flat list of pairings for the current round. */
  readonly pairings: readonly EventPairing[];
}

export function formatEventRounds(data: RoundsData): string {
  const lines: string[] = [];

  lines.push(
    `\uD83C\uDFB2 <b>${escapeHtml(data.name)}</b> \u2014 Round ${data.currentRound?.roundNumber ?? '?'}`,
  );
  lines.push('');

  if (data.pairings.length === 0) {
    if (data.currentRound === null) {
      lines.push('No active round.');
    } else {
      lines.push('No pairings yet.');
    }
    return lines.join('\n');
  }

  for (const pairing of data.pairings) {
    const score =
      pairing.score1 != null && pairing.score2 != null
        ? `${pairing.score1}-${pairing.score2}`
        : 'not reported';
    lines.push(
      `Table ${pairing.tableNumber} \u00B7 ${escapeHtml(pairing.player1)} vs ${escapeHtml(pairing.player2)} \u00B7 ${score}`,
    );
  }

  return lines.join('\n');
}
