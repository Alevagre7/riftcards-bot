// event-detail-origin: remembers whether a specific event's detail was
// opened directly via /events <id> or a locator URL, keyed by
// (telegramId, eventId).
//
// The detail page's "Back to list" button is driven by this flag in
// combination with eventsPaginationState: the button shows only when
// the user has a live list context AND the event was not opened
// directly. Because the flag is per-event, a direct-fetched event
// keeps hiding the button across leaderboard/rounds → back-to-event
// round trips even if a stale "Back to list" tap re-arms the
// pagination state, while any OTHER event opened from a list still
// shows it. The mark expires after TTL_MS.
//
// In-memory, TTL-based, non-persistent — same shape as
// events-pagination-state.ts.

const TTL_MS = 30 * 60 * 1000;

function key(telegramId: number, eventId: number): string {
  return `${telegramId}:${eventId}`;
}

class EventDetailOrigin {
  private readonly direct = new Map<string, number>();

  markDirect(telegramId: number, eventId: number): void {
    this.direct.set(key(telegramId, eventId), Date.now() + TTL_MS);
  }

  isDirect(telegramId: number, eventId: number): boolean {
    const expiresAt = this.direct.get(key(telegramId, eventId));
    if (expiresAt == null) return false;
    if (Date.now() >= expiresAt) {
      this.direct.delete(key(telegramId, eventId));
      return false;
    }
    return true;
  }

  clear(telegramId: number, eventId: number): void {
    this.direct.delete(key(telegramId, eventId));
  }

  /** Remove all marks for a user — used by test cleanup. */
  clearUser(telegramId: number): void {
    for (const k of this.direct.keys()) {
      if (k.startsWith(`${telegramId}:`)) {
        this.direct.delete(k);
      }
    }
  }
}

export const eventDetailOrigin = new EventDetailOrigin();
