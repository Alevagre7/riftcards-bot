// EventDetail — the per-event live bundle the bot's leaderboard,
// rounds, and watch flows consume. Built by
// RiftboundV2Adapter.getEventDetail: one fetch of the event + its
// registrations, then the current round's pairings and standings.
//
// `currentRound` is derived from the event's tournament phases
// (see deriveCurrentRound in the V2 adapter): IN_PROGRESS first,
// then PENDING, then the last COMPLETE round, else null.

import { Event, EventRoundSummary } from './event.js';
import { EventRegistration } from './event-registration.js';

export interface EventPairing {
  readonly tableNumber: number;
  readonly player1: string;          // user_event_status.best_identifier
  readonly player2: string;          // user_event_status.best_identifier
  readonly score1: number | null;
  readonly score2: number | null;
  readonly isBye: boolean;
}

export interface EventStanding {
  readonly rank: number;
  readonly name: string;            // player.best_identifier (== standings[].player.best_identifier)
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly matchPoints: number;
  readonly matchRecord: string;      // "W-L-D"
}

export interface EventDetail {
  readonly event: Event;
  readonly currentRound: EventRoundSummary | null;  // derived; null if no phases/rounds
  readonly registrations: readonly EventRegistration[];
  readonly pairings: readonly EventPairing[];
  readonly standings: readonly EventStanding[];
  readonly fetchedAt: string;
}
