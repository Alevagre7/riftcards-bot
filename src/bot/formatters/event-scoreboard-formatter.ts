// formatEventScoreboard — renders live pairing data as plain text.

import { LocatorEventData } from '../../core/ports/locator-repository.js';

export function formatEventScoreboard(data: LocatorEventData): string {
  const lines: string[] = [];

  lines.push(
    `\uD83D\uDCCA ${data.name} \u2014 Round ${data.currentRound ?? '?'}`,
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
