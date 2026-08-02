// EventWatcher — background service that polls the V2 API for every
// active event watch and notifies users on pairing changes.
//
// Factory pattern (matches the bot commands). Exports a single factory
// that returns { start, stop, tick }.
//
// Batching: watches are grouped by eventId. One getEventDetail call per
// event per tick regardless of how many watches are on that event.

import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { EventDetail, EventPairing } from '../../core/entities/event-detail.js';
import { ApiResponseError, ApiTimeoutError } from '../../core/errors/index.js';
import { detectPairingChange, pairingToResult, ChangeReason } from './event-watcher-diff.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventWatcherDeps {
  watchRepository: IEventWatchRepository;
  eventRepository: IEventRepository;
  // The location used for getEventDetail fetches (same global default
  // the /events command uses).
  defaultLocation: EventLocation;
  notify: (telegramId: number, body: string) => Promise<void>;
  intervalMs: number;
  logger?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface EventWatcher {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determine the opponent from a pairing given the watched username. */
function getOpponent(pairing: { player1: string; player2: string }, username: string): string {
  const opponent = pairing.player1 === username ? pairing.player2 : pairing.player1;
  return opponent || 'Bye';
}

/** Build a human-readable notification body from the diff reasons. */
function buildNotifyBody(
  reasons: readonly ChangeReason[],
  pairing: EventPairing,
  round: number | null,
  username: string,
): string {
  const opponent = getOpponent(pairing, username);
  const lines: string[] = [];
  const hasRoundChange = reasons.some(
    (reason) => reason === 'new-round' || reason === 'round-changed',
  );
  const hasPairingChange = reasons.some(
    (reason) => reason === 'opponent-changed' || reason === 'table-changed',
  );
  const hasResultChange = reasons.some(
    (reason) => reason === 'result-submitted' || reason === 'result-changed',
  );

  if (hasRoundChange) {
    lines.push(
      `\uD83C\uDD95 Round ${round} \u2014 Table ${pairing.tableNumber}: You vs ${opponent}`,
    );
  } else if (hasPairingChange) {
    lines.push(
      `\uD83D\uDD04 Round ${round} pairing changed \u2014 Table ${pairing.tableNumber}: You vs ${opponent}`,
    );
  }
  if (hasResultChange) {
    lines.push(
      `\uD83D\uDCDD Round ${round} result: ${formatResult(pairing, username)} vs ${opponent}`,
    );
  }

  return lines.join('\n');
}

function formatResult(pairing: EventPairing, username: string): string {
  switch (pairingToResult(pairing, username)) {
    case 'win':
      return 'Win';
    case 'loss':
      return 'Loss';
    case 'draw':
      return 'Draw';
    case 'bye':
      return 'Bye';
    default:
      return 'not reported';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEventWatcher(deps: EventWatcherDeps): EventWatcher {
  const log = deps.logger ?? console.error;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  async function runTick(): Promise<void> {
    const watches = await deps.watchRepository.list();
    if (watches.length === 0) return;

    log(`[event-watcher] tick — ${watches.length} watch(es)`);

    // Group watches by eventId for batching
    const byEvent = new Map<number, typeof watches>();
    for (const watch of watches) {
      const existing = byEvent.get(watch.eventId);
      if (existing) {
        existing.push(watch);
      } else {
        byEvent.set(watch.eventId, [watch]);
      }
    }

    // Process each event independently (parallel)
    const results = await Promise.allSettled(
      [...byEvent.entries()].map(async ([eventId, eventWatches]) => {
        log(`[event-watcher] fetching event ${eventId} (${eventWatches.length} watches)`);

        let data: EventDetail | null;
        try {
          // Bypass the adapter cache: a round transition the upstream
          // just published must reach the watcher on this tick rather
          // than after up to CACHE_TTL_MS.
          data = await deps.eventRepository.getEventDetail(
            eventId,
            deps.defaultLocation,
            { fresh: true },
          );
        } catch (error: unknown) {
          if (error instanceof ApiTimeoutError ||
              (error instanceof ApiResponseError && /5\d{2}/.test(error.message))) {
            log(`[event-watcher] transient error for event ${eventId}, will retry`, {
              error: (error as Error).message,
            });
            return;
          }
          throw error;
        }

        if (data === null) {
          // Event not found — delete all watches on this event
          log(`[event-watcher] event ${eventId} not found (404) — deleting ${eventWatches.length} watch(es)`);
          for (const watch of eventWatches) {
            await deps.watchRepository.delete(watch.telegramId);
          }
          return;
        }

        for (const watch of eventWatches) {
          try {
            await processWatch(watch, data);
          } catch (error: unknown) {
            log(`[event-watcher] error processing watch ${watch.telegramId}`, {
              error: String(error),
            });
          }
        }
      }),
    );

    // Log any unexpected rejections
    for (const result of results) {
      if (result.status === 'rejected') {
        log(`[event-watcher] event processing rejected`, {
          error: String(result.reason),
        });
      }
    }

    log(`[event-watcher] tick done`);
  }
  function tick(): Promise<void> {
    if (inFlight !== null) return inFlight;
    inFlight = runTick().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function processWatch(
    watch: Awaited<ReturnType<typeof deps.watchRepository.list>>[number],
    data: EventDetail,
  ): Promise<void> {
    if (!data) return;

    const currentRoundNumber = data.currentRound == null ? null : data.currentRound.roundNumber;

    // Find the pairing containing the watched username
    // Round ended check MUST happen before pairing lookup: when a round
    // finishes, currentRound becomes null and pairings are empty.
    if (watch.lastSeenRound !== null && currentRoundNumber === null) {
      log(`[event-watcher] round ended for event ${data.event.id} — clearing snapshot`, {
        telegramId: watch.telegramId,
      });
      await deps.watchRepository.updateLastSeen(watch.telegramId, {
        round: null,
        table: null,
        opponent: null,
        result: null,
      });
      return;
    }

    const pairing = data.pairings.find(
      (p) => p.player1 === watch.eventUsername || p.player2 === watch.eventUsername,
    );

    if (!pairing) {
      // User not in pairings (bye or not assigned yet)
      log(`[event-watcher] user ${watch.eventUsername} not in pairings yet`, {
        telegramId: watch.telegramId,
      });
      return;
    }

    const diff = detectPairingChange(watch, pairing, currentRoundNumber, watch.eventUsername);

    if (diff.changed) {
      const body = buildNotifyBody(diff.reasons, pairing, currentRoundNumber, watch.eventUsername);
      try {
        await deps.notify(watch.telegramId, body);
      } catch (notifyError: unknown) {
        const err = notifyError as Record<string, unknown>;
        const response = err.response as Record<string, unknown> | undefined;
        if (response?.error_code === 403) {
          log(`[event-watcher] user ${watch.telegramId} blocked bot — deleting watch`);
          await deps.watchRepository.delete(watch.telegramId);
          return;
        }
        throw notifyError;
      }

      // Notify succeeded — update snapshot
      const opponent = getOpponent(pairing, watch.eventUsername);
      const resultType = pairingToResult(pairing, watch.eventUsername);

      await deps.watchRepository.updateLastSeen(watch.telegramId, {
        round: currentRoundNumber,
        table: pairing.tableNumber,
        opponent,
        result: resultType,
      });
    }
  }

  return {
    start(): void {
      if (timer !== null) return;
      timer = setInterval(() => {
        tick().catch((err) =>
          log('[event-watcher] tick threw unexpectedly', { error: String(err) }),
        );
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
