// formatEventRounds — renders round-by-round pairing data.
//
// The locator currently only exposes the current round in SSR HTML,
// so this formatter renders that single round and appends a note
// that the round-by-round view is limited. The structure allows
// future extension when more round data becomes available.

import { LocatorEventData } from '../../core/ports/locator-repository.js';

export interface RoundsData {
  /** The current round pairings (only data source today). */
  readonly currentRound: number | null;
  /** Flat list of pairings for the current round. */
  readonly pairings: readonly LocatorEventData['pairings'][number][];
}

export function formatEventRounds(data: LocatorEventData): string {
  const lines: string[] = [];

  lines.push(
    `\uD83C\uDFB2 ${data.name} \u2014 Round ${data.currentRound ?? '?'}`,
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
      `Table ${pairing.tableNumber} \u00B7 ${pairing.player1} vs ${pairing.player2} \u00B7 ${score}`,
    );
  }

  return lines.join('\n');
}
