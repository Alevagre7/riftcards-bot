// setup-flow: small in-memory state for the /events set subcommand.
//
// The /events set flow asks the user to send a Telegram location pin
// and stores it on the next message of that kind from the same user.
// The state is intentionally lightweight: a `Map<telegramId,
// expiry>` with a 5-minute TTL. It is NOT persistent: a bot
// restart abandons any in-flight setup, and the user can just retry
// the command. Persistence is a future concern if it becomes
// painful; the SQLite store already exists for the user location
// itself (see IUserSettingsRepository and ADR-0006).

const TTL_MS = 5 * 60 * 1000;

type FlowKind = 'events-set-location';

interface FlowEntry {
  readonly kind: FlowKind;
  readonly expiresAt: number;
}

class SetupFlow {
  private readonly pending = new Map<number, FlowEntry>();

  start(telegramId: number, kind: FlowKind, ttlMs: number = TTL_MS): void {
    this.pending.set(telegramId, { kind, expiresAt: Date.now() + ttlMs });
  }

  // consume returns the flow kind if `telegramId` has a live
  // pending flow, and clears it (one-shot). Returns null if there
  // is no flow, or the flow has expired.
  consume(telegramId: number): FlowKind | null {
    const entry = this.pending.get(telegramId);
    if (!entry) return null;
    this.pending.delete(telegramId);
    if (Date.now() > entry.expiresAt) return null;
    return entry.kind;
  }

  // cancel removes any pending flow for a user (e.g. on /events clear).
  cancel(telegramId: number): void {
    this.pending.delete(telegramId);
  }
}

// Single shared instance, injected into the /events command and
// the location-pickup handler. Two consumers is small enough that
// the singleton is fine; we can move to per-handler instances if
// tests need isolation.
export const setupFlow = new SetupFlow();
