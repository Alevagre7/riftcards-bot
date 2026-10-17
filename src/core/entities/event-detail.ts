// EventDetail — the per-event live bundle the bot's leaderboard,
// rounds, and watch flows consume. An adapter gathers the event,
// registrations, pairings, and standings.
//
// `currentRound` is derived from the event's tournament phases
// based on the provider's phase data: IN_PROGRESS first,
// then PENDING, then the last COMPLETE round, else null.

import { Event, EventRoundSummary } from './event.js';
import { EventRegistration } from './event-registration.js';
import type { RoundId } from './event-id.js';

export interface EventPairing {
  readonly tableNumber: number;
  readonly player1: string;          // player display name
  readonly player2: string;          // player display name
  /** Stable provider IDs, present when the event API supplies them. */
  readonly player1Id?: string;
  readonly player2Id?: string;
  readonly winnerId?: string | null;
  readonly score1: number | null;
  readonly score2: number | null;
  readonly isBye: boolean;
  readonly status: string;
  readonly outcome: 'pending' | 'win' | 'draw' | 'loss' | 'conflict' | 'bye' | 'unavailable';
  readonly winner: string | null;
  readonly drawType: 'intentional' | 'unintentional' | null;
  readonly gamesDrawn: number;
}

export interface EventStanding {
  readonly rank: number;
  readonly name: string;            // player's in-game display name
  /** Stable provider ID, present when the event API supplies it. */
  readonly playerId?: string;
  readonly roundNumber: number;
  readonly matchRecord: string;      // "wins-losses-draws"
  readonly points: number;
  readonly opponentMatchWinPercentage: number;
  readonly gameWinPercentage: number;
  readonly opponentGameWinPercentage: number;
}

export interface EventDetail {
  readonly event: Event;
  readonly currentRound: EventRoundSummary | null;  // derived; null if no phases/rounds
  readonly registrations: readonly EventRegistration[];
  readonly pairings: readonly EventPairing[];
  readonly standings: readonly EventStanding[];
  readonly fetchedAt: string;
  /** Round number associated with `standings`, when known. */
  readonly standingsRoundNumber?: number;
  /** Stable round identity associated with `standings`, when known. */
  readonly standingsRoundId?: RoundId;
}
