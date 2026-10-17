import { describe, expect, it, vi } from 'vitest';
import { createEventWatchManager } from './event-watch-manager.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import type { EventWatch } from '../../core/entities/event-watch.js';

function watch(overrides: Partial<EventWatch> = {}): EventWatch {
  const now = new Date().toISOString();
  return {
    telegramId: 7,
    revision: 'revision-1',
    eventId: 42,
    eventName: 'Test Event',
    eventUsername: 'Alice',
    hasObservedPairing: false,
    lastSeenRound: null,
    lastSeenTable: null,
    lastSeenOpponent: null,
    lastSeenResult: null,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: null,
    consecutiveFailures: 0,
    consecutiveMissing: 0,
    ...overrides,
  };
}

function repositories(): {
  watchRepository: IEventWatchRepository;
  eventRepository: IEventRepository;
} {
  return {
    watchRepository: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      replace: vi.fn(),
      delete: vi.fn(),
      deleteIfCurrent: vi.fn().mockResolvedValue(true),
      recordObservation: vi.fn(),
    },
    eventRepository: {
      getEventById: vi.fn(),
      getEventRegistrations: vi.fn(),
      getEventMatches: vi.fn(),
      getEventStandings: vi.fn(),
      getEventDetail: vi.fn(),
    },
  };
}

describe('createEventWatchManager', () => {
  it('creates a watch and wakes the poller', async () => {
    const deps = repositories();
    const created = watch();
    deps.watchRepository.create = vi.fn().mockResolvedValue(created);
    const wake = vi.fn();
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
      onWatchChanged: wake,
    });

    const result = await manager.requestSubscription(7, {
      eventId: 42,
      eventName: 'Test Event',
      eventUsername: 'Alice',
    });

    expect(result).toEqual({ kind: 'subscribed', watch: created, replaced: false });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('does not reset an identical watch and requests confirmation for another target', async () => {
    const deps = repositories();
    const current = watch();
    deps.watchRepository.get = vi.fn().mockResolvedValue(current);
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    });

    await expect(manager.requestSubscription(7, {
      eventId: 42,
      eventName: 'Test Event',
      eventUsername: 'Alice',
    })).resolves.toEqual({ kind: 'already-watching', watch: current });
    await expect(manager.requestSubscription(7, {
      eventId: 99,
      eventName: 'Other Event',
      eventUsername: 'Bob',
    })).resolves.toEqual({ kind: 'needs-confirmation', current });
  });

  it('rejects 2v2 events with a clear watchability reason', async () => {
    const deps = repositories();
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    });

    await expect(manager.requestSubscription(7, {
      eventId: 42,
      eventName: 'Doubles Event',
      eventUsername: 'Alice',
      supportsTracking: false,
    })).resolves.toEqual({
      kind: 'unsupported',
      reason: 'Player watches support 1v1 events only.',
    });
    expect(deps.watchRepository.create).not.toHaveBeenCalled();
  });

  it('persists the selected registration identity with a new watch', async () => {
    const deps = repositories();
    deps.watchRepository.create = vi.fn().mockImplementation(async (draft) => watch(draft));
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    });

    await manager.requestSubscription(7, {
      eventId: 42,
      eventName: 'Test Event',
      eventUsername: 'Alice',
      registrationId: 'player-uuid',
    });

    expect(deps.watchRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      registrationId: 'player-uuid',
    }));
  });

  it('protects replacement and stop with the current revision', async () => {
    const deps = repositories();
    const current = watch();
    const replaced = watch({ revision: 'revision-2', eventId: 99, eventUsername: 'Bob' });
    deps.watchRepository.replace = vi.fn().mockResolvedValue(replaced);
    deps.watchRepository.get = vi.fn().mockResolvedValue(current);
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    });

    const replacement = await manager.replaceSubscription(7, {
      eventId: 99,
      eventName: 'Other Event',
      eventUsername: 'Bob',
    }, 'revision-1');
    expect(replacement).toEqual({ kind: 'subscribed', watch: replaced, replaced: true });
    expect(deps.watchRepository.replace).toHaveBeenCalledWith(expect.objectContaining({ eventId: 99 }), 'revision-1');

    deps.watchRepository.get = vi.fn().mockResolvedValue(watch({ revision: 'revision-2' }));
    await expect(manager.stop(7, 'revision-1')).resolves.toEqual({ kind: 'stale' });
    await expect(manager.stop(7, 'revision-2')).resolves.toEqual({ kind: 'stopped' });
  });

  it('refreshes live status without mutating the watch snapshot', async () => {
    const deps = repositories();
    const current = watch({ hasObservedPairing: true, lastSeenRound: 1, lastSeenTable: 2, lastSeenOpponent: 'Old' });
    deps.watchRepository.get = vi.fn().mockResolvedValue(current);
    deps.eventRepository.getEventDetail = vi.fn().mockResolvedValue({
      event: { displayStatus: 'inProgress' },
      currentRound: { roundNumber: 2 },
      pairings: [{ player1: 'Alice', player2: 'Bob', tableNumber: 5, outcome: 'pending' }],
    });
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    });

    const result = await manager.refreshStatus(7);

    expect(result?.kind).toBe('paired');
    expect(result?.live).toEqual({ round: 2, table: 5, opponent: 'Bob', result: null });
    expect(deps.eventRepository.getEventDetail).toHaveBeenCalledWith(
      42,
      expect.anything(),
      { fresh: true },
    );
    expect(deps.watchRepository.recordObservation).not.toHaveBeenCalled();
  });

  it('uses registration IDs to resolve duplicate display names in live status', async () => {
    const deps = repositories();
    const current = watch({ registrationId: 'player-2' });
    deps.watchRepository.get = vi.fn().mockResolvedValue(current);
    deps.eventRepository.getEventDetail = vi.fn().mockResolvedValue({
      event: { displayStatus: 'inProgress' },
      currentRound: { id: 'round-2', roundNumber: 2 },
      pairings: [
        { player1: 'Alice', player1Id: 'player-1', player2: 'Bob', tableNumber: 1, outcome: 'pending' },
        { player1: 'Alice', player1Id: 'player-2', player2: 'Charlie', tableNumber: 2, outcome: 'pending' },
      ],
    });
    const manager = createEventWatchManager({
      ...deps,
      defaultLocation: { latitude: 0, longitude: 0, numMiles: 25 },
    });

    const result = await manager.refreshStatus(7);
    expect(result?.live).toEqual({ round: 2, table: 2, opponent: 'Charlie', result: null });
  });
});
