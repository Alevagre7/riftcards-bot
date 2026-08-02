// EventWatch — a user's active event-watch subscription.
//
// All fields are readonly. `lastSeen*` are the snapshot the watcher
// diffs against on each tick. When the snapshot is null the user has
// never been paired (or the watch was just created / reset).

export interface EventWatch {
  readonly telegramId: number;
  /** Unique incarnation of this user's active watch. */
  readonly revision: string;
  readonly eventId: number;
  readonly eventName: string;
  readonly eventUsername: string;
  readonly hasObservedPairing: boolean;
  readonly lastSeenRound: number | null;
  readonly lastSeenTable: number | null;
  readonly lastSeenOpponent: string | null;
  readonly lastSeenResult: 'win' | 'loss' | 'draw' | 'bye' | null;
  readonly createdAt: string;
  /** Last meaningful pairing/result change, not merely a polling attempt. */
  readonly updatedAt: string;
  readonly lastCheckedAt: string | null;
  readonly consecutiveFailures: number;
  readonly consecutiveMissing: number;
}
