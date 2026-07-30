import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEventWatcher, EventWatcherDeps } from './event-watcher.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { ILocatorRepository, LocatorEventData } from '../../core/ports/locator-repository.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockWatchRepository(): IEventWatchRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    updateLastSeen: vi.fn(),
  };
}

function mockLocatorRepository(): ILocatorRepository {
  return {
    getEventData: vi.fn(),
  };
}

function makeDeps(overrides?: Partial<EventWatcherDeps>): EventWatcherDeps {
  return {
    watchRepository: mockWatchRepository(),
    locatorRepository: mockLocatorRepository(),
    notify: vi.fn(),
    intervalMs: 30000,
    logger: vi.fn(),
    ...overrides,
  };
}

function makeEventData(overrides?: Partial<LocatorEventData>): LocatorEventData {
  return {
    eventId: 735205,
    name: 'Test Event',
    currentRound: 2,
    roster: [],
    standings: [],
    pairings: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createEventWatcher', () => {
  describe('tick', () => {
    it('returns without calling locator when no watches', async () => {
      const deps = makeDeps();
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(deps.locatorRepository.getEventData).not.toHaveBeenCalled();
    });

    it('notifies on new-round and updates snapshot', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 735205,
          eventName: 'Test Event',
          eventUsername: 'Alice',
          lastSeenRound: null,
          lastSeenTable: null,
          lastSeenOpponent: null,
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockResolvedValue(
        makeEventData({
          currentRound: 1,
          pairings: [
            {
              tableNumber: 5,
              player1: 'Alice',
              player2: 'Bob',
              score1: null,
              score2: null,
            },
          ],
        }),
      );

      const notify = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        watchRepository: watchRepo,
        locatorRepository: locatorRepo,
        notify,
      });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![0]).toBe(1);
      expect(notify.mock.calls[0]![1]).toContain('Round 1');
      expect(notify.mock.calls[0]![1]).toContain('Bob');

      expect(watchRepo.updateLastSeen).toHaveBeenCalledWith(1, {
        round: 1,
        table: 5,
        opponent: 'Bob',
        result: null,
      });
    });

    it('batches two watches on the same event into one locator call', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 735205,
          eventName: 'Test Event',
          eventUsername: 'Alice',
          lastSeenRound: null,
          lastSeenTable: null,
          lastSeenOpponent: null,
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          telegramId: 2,
          eventId: 735205,
          eventName: 'Test Event',
          eventUsername: 'Charlie',
          lastSeenRound: null,
          lastSeenTable: null,
          lastSeenOpponent: null,
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockResolvedValue(
        makeEventData({
          currentRound: 1,
          pairings: [
            { tableNumber: 1, player1: 'Alice', player2: 'Bob', score1: null, score2: null },
            { tableNumber: 2, player1: 'Charlie', player2: 'Dave', score1: null, score2: null },
          ],
        }),
      );

      const deps = makeDeps({ watchRepository: watchRepo, locatorRepository: locatorRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(locatorRepo.getEventData).toHaveBeenCalledTimes(1);
    });

    it('deletes watches when locator returns null (404)', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 999,
          eventName: 'Gone',
          eventUsername: 'Alice',
          lastSeenRound: null,
          lastSeenTable: null,
          lastSeenOpponent: null,
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockResolvedValue(null);

      const deps = makeDeps({ watchRepository: watchRepo, locatorRepository: locatorRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.delete).toHaveBeenCalledWith(1);
    });

    it('preserves watch on 5xx and does not call updateLastSeen', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 735205,
          eventName: 'Test',
          eventUsername: 'Alice',
          lastSeenRound: null,
          lastSeenTable: null,
          lastSeenOpponent: null,
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockRejectedValue(
        Object.assign(new Error('500'), { code: 'API_RESPONSE_ERROR' }),
      );

      const deps = makeDeps({ watchRepository: watchRepo, locatorRepository: locatorRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.delete).not.toHaveBeenCalled();
      expect(watchRepo.updateLastSeen).not.toHaveBeenCalled();
    });

    it('deletes watch on notify 403 (user blocked)', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 735205,
          eventName: 'Test',
          eventUsername: 'Alice',
          lastSeenRound: null,
          lastSeenTable: null,
          lastSeenOpponent: null,
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockResolvedValue(
        makeEventData({
          currentRound: 1,
          pairings: [
            { tableNumber: 1, player1: 'Alice', player2: 'Bob', score1: null, score2: null },
          ],
        }),
      );

      const notify = vi.fn().mockRejectedValue(
        Object.assign(new Error('Forbidden'), {
          response: { error_code: 403 },
        }),
      );

      const deps = makeDeps({
        watchRepository: watchRepo,
        locatorRepository: locatorRepo,
        notify,
      });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.delete).toHaveBeenCalledWith(1);
    });

    it('clears snapshot when round ends (currentRound === null)', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 735205,
          eventName: 'Test',
          eventUsername: 'Alice',
          lastSeenRound: 2,
          lastSeenTable: 1,
          lastSeenOpponent: 'Bob',
          lastSeenResult: 'win',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockResolvedValue(
        makeEventData({ currentRound: null, pairings: [] }),
      );

      const deps = makeDeps({ watchRepository: watchRepo, locatorRepository: locatorRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.updateLastSeen).toHaveBeenCalledWith(1, {
        round: null,
        table: null,
        opponent: null,
        result: null,
      });
    });

    it('notifies result-submitted when scores appear', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        {
          telegramId: 1,
          eventId: 735205,
          eventName: 'Test',
          eventUsername: 'Alice',
          lastSeenRound: 1,
          lastSeenTable: 1,
          lastSeenOpponent: 'Bob',
          lastSeenResult: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const locatorRepo = mockLocatorRepository();
      locatorRepo.getEventData = vi.fn().mockResolvedValue(
        makeEventData({
          currentRound: 1,
          pairings: [
            { tableNumber: 1, player1: 'Alice', player2: 'Bob', score1: 2, score2: 1 },
          ],
        }),
      );

      const notify = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        watchRepository: watchRepo,
        locatorRepository: locatorRepo,
        notify,
      });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(notify).toHaveBeenCalled();
      expect(notify.mock.calls[0]![1]).toContain('result');
      expect(watchRepo.updateLastSeen).toHaveBeenCalledWith(1, {
        round: 1,
        table: 1,
        opponent: 'Bob',
        result: 'win',
      });
    });
  });
});
