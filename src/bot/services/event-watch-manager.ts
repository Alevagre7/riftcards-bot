import { EventDetail } from '../../core/entities/event-detail.js';
import { EventWatch } from '../../core/entities/event-watch.js';
import {
  EventWatchDraft,
  IEventWatchRepository,
} from '../../core/ports/event-watch-repository.js';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { pairingToResult } from './event-watcher-diff.js';

export interface WatchTarget {
  readonly eventId: number;
  readonly eventName: string;
  readonly eventUsername: string;
}

export type WatchStatusKind = 'waiting' | 'paired' | 'degraded' | 'missing';

export interface WatchLiveState {
  readonly round: number | null;
  readonly table: number | null;
  readonly opponent: string | null;
  readonly result: 'win' | 'loss' | 'draw' | 'bye' | null;
}

export interface WatchStatus {
  readonly watch: EventWatch;
  readonly kind: WatchStatusKind;
  readonly live: WatchLiveState | null;
  readonly refreshed: boolean;
  readonly refreshError: boolean;
}

export type WatchSubscriptionResult =
  | { readonly kind: 'subscribed'; readonly watch: EventWatch; readonly replaced: boolean }
  | { readonly kind: 'already-watching'; readonly watch: EventWatch }
  | { readonly kind: 'needs-confirmation'; readonly current: EventWatch }
  | { readonly kind: 'stale' };

export type WatchStopResult =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'no-active-watch' }
  | { readonly kind: 'stale' };

export interface EventWatchManagerDeps {
  readonly watchRepository: IEventWatchRepository;
  readonly eventRepository: IEventRepository;
  readonly defaultLocation: EventLocation;
  readonly onWatchChanged?: () => void;
}

export interface IEventWatchManager {
  getStatus(userId: number): Promise<WatchStatus | null>;
  refreshStatus(userId: number): Promise<WatchStatus | null>;
  requestSubscription(userId: number, target: WatchTarget): Promise<WatchSubscriptionResult>;
  replaceSubscription(
    userId: number,
    target: WatchTarget,
    expectedRevision: string,
  ): Promise<WatchSubscriptionResult>;
  stop(userId: number, expectedRevision?: string): Promise<WatchStopResult>;
  list(): Promise<EventWatch[]>;
}

function statusKind(watch: EventWatch): WatchStatusKind {
  if (watch.consecutiveFailures >= 3) return 'degraded';
  if (watch.consecutiveMissing > 0) return 'missing';
  if (watch.lastSeenRound === null) return 'waiting';
  return 'paired';
}

function refreshedStatusKind(watch: EventWatch, live: WatchLiveState): WatchStatusKind {
  const storedKind = statusKind(watch);
  if (storedKind === 'degraded' || storedKind === 'missing') return storedKind;
  return live.opponent !== null ? 'paired' : 'waiting';
}

function storedLiveState(watch: EventWatch): WatchLiveState {
  return {
    round: watch.lastSeenRound,
    table: watch.lastSeenTable,
    opponent: watch.lastSeenOpponent,
    result: watch.lastSeenResult,
  };
}

function liveStateFromDetail(data: EventDetail, username: string): WatchLiveState {
  const pairing = data.pairings.find(
    (candidate) => candidate.player1 === username || candidate.player2 === username,
  );
  const round = data.currentRound?.roundNumber ?? null;
  if (!pairing) {
    return { round, table: null, opponent: null, result: null };
  }
  const opponent = pairing.player1 === username ? pairing.player2 : pairing.player1;
  return {
    round,
    table: pairing.tableNumber,
    opponent: opponent || 'Bye',
    result: pairingToResult(pairing, username),
  };
}

function baseStatus(watch: EventWatch): WatchStatus {
  return {
    watch,
    kind: statusKind(watch),
    live: null,
    refreshed: false,
    refreshError: false,
  };
}

function draftFor(userId: number, target: WatchTarget): EventWatchDraft {
  return {
    telegramId: userId,
    eventId: target.eventId,
    eventName: target.eventName,
    eventUsername: target.eventUsername,
    createdAt: new Date().toISOString(),
  };
}

export function createEventWatchManager(deps: EventWatchManagerDeps): IEventWatchManager {
  const wakeWatcher = (): void => {
    deps.onWatchChanged?.();
  };

  return {
    async getStatus(userId): Promise<WatchStatus | null> {
      const watch = await deps.watchRepository.get(userId);
      return watch ? baseStatus(watch) : null;
    },

    async refreshStatus(userId): Promise<WatchStatus | null> {
      const watch = await deps.watchRepository.get(userId);
      if (!watch) return null;

      const status = baseStatus(watch);
      try {
        const detail = await deps.eventRepository.getEventDetail(
          watch.eventId,
          deps.defaultLocation,
          { fresh: true },
        );
        if (!detail) {
          return { ...status, kind: 'missing', refreshed: true, refreshError: true };
        }
        const live = liveStateFromDetail(detail, watch.eventUsername);
        return {
          ...status,
          kind: refreshedStatusKind(watch, live),
          live,
          refreshed: true,
        };
      } catch {
        return { ...status, refreshed: true, refreshError: true };
      }
    },

    async requestSubscription(userId, target): Promise<WatchSubscriptionResult> {
      const current = await deps.watchRepository.get(userId);
      if (current) {
        if (
          current.eventId === target.eventId &&
          current.eventUsername === target.eventUsername
        ) {
          return { kind: 'already-watching', watch: current };
        }
        return { kind: 'needs-confirmation', current };
      }

      const created = await deps.watchRepository.create(draftFor(userId, target));
      if (!created) {
        const raced = await deps.watchRepository.get(userId);
        if (!raced) return { kind: 'stale' };
        if (raced.eventId === target.eventId && raced.eventUsername === target.eventUsername) {
          return { kind: 'already-watching', watch: raced };
        }
        return { kind: 'needs-confirmation', current: raced };
      }
      wakeWatcher();
      return { kind: 'subscribed', watch: created, replaced: false };
    },

    async replaceSubscription(userId, target, expectedRevision): Promise<WatchSubscriptionResult> {
      const replaced = await deps.watchRepository.replace(
        draftFor(userId, target),
        expectedRevision,
      );
      if (!replaced) return { kind: 'stale' };
      wakeWatcher();
      return { kind: 'subscribed', watch: replaced, replaced: true };
    },

    async stop(userId, expectedRevision): Promise<WatchStopResult> {
      const current = await deps.watchRepository.get(userId);
      if (!current) return { kind: 'no-active-watch' };
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        return { kind: 'stale' };
      }
      const deleted = await deps.watchRepository.deleteIfCurrent(userId, current.revision);
      return deleted ? { kind: 'stopped' } : { kind: 'stale' };
    },

    list(): Promise<EventWatch[]> {
      return deps.watchRepository.list();
    },
  };
}

export function statusLiveState(status: WatchStatus): WatchLiveState {
  return status.live ?? storedLiveState(status.watch);
}
