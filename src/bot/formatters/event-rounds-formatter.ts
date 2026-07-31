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

// Round status → colored emoji chip. Makes the round's state
// obvious at a glance without parsing the raw status string.
function roundStatusChip(status: string | undefined): string {
  switch (status) {
    case 'IN_PROGRESS':
      return '\uD83D\uDFE1'; // 🟡
    case 'COMPLETE':
      return '\u2705';       // ✅
    case 'UPCOMING':
    case 'PENDING':
      return '\u23F3';       // ⏳
    default:
      return '';
  }
}

export function formatEventRounds(data: RoundsData): string {
  const lines: string[] = [];

  const chip = roundStatusChip(data.currentRound?.status);
  const header = `\uD83C\uDFB2 <b>${escapeHtml(data.name)}</b> \u2014 Round <b>${data.currentRound?.roundNumber ?? '?'}</b>`;
  lines.push(chip ? `${header} ${chip}` : header);
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
    const reported = pairing.score1 != null && pairing.score2 != null;
    const score = reported
      ? `\u2705 <b>${pairing.score1}\u2013${pairing.score2}</b>`
      : '\u23F3 <i>not reported</i>';
    lines.push(
      `\uD83E\uDDBA <b>Table ${pairing.tableNumber}</b> \u00B7 \u2694\uFE0F <b>${escapeHtml(pairing.player1)}</b> vs <b>${escapeHtml(pairing.player2)}</b> \u00B7 ${score}`,
    );
  }

  return lines.join('\n');
}
