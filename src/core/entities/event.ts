// Event — a Riftbound tournament event in the bot's domain model.
//
// Provider-specific fields are translated by adapters. `tournamentPhases`
// is populated by detail responses; list responses carry it empty.

import type { EventId, RoundId } from './event-id.js';

export interface Event {
  readonly id: EventId;
  readonly name: string;
  readonly displayStatus: 'upcoming' | 'inProgress' | 'complete';
  readonly eventStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED' | string;
  readonly startDatetime: string;   // ISO with offset (e.g. 2026-07-31T15:00:00+00:00)
  readonly endDatetime?: string | null;
  readonly timezone: string;        // IANA tz, e.g. "Europe/Madrid"
  readonly capacity: number;
  readonly registeredCount: number;
  readonly startingPlayerCount: number;
  readonly store: {
    readonly id: number | string;
    readonly name: string;
    readonly fullAddress: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly timezone: string | null;
    readonly country: string | null;
  };
  readonly gameplayFormatName: string;
  readonly headerImageUrl: string | null;
  readonly queueStatus: string;
  readonly eventType: string;
  readonly eventFormat: string;
  readonly description: string;
  readonly costInCents: number | null;
  readonly currency: string;
  readonly isOnDemand: boolean;
  readonly isTestEvent: boolean;
  readonly tournamentPhases: readonly EventPhaseSummary[];
  /** Canonical provider event page, when the provider exposes one. */
  readonly locatorUrl?: string;
  /** Whether the event has a supported 1v1 player-watch contract. */
  readonly supportsTracking?: boolean;
}

export interface EventPhaseSummary {
  readonly id: number | string;
  readonly status: 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETE' | string;
  readonly orderInPhases: number;
  readonly phaseName: string;
  readonly rounds: readonly EventRoundSummary[];
}

export interface EventRoundSummary {
  readonly id: RoundId;
  readonly roundNumber: number;
  readonly status: 'UPCOMING' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | string;
  readonly pairingsStatus: string | null;
  readonly standingsStatus: string | null;
}
