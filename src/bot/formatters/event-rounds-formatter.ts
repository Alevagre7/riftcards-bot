// formatEventRounds — renders the current round's pairings.

import { EventRoundSummary } from '../../core/entities/event.js';
import { EventPairing } from '../../core/entities/event-detail.js';
import { escapeHtml } from './card-formatter.js';
import { joinTelegramLines } from '../utils/telegram-text.js';

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
    if (pairing.outcome === 'bye' || pairing.isBye) {
      const player = pairing.player1 || pairing.player2 || 'Unknown player';
      lines.push(
        `\uD83E\uDDBA <b>Table ${pairing.tableNumber}</b> \u00B7 <b>${escapeHtml(player)}</b> \u00B7 \u21AA\uFE0F <i>bye</i>`,
      );
      continue;
    }

    const winnerOnLeft = pairing.outcome === 'win' && pairing.winner === pairing.player2;
    const leftName = winnerOnLeft ? pairing.player2 : pairing.player1;
    const rightName = winnerOnLeft ? pairing.player1 : pairing.player2;
    const leftScore = winnerOnLeft ? pairing.score2 : pairing.score1;
    const rightScore = winnerOnLeft ? pairing.score1 : pairing.score2;
    const names = `<b>${escapeHtml(leftName)}</b> \u2694\uFE0F <b>${escapeHtml(rightName)}</b>`;

    let result: string;
    switch (pairing.outcome) {
      case 'win':
        result = leftScore != null && rightScore != null
          ? `\uD83C\uDFC6 ${names} \u00B7 <b>${leftScore}\u2013${rightScore}</b>`
          : `${names} \u00B7 \u26A0\uFE0F <i>result unavailable</i>`;
        break;
      case 'draw':
        result = `${names} \u00B7 \uD83E\uDD1D <b>Draw</b>${
          pairing.drawType ? ` <i>(${pairing.drawType})</i>` : ''
        }`;
        break;
      case 'pending':
        result = `${names} \u00B7 \u23F3 <i>not reported</i>`;
        break;
      case 'conflict':
        result = `${names} \u00B7 \u26A0\uFE0F <i>reports conflict</i>`;
        break;
      case 'loss':
        result = `${names} \u00B7 \u274C <i>loss recorded</i>`;
        break;
      case 'unavailable':
        result = `${names} \u00B7 \u26A0\uFE0F <i>result unavailable</i>`;
        break;
    }
    lines.push(`\uD83E\uDDBA <b>Table ${pairing.tableNumber}</b> \u00B7 ${result}`);
  }

  return joinTelegramLines(lines);
}
