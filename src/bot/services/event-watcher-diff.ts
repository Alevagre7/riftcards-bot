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

  const nextResult = pairingToResult(next, username);

  // result-submitted: prev null, now a known result.
  if (prev.lastSeenResult === null && nextResult !== null) {
    reasons.push('result-submitted');
  }

  // result-changed: both known and different. Compare from the watched
  // user's POV, which matches how lastSeenResult is stored.
  if (
    prev.lastSeenResult !== null &&
    nextResult !== null &&
    prev.lastSeenResult !== nextResult
  ) {
    reasons.push('result-changed');
  }

  return {
    changed: reasons.length > 0,
    reasons,
  };
}

/** Convert an explicit pairing outcome into a result from the watched
 * username's perspective. Unknown outcomes remain null so snapshots do
 * not advance before the official result is reportable. */
export function pairingToResult(
  pairing: EventPairing,
  username: string,
): 'win' | 'loss' | 'draw' | 'bye' | null {
  if (pairing.player1 !== username && pairing.player2 !== username) return null;
  switch (pairing.outcome) {
    case 'bye':
      return 'bye';
    case 'draw':
      return 'draw';
    case 'win':
      if (pairing.winner === username) return 'win';
      if (pairing.winner === pairing.player1 || pairing.winner === pairing.player2) return 'loss';
      return null;
    case 'loss':
      return 'loss';
    case 'pending':
    case 'conflict':
    case 'unavailable':
      return null;
  }
}
