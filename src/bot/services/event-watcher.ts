// EventWatcher — background service that polls the locator for every
// active event watch and notifies users on pairing changes.
//
// Factory pattern (matches the bot commands). Exports a single factory
// that returns { start, stop, tick }.
//
// Batching: watches are grouped by eventId. One locator call per event
// per tick regardless of how many watches are on that event.

import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { ILocatorRepository } from '../../core/ports/locator-repository.js';
import { ApiResponseError, ApiTimeoutError } from '../../core/errors/index.js';
import { detectPairingChange, ChangeReason } from './event-watcher-diff.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventWatcherDeps {
  watchRepository: IEventWatchRepository;
  locatorRepository: ILocatorRepository;
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

const REASON_LABELS: Record<ChangeReason, string> = {
  'new-round': 'new-round',
  'round-changed': 'round-changed',
  'opponent-changed': 'opponent-changed',
  'table-changed': 'table-changed',
  'result-submitted': 'result-submitted',
  'result-changed': 'result-changed',
};

/** Determine the opponent from a pairing given the watched username. */
function getOpponent(pairing: { player1: string; player2: string }, username: string): string {
  return pairing.player1 === username ? pairing.player2 : pairing.player1;
}

/** Build a human-readable notification body from the diff reasons. */
function buildNotifyBody(
  reasons: readonly ChangeReason[],
  pairing: { tableNumber: number; player1: string; player2: string; score1: number | null; score2: number | null },
  round: number | null,
  username: string,
): string {
  const opponent = getOpponent(pairing, username);
  const lines: string[] = [];

  for (const reason of reasons) {
    switch (reason) {
      case 'new-round':
      case 'round-changed':
        lines.push(
          `\uD83C\uDD95 Round ${round} — Table ${pairing.tableNumber}: You vs ${opponent}`,
        );
        break;
      case 'opponent-changed':
      case 'table-changed':
        lines.push(
          `\uD83D\uDD04 Round ${round} pairing changed — Table ${pairing.tableNumber}: You vs ${opponent}`,
        );
        break;
      case 'result-submitted':
      case 'result-changed': {
        const resultLabel = formatResult(pairing, username);
        lines.push(
          `\uD83D\uDCDD Round ${round} result: ${resultLabel} vs ${opponent}`,
        );
        break;
      }
    }
  }

  return lines.join('\n');
}

function formatResult(
  pairing: { player1: string; player2: string; score1: number | null; score2: number | null },
  username: string,
): string {
  if (pairing.score1 === null || pairing.score2 === null) return 'not reported';

  const isPlayer1 = pairing.player1 === username;

  // Determine result from the user's perspective
  if ((isPlayer1 && pairing.score1 > pairing.score2) ||
      (!isPlayer1 && pairing.score2 > pairing.score1)) {
    return 'Win';
  }
  if (pairing.score1 === pairing.score2) return 'Draw';
  return 'Loss';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEventWatcher(deps: EventWatcherDeps): EventWatcher {
  const log = deps.logger ?? console.error;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
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

        let data: Awaited<ReturnType<typeof deps.locatorRepository.getEventData>>;
        try {
          data = await deps.locatorRepository.getEventData(eventId);
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

  async function processWatch(
    watch: Awaited<ReturnType<typeof deps.watchRepository.list>>[number],
    data: Awaited<ReturnType<typeof deps.locatorRepository.getEventData>>,
  ): Promise<void> {
    if (!data) return;

    // Find the pairing containing the watched username
    // Round ended check MUST happen before pairing lookup: when a round
    // finishes, currentRound becomes null and pairings are empty.
    if (watch.lastSeenRound !== null && data.currentRound === null) {
      log(`[event-watcher] round ended for event ${data.eventId} — clearing snapshot`, {
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

    const diff = detectPairingChange(watch, pairing, data.currentRound);

    if (diff.changed) {
      const body = buildNotifyBody(diff.reasons, pairing, data.currentRound, watch.eventUsername);
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
      const resultType = (pairing.score1 !== null && pairing.score2 !== null)
        ? formatResult(pairing, watch.eventUsername).toLowerCase() as 'win' | 'loss' | 'draw'
        : null;

      await deps.watchRepository.updateLastSeen(watch.telegramId, {
        round: data.currentRound,
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
