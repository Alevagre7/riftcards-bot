// EventRegistration — a player registered to an event.
//
// `name` is the player's current in-game display name. It is useful for
// presentation and for legacy watches, but stable IDs take priority when
// the provider supplies them.

export interface EventRegistration {
  /** Stable registration or player ID from the event provider. */
  readonly id: number | string;
  readonly name: string;
  readonly status: 'Active' | 'Dropped' | string;
  readonly profileImageUrl: string | null;
  readonly matchesWon: number;
  readonly matchesLost: number;
  readonly matchesDrawn: number;
  readonly isGuest: boolean;
  readonly finalPlaceInStandings: number | null;
}
