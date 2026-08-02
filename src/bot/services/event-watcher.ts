// EventWatcher — background service that polls the V2 API for every active
// event watch and notifies users on pairing changes.
//
// Watches are grouped by eventId, so one fresh detail request serves every
// user watching the same event. Repository observations are revision-guarded:
// an in-flight poll cannot update or meaningfully notify a newer watch.

import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { EventDetail, EventPairing } from '../../core/entities/event-detail.js';
import { ApiResponseError, ApiTimeoutError } from '../../core/errors/index.js';
import { detectPairingChange, pairingToResult, ChangeReason } from './event-watcher-diff.js';

const MAX_MISSING_POLLS = 3;

export interface WatchNotification {
  readonly body: string;
  readonly eventId: number;
  readonly revision: string;
  readonly canStop: boolean;
}

export interface EventWatcherDeps {
  watchRepository: IEventWatchRepository;
  eventRepository: IEventRepository;
  // The location used for getEventDetail fetches (same global default
  // the /events command uses).
  defaultLocation: EventLocation;
  notify: (telegramId: number, notification: WatchNotification) => Promise<void>;
  intervalMs: number;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface EventWatcher {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

function getOpponent(pairing: { player1: string; player2: string }, username: string): string {
  const opponent = pairing.player1 === username ? pairing.player2 : pairing.player1;
  return opponent || 'Bye';
}

function formatResult(pairing: EventPairing, username: string): string {
  switch (pairingToResult(pairing, username)) {
    case 'win': return 'Win';
    case 'loss': return 'Loss';
    case 'draw': return 'Draw';
    case 'bye': return 'Bye';
    default: return 'not reported';
  }
}

function buildNotifyBody(
  eventName: string,
  username: string,
  reasons: readonly ChangeReason[],
  pairing: EventPairing,
  round: number | null,
): string {
  const opponent = getOpponent(pairing, username);
  const lines = [`📡 ${eventName} — ${username}`];
  const hasRoundChange = reasons.some(
    (reason) => reason === 'first-pairing' || reason === 'new-round' || reason === 'round-changed',
  );
  const hasPairingChange = reasons.some(
    (reason) => reason === 'opponent-changed' || reason === 'table-changed',
  );
  const hasResultChange = reasons.some(
    (reason) => reason === 'result-submitted' || reason === 'result-changed',
  );

  if (hasRoundChange) {
    const prefix = reasons.includes('first-pairing') ? '📡 Pairing found' : '🆕 Round';
    lines.push(
      prefix === '📡 Pairing found'
        ? `${prefix} — Round ${round} — Table ${pairing.tableNumber}: You vs ${opponent}`
        : `${prefix} ${round} — Table ${pairing.tableNumber}: You vs ${opponent}`,
    );
  } else if (hasPairingChange) {
    lines.push(
      `🔄 Round ${round} pairing changed — Table ${pairing.tableNumber}: You vs ${opponent}`,
    );
  }
  if (hasResultChange) {
    lines.push(
      `📝 Round ${round} result: ${formatResult(pairing, username)} vs ${opponent}`,
    );
  }

  return lines.join('\n');
}

function buildEndedBody(
  eventName: string,
  username: string,
  reason: 'complete' | 'cancelled' | 'dropped' | 'unavailable',
): string {
  const suffix = {
    complete: 'the event is complete',
    cancelled: 'the event was cancelled',
    dropped: 'the player is no longer active in the event',
    unavailable: 'the event could not be found',
  }[reason];
  return `🛑 Watching ${username} at ${eventName} ended — ${suffix}.`;
}

function isTransient(error: unknown): boolean {
  return error instanceof ApiTimeoutError ||
    (error instanceof ApiResponseError && /5\d{2}/.test(error.message));
}

function isBlocked(error: unknown): boolean {
  const err = error as Record<string, unknown>;
  const response = err.response as Record<string, unknown> | undefined;
  return response?.error_code === 403;
}

export function createEventWatcher(deps: EventWatcherDeps): EventWatcher {
  const log = deps.logger ?? console.error;
  const now = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  async function notifyAndDelete(
    watch: Awaited<ReturnType<typeof deps.watchRepository.list>>[number],
    body: string,
  ): Promise<void> {
    const current = await deps.watchRepository.get(watch.telegramId);
    if (!current || current.revision !== watch.revision) return;

    try {
      await deps.notify(watch.telegramId, {
        body,
        eventId: watch.eventId,
        revision: watch.revision,
        canStop: false,
      });
    } catch (error: unknown) {
      if (isBlocked(error)) {
        await deps.watchRepository.deleteIfCurrent(watch.telegramId, watch.revision);
        return;
      }
      throw error;
    }
    await deps.watchRepository.deleteIfCurrent(watch.telegramId, watch.revision);
  }

  async function runTick(): Promise<void> {
    const watches = await deps.watchRepository.list();
    if (watches.length === 0) return;

    log(`[event-watcher] tick — ${watches.length} watch(es)`);

    const byEvent = new Map<number, typeof watches>();
    for (const watch of watches) {
      const existing = byEvent.get(watch.eventId);
      if (existing) existing.push(watch);
      else byEvent.set(watch.eventId, [watch]);
    }

    const results = await Promise.allSettled(
      [...byEvent.entries()].map(async ([eventId, eventWatches]) => {
        log(`[event-watcher] fetching event ${eventId} (${eventWatches.length} watches)`);

        let data: EventDetail | null;
        try {
          data = await deps.eventRepository.getEventDetail(
            eventId,
            deps.defaultLocation,
            { fresh: true },
          );
        } catch (error: unknown) {
          if (isTransient(error)) {
            log(`[event-watcher] transient error for event ${eventId}, will retry`, {
              error: (error as Error).message,
            });
            const checkedAt = now().toISOString();
            for (const watch of eventWatches) {
              await deps.watchRepository.recordObservation(watch.telegramId, watch.revision, {
                kind: 'transient-failure',
                checkedAt,
              });
            }
            return;
          }
          throw error;
        }

        if (data === null) {
          const checkedAt = now().toISOString();
          for (const watch of eventWatches) {
            await deps.watchRepository.recordObservation(watch.telegramId, watch.revision, {
              kind: 'not-found',
              checkedAt,
            });
            if (watch.consecutiveMissing + 1 >= MAX_MISSING_POLLS) {
              try {
                await notifyAndDelete(
                  watch,
                  buildEndedBody(watch.eventName, watch.eventUsername, 'unavailable'),
                );
              } catch (error: unknown) {
                log(`[event-watcher] error ending unavailable watch ${watch.telegramId}`, {
                  error: String(error),
                });
              }
            }
          }
          return;
        }

        for (const watch of eventWatches) {
          try {
            if (data.event.displayStatus === 'complete') {
              await notifyAndDelete(
                watch,
                buildEndedBody(watch.eventName, watch.eventUsername, 'complete'),
              );
              continue;
            }
            if (data.event.eventStatus === 'CANCELLED') {
              await notifyAndDelete(
                watch,
                buildEndedBody(watch.eventName, watch.eventUsername, 'cancelled'),
              );
              continue;
            }

            const registration = data.registrations.find(
              (entry) => entry.name === watch.eventUsername,
            );
            if (registration && registration.status !== 'Active') {
              await notifyAndDelete(
                watch,
                buildEndedBody(watch.eventName, watch.eventUsername, 'dropped'),
              );
              continue;
            }

            await processWatch(watch, data);
          } catch (error: unknown) {
            log(`[event-watcher] error processing watch ${watch.telegramId}`, {
              error: String(error),
            });
          }
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        log('[event-watcher] event processing rejected', { error: String(result.reason) });
      }
    }

    log('[event-watcher] tick done');
  }

  async function processWatch(
    watch: Awaited<ReturnType<typeof deps.watchRepository.list>>[number],
    data: EventDetail,
  ): Promise<void> {
    const checkedAt = now().toISOString();
    const currentRoundNumber = data.currentRound?.roundNumber ?? null;

    // Preserve hasObservedPairing while clearing only the current pairing
    // during the gap between rounds.
    if (watch.lastSeenRound !== null && currentRoundNumber === null) {
      await deps.watchRepository.recordObservation(watch.telegramId, watch.revision, {
        kind: 'success',
        checkedAt,
        clearSnapshot: true,
        changed: true,
      });
      return;
    }

    const pairing = data.pairings.find(
      (candidate) => candidate.player1 === watch.eventUsername || candidate.player2 === watch.eventUsername,
    );

    if (!pairing) {
      await deps.watchRepository.recordObservation(watch.telegramId, watch.revision, {
        kind: 'success',
        checkedAt,
        changed: false,
      });
      return;
    }

    const diff = detectPairingChange(
      watch,
      pairing,
      currentRoundNumber,
      watch.eventUsername,
    );

    if (diff.changed) {
      const current = await deps.watchRepository.get(watch.telegramId);
      if (!current || current.revision !== watch.revision) return;
      try {
        await deps.notify(watch.telegramId, {
          body: buildNotifyBody(
            watch.eventName,
            watch.eventUsername,
            diff.reasons,
            pairing,
            currentRoundNumber,
          ),
          eventId: watch.eventId,
          revision: watch.revision,
          canStop: true,
        });
      } catch (notifyError: unknown) {
        if (isBlocked(notifyError)) {
          await deps.watchRepository.deleteIfCurrent(watch.telegramId, watch.revision);
          return;
        }
        throw notifyError;
      }

      const opponent = getOpponent(pairing, watch.eventUsername);
      await deps.watchRepository.recordObservation(watch.telegramId, watch.revision, {
        kind: 'success',
        checkedAt,
        changed: true,
        snapshot: {
          round: currentRoundNumber,
          table: pairing.tableNumber,
          opponent,
          result: pairingToResult(pairing, watch.eventUsername),
        },
      });
      return;
    }

    await deps.watchRepository.recordObservation(watch.telegramId, watch.revision, {
      kind: 'success',
      checkedAt,
      changed: false,
    });
  }

  function tick(): Promise<void> {
    if (inFlight !== null) return inFlight;
    inFlight = runTick().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    start(): void {
      if (timer !== null) return;
      tick().catch((error) => log('[event-watcher] startup tick failed', { error: String(error) }));
      timer = setInterval(() => {
        tick().catch((error) => log('[event-watcher] tick threw unexpectedly', { error: String(error) }));
      }, deps.intervalMs);
    },

    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },

    tick,
  };
}
