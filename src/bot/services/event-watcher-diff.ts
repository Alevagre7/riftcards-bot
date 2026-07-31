// detectPairingChange — pure diff between a watch's last-seen snapshot
// and the current locator pairing data. All rules are independent;
// multiple reasons may fire in one tick.

import { EventWatch } from '../../core/entities/event-watch.js';
import { EventPairing } from '../../core/entities/event-detail.js';

export type ChangeReason =
  | 'new-round'
  | 'round-changed'
  | 'opponent-changed'
  | 'table-changed'
  | 'result-submitted'
  | 'result-changed';

export interface PairingDiff {
  readonly changed: boolean;
  readonly reasons: readonly ChangeReason[];
}

export function detectPairingChange(
  prev: Pick<
    EventWatch,
    | 'lastSeenRound'
    | 'lastSeenTable'
    | 'lastSeenOpponent'
    | 'lastSeenResult'
  >,
  next: EventPairing,
  currentRound: number | null,
  username: string,
): PairingDiff {
  const reasons: ChangeReason[] = [];

  // new-round: prev had no round, now there is one.
  if (prev.lastSeenRound === null && currentRound !== null) {
    reasons.push('new-round');
  }

  // round-changed: prev had a different round number.
  if (
    prev.lastSeenRound !== null &&
    currentRound !== null &&
    prev.lastSeenRound !== currentRound
  ) {
    reasons.push('round-changed');
  }

  // table-changed: both sides non-null and different.
  if (
    prev.lastSeenTable !== null &&
    next.tableNumber !== null &&
    prev.lastSeenTable !== next.tableNumber
  ) {
    reasons.push('table-changed');
  }

  // opponent-changed: both sides non-null and different.
  // The opponent is whichever player name is NOT the watched user.
  if (
    prev.lastSeenOpponent !== null &&
    next.player1 &&
    next.player2 &&
    prev.lastSeenOpponent !== next.player1 &&
    prev.lastSeenOpponent !== next.player2
  ) {
    reasons.push('opponent-changed');
  }

  // result-submitted: prev null, now non-null.
  if (prev.lastSeenResult === null && next.score1 !== null && next.score2 !== null) {
    reasons.push('result-submitted');
  }

  // result-changed: both non-null and different. Compare from the
  // watched user's POV (matches how lastSeenResult is stored); the
  // raw scores are order-sensitive (player1 vs player2).
  if (
    prev.lastSeenResult !== null &&
    next.score1 !== null &&
    next.score2 !== null
  ) {
    const newResult = scoresToResult(next.score1, next.score2, username, next);
    if (prev.lastSeenResult !== newResult) {
      reasons.push('result-changed');
    }
  }

  return {
    changed: reasons.length > 0,
    reasons,
  };
}

/** Convert a pairing's scores into a result label from the POV of
 *  the watched username. `pairing` identifies which side (player1/
 *  player2) the username is on so the label matches the format used
 *  when the watch snapshot is updated. */
function scoresToResult(
  score1: number,
  score2: number,
  username: string,
  pairing: { player1: string; player2: string },
): 'win' | 'loss' | 'draw' | 'bye' {
  if (score1 === score2) return 'draw';
  const isPlayer1 = pairing.player1 === username;
  const userScore = isPlayer1 ? score1 : score2;
  const oppScore = isPlayer1 ? score2 : score1;
  if (userScore > oppScore) return 'win';
  return 'loss';
}
