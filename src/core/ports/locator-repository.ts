// ILocatorRepository — port for fetching live event data from the
// Riftbound Locator (SSR HTML page). The implementation parses the
// locator page's DOM to extract roster, pairings, and current round.
//
// This is a separate port from IEventRepository because the locator
// is a different data source (HTML page vs JSON API) and has a
// different lifecycle (many reads per watch tick).

export interface LocatorRosterEntry {
  readonly displayName: string;
  readonly status: string;
  readonly profileImageUrl: string | null;
}

export interface LocatorPairing {
  readonly tableNumber: number;
  readonly player1: string;
  readonly player2: string;
  readonly score1: number | null;
  readonly score2: number | null;
}

export interface LocatorEventData {
  readonly eventId: number;
  readonly name: string;
  readonly currentRound: number | null;
  readonly roster: readonly LocatorRosterEntry[];
  readonly pairings: readonly LocatorPairing[];
  readonly fetchedAt: string;
}

export interface ILocatorRepository {
  /** Fetch live event data from the locator page.
   *  Returns null if the event doesn't exist (404).
   *  Throws ApiResponseError / ApiTimeoutError on transient failures. */
  getEventData(eventId: number): Promise<LocatorEventData | null>;
}
