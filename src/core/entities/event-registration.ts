// EventRegistration — a player registered to an event, as served by
// the Riftbound V2 API's /events/{id}/registrations/ endpoint.
//
// `name` is the upstream `best_identifier` (the in-game display name,
// e.g. "TheNightman") — the same string the pairings mapper uses for
// player1/player2, so a watch's eventUsername matches pairings by
// construction.

export interface EventRegistration {
  readonly id: number;
  readonly name: string;             // best_identifier
  readonly status: 'Active' | 'Dropped' | string;  // 'COMPLETE' → Active; anything else → Dropped
  readonly profileImageUrl: string | null;
  readonly matchesWon: number;
  readonly matchesLost: number;
  readonly matchesDrawn: number;
  readonly isGuest: boolean;
  readonly finalPlaceInStandings: number | null;
}
