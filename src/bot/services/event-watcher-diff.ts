// detectPairingChange — pure diff between a watch's last-seen snapshot
// and the current locator pairing data. All rules are independent;
// multiple reasons may fire in one tick.

import { EventWatch } from '../../core/entities/event-watch.js';
import { LocatorPairing } from '../../core/ports/locator-repository.js';

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
  next: LocatorPairing,
  currentRound: number | null,
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

  // result-changed: both non-null and different.
  if (
    prev.lastSeenResult !== null &&
    next.score1 !== null &&
    next.score2 !== null
  ) {
    // Convert scores to a result label for comparison
    const newResult = scoresToResult(next.score1, next.score2);
    if (prev.lastSeenResult !== newResult) {
      reasons.push('result-changed');
    }
  }

  return {
    changed: reasons.length > 0,
    reasons,
  };
}

/** Convert a pairing's scores into a result label from the POV of player1. */
function scoresToResult(
  score1: number,
  score2: number,
): 'win' | 'loss' | 'draw' | 'bye' {
  if (score1 > score2) return 'win';
  if (score2 > score1) return 'loss';
  return 'draw';
}
