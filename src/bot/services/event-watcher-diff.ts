// detectPairingChange — pure diff between a watch's last-seen snapshot
// and the current locator pairing data. All rules are independent;
// multiple reasons may fire in one tick.

import { EventWatch } from '../../core/entities/event-watch.js';
import { EventPairing } from '../../core/entities/event-detail.js';
import type { RoundId } from '../../core/entities/event-id.js';

export type ChangeReason =
  | 'first-pairing'
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
    | 'lastSeenRoundId'
    | 'lastSeenTable'
    | 'lastSeenOpponent'
    | 'lastSeenResult'
    | 'hasObservedPairing'
  >,
  next: EventPairing,
  currentRound: number | null,
  username: string,
  currentRoundId?: RoundId | null,
  registrationId?: number | string,
): PairingDiff {
  const reasons: ChangeReason[] = [];

  // The first observation after subscribing is different from a genuine
  // new round. The boolean survives the short gap between rounds while
  // the current pairing snapshot may be cleared during that gap.
  if (!prev.hasObservedPairing && currentRound !== null) {
    reasons.push('first-pairing');
  } else if (prev.lastSeenRound === null && currentRound !== null) {
    reasons.push('new-round');
  }

  // round-changed: prev had a different round number.
  const roundChanged = prev.lastSeenRoundId != null && currentRoundId != null
    ? prev.lastSeenRoundId !== currentRoundId
    : prev.lastSeenRound !== null && currentRound !== null && prev.lastSeenRound !== currentRound;

  if ((prev.lastSeenRound !== null || prev.lastSeenRoundId != null) && currentRound !== null && roundChanged) {
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

  const nextResult = pairingToResult(next, username, registrationId);

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
  registrationId?: number | string,
): 'win' | 'loss' | 'draw' | 'bye' | null {
  const side = watchedSide(pairing, username, registrationId);
  if (side === null) return null;
  switch (pairing.outcome) {
    case 'bye':
      return 'bye';
    case 'draw':
      return 'draw';
    case 'win':
      if (pairing.winnerId != null && pairing.player1Id != null && pairing.player2Id != null) {
        const watchedId = side === 'player1' ? pairing.player1Id : pairing.player2Id;
        return pairing.winnerId === watchedId ? 'win' : 'loss';
      }
      if (registrationId !== undefined && (pairing.player1Id != null || pairing.player2Id != null)) {
        // The watched identity is stable but the winner identity is not. A
        // display name cannot safely disambiguate duplicate names here.
        return null;
      }
      if (pairing.winner === username) return 'win';
      if (pairing.winner === pairing.player1 || pairing.winner === pairing.player2) return 'loss';
      return null;
    case 'loss':
      // A provider's generic loss marker does not say which participant
      // lost. Require a winner identity before telling either player they
      // lost.
      return null;
    case 'pending':
    case 'conflict':
    case 'unavailable':
      return null;
  }
}

type PlayerSide = 'player1' | 'player2';

function watchedSide(
  pairing: EventPairing,
  username: string,
  registrationId?: number | string,
): PlayerSide | null {
  if (registrationId !== undefined) {
    const id = String(registrationId);
    const isPlayer1 = pairing.player1Id === id;
    const isPlayer2 = pairing.player2Id === id;
    if (isPlayer1 === isPlayer2) return null;
    return isPlayer1 ? 'player1' : 'player2';
  }

  const isPlayer1 = pairing.player1 === username;
  const isPlayer2 = pairing.player2 === username;
  if (isPlayer1 === isPlayer2) return null;
  return isPlayer1 ? 'player1' : 'player2';
}

/** Match a watch to exactly one pairing by stable ID, or by a unique legacy
 * name match when the watch predates registration IDs. */
export function findPairingForWatch(
  pairings: readonly EventPairing[],
  watch: Pick<EventWatch, 'eventUsername' | 'registrationId'>,
): EventPairing | null {
  const matches = pairings.filter(
    (pairing) => watchedSide(pairing, watch.eventUsername, watch.registrationId) !== null,
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}
