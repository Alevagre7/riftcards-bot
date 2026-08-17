import type { EventListing } from '../../core/entities/event-listing.js';

const EVENT_LIST_TTL_MS = 5 * 60 * 1000;
const DIRECT_ORIGIN_TTL_MS = 30 * 60 * 1000;

export interface EventListNavigationContext {
  readonly events: readonly EventListing[];
  readonly daysAhead: number;
}

export interface IEventNavigationContext {
  rememberEventList(
    telegramUserId: number | undefined,
    events: readonly EventListing[],
    daysAhead: number,
  ): void;
  getEventList(telegramUserId: number | undefined): EventListNavigationContext | null;
  openEventDirectly(telegramUserId: number | undefined, eventId: number): void;
  openEventFromList(telegramUserId: number | undefined, eventId: number): void;
  shouldShowBackToList(telegramUserId: number | undefined, eventId: number): boolean;
}

interface ListEntry {
  readonly context: EventListNavigationContext;
  readonly expiresAt: number;
}

class EventNavigationContext implements IEventNavigationContext {
  private readonly listContexts = new Map<number, ListEntry>();
  private readonly directOrigins = new Map<number, Map<number, number>>();

  public constructor(private readonly clock: () => number = Date.now) {}

  public rememberEventList(
    telegramUserId: number | undefined,
    events: readonly EventListing[],
    daysAhead: number,
  ): void {
    if (telegramUserId === undefined) return;

    this.listContexts.set(telegramUserId, {
      context: { events, daysAhead },
      expiresAt: this.clock() + EVENT_LIST_TTL_MS,
    });
  }

  public getEventList(telegramUserId: number | undefined): EventListNavigationContext | null {
    if (telegramUserId === undefined) return null;

    const entry = this.listContexts.get(telegramUserId);
    if (!entry) return null;
    if (this.clock() >= entry.expiresAt) {
      this.listContexts.delete(telegramUserId);
      return null;
    }

    return entry.context;
  }

  public openEventDirectly(telegramUserId: number | undefined, eventId: number): void {
    if (telegramUserId === undefined) return;

    this.listContexts.delete(telegramUserId);

    let userOrigins = this.directOrigins.get(telegramUserId);
    if (!userOrigins) {
      userOrigins = new Map<number, number>();
      this.directOrigins.set(telegramUserId, userOrigins);
    }
    userOrigins.set(eventId, this.clock() + DIRECT_ORIGIN_TTL_MS);
  }

  public openEventFromList(telegramUserId: number | undefined, eventId: number): void {
    if (telegramUserId === undefined) return;

    const userOrigins = this.directOrigins.get(telegramUserId);
    if (!userOrigins) return;

    userOrigins.delete(eventId);
    if (userOrigins.size === 0) {
      this.directOrigins.delete(telegramUserId);
    }
  }

  public shouldShowBackToList(telegramUserId: number | undefined, eventId: number): boolean {
    if (telegramUserId === undefined || this.getEventList(telegramUserId) === null) {
      return false;
    }

    const userOrigins = this.directOrigins.get(telegramUserId);
    if (!userOrigins) return true;

    const expiresAt = userOrigins.get(eventId);
    if (expiresAt === undefined) return true;
    if (this.clock() >= expiresAt) {
      userOrigins.delete(eventId);
      if (userOrigins.size === 0) {
        this.directOrigins.delete(telegramUserId);
      }
      return true;
    }

    return false;
  }
}

export function createEventNavigationContext(clock: () => number = Date.now): IEventNavigationContext {
  return new EventNavigationContext(clock);
}
