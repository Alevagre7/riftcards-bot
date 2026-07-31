// Event — a Riftbound tournament event as served by the official
// Riftbound V2 API (https://api.riftbound.uvsgames.com/api/v2).
//
// The field names mirror the V2 wire format (snake_case → camelCase)
// so the adapter mapper is a straight rename and every consumer reads
// the same names the upstream sends. `tournamentPhases` is only
// populated by the detail endpoints; list responses carry it empty.

export interface Event {
  readonly id: number;
  readonly name: string;
  readonly displayStatus: 'upcoming' | 'inProgress' | 'complete';
  readonly eventStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED' | string;
  readonly startDatetime: string;   // ISO with offset (e.g. 2026-07-31T15:00:00+00:00)
  readonly endDatetime: string;
  readonly timezone: string;        // IANA tz, e.g. "Europe/Madrid"
  readonly capacity: number;
  readonly registeredCount: number;
  readonly startingPlayerCount: number;
  readonly store: {
    readonly id: number;
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
}

export interface EventPhaseSummary {
  readonly id: number;
  readonly status: 'UPCOMING' | 'IN_PROGRESS' | 'COMPLETE' | string;
  readonly orderInPhases: number;
  readonly phaseName: string;
  readonly rounds: readonly EventRoundSummary[];
}

export interface EventRoundSummary {
  readonly id: number;
  readonly roundNumber: number;
  readonly status: 'UPCOMING' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | string;
  readonly pairingsStatus: string | null;
  readonly standingsStatus: string | null;
}
