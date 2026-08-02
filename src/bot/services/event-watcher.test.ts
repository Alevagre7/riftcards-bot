import { describe, it, expect, vi } from 'vitest';
import { createEventWatcher, EventWatcherDeps } from './event-watcher.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { EventDetail, EventPairing } from '../../core/entities/event-detail.js';
import { Event } from '../../core/entities/event.js';
import { ApiResponseError } from '../../core/errors/index.js';

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

function mockEventRepository(): IEventRepository {
  return {
    getEventById: vi.fn(),
    getEventRegistrations: vi.fn(),
    getEventMatches: vi.fn(),
    getEventStandings: vi.fn(),
    getEventDetail: vi.fn(),
  };
}

function makeDeps(overrides?: Partial<EventWatcherDeps>): EventWatcherDeps {
  return {
    watchRepository: mockWatchRepository(),
    eventRepository: mockEventRepository(),
    defaultLocation: { latitude: 0, longitude: 0, numMiles: 50 },
    notify: vi.fn(),
    intervalMs: 30000,
    logger: vi.fn(),
    ...overrides,
  };
}

function makeEvent(overrides?: Partial<Event>): Event {
  return {
    id: 735205,
    name: 'Test Event',
    displayStatus: 'inProgress',
    eventStatus: 'IN_PROGRESS',
    startDatetime: '2026-08-01T18:00:00+00:00',
    endDatetime: '2026-08-01T22:00:00+00:00',
    timezone: 'Europe/Madrid',
    capacity: 8,
    registeredCount: 4,
    startingPlayerCount: 4,
    store: {
      id: 1,
      name: 'Test Store',
      fullAddress: '',
      latitude: 0,
      longitude: 0,
      timezone: 'Europe/Madrid',
      country: 'ES',
    },
    gameplayFormatName: 'Constructed',
    headerImageUrl: null,
    queueStatus: 'ACCEPTING_SIGNUPS',
    eventType: 'LOCALS',
    eventFormat: 'OTHER',
    description: '',
    costInCents: 0,
    currency: 'EUR',
    isOnDemand: false,
    isTestEvent: false,
    tournamentPhases: [],
    ...overrides,
  };
}

function makePairing(overrides?: Partial<EventPairing>): EventPairing {
  return {
    tableNumber: 1,
    player1: 'Alice',
    player2: 'Bob',
    score1: null,
    score2: null,
    isBye: false,
    status: 'PENDING',
    outcome: 'pending',
    winner: null,
    drawType: null,
    gamesDrawn: 0,
    ...overrides,
  };
}

function makeDetail(overrides?: Partial<EventDetail>): EventDetail {
  return {
    event: makeEvent(),
    currentRound: {
      id: 1172657,
      roundNumber: 2,
      status: 'IN_PROGRESS',
      pairingsStatus: 'GENERATED',
      standingsStatus: 'GENERATED',
    },
    registrations: [],
    pairings: [],
    standings: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWatch(overrides: Partial<{
  telegramId: number;
  eventId: number;
  eventName: string;
  eventUsername: string;
  lastSeenRound: number | null;
  lastSeenTable: number | null;
  lastSeenOpponent: string | null;
  lastSeenResult: 'win' | 'loss' | 'draw' | 'bye' | null;
}> = {}) {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createEventWatcher', () => {
  describe('tick', () => {
    it('returns without calling the event repository when no watches', async () => {
      const deps = makeDeps();
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(deps.eventRepository.getEventDetail).not.toHaveBeenCalled();
    });

    it('notifies on new-round and updates snapshot', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([makeWatch()]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(
        makeDetail({
          currentRound: { id: 1, roundNumber: 1, status: 'IN_PROGRESS', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
          pairings: [makePairing({ tableNumber: 5 })],
        }),
      );

      const notify = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        watchRepository: watchRepo,
        eventRepository: eventRepo,
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

    it('batches two watches on the same event into one detail call', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        makeWatch({ telegramId: 1, eventUsername: 'Alice' }),
        makeWatch({ telegramId: 2, eventUsername: 'Charlie' }),
      ]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(
        makeDetail({
          currentRound: { id: 1, roundNumber: 1, status: 'IN_PROGRESS', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
          pairings: [
            makePairing({ tableNumber: 1, player1: 'Alice', player2: 'Bob' }),
            makePairing({ tableNumber: 2, player1: 'Charlie', player2: 'Dave' }),
          ],
        }),
      );

      const deps = makeDeps({ watchRepository: watchRepo, eventRepository: eventRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(eventRepo.getEventDetail).toHaveBeenCalledTimes(1);
    });

    it('deletes watches when detail returns null (404)', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        makeWatch({ telegramId: 1, eventId: 999, eventName: 'Gone' }),
      ]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(null);

      const deps = makeDeps({ watchRepository: watchRepo, eventRepository: eventRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.delete).toHaveBeenCalledWith(1);
    });

    it('preserves watch on 5xx and does not call updateLastSeen', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([makeWatch()]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockRejectedValue(new ApiResponseError('Riftbound V2', 500));

      const deps = makeDeps({ watchRepository: watchRepo, eventRepository: eventRepo });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.delete).not.toHaveBeenCalled();
      expect(watchRepo.updateLastSeen).not.toHaveBeenCalled();
    });

    it('deletes watch on notify 403 (user blocked)', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([makeWatch()]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(
        makeDetail({
          currentRound: { id: 1, roundNumber: 1, status: 'IN_PROGRESS', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
          pairings: [makePairing()],
        }),
      );

      const notify = vi.fn().mockRejectedValue(
        Object.assign(new Error('Forbidden'), {
          response: { error_code: 403 },
        }),
      );

      const deps = makeDeps({
        watchRepository: watchRepo,
        eventRepository: eventRepo,
        notify,
      });
      const watcher = createEventWatcher(deps);

      await watcher.tick();

      expect(watchRepo.delete).toHaveBeenCalledWith(1);
    });

    it('clears snapshot when round ends (currentRound === null)', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        makeWatch({
          lastSeenRound: 2,
          lastSeenTable: 1,
          lastSeenOpponent: 'Bob',
          lastSeenResult: 'win',
        }),
      ]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(
        makeDetail({ currentRound: null, pairings: [] }),
      );

      const deps = makeDeps({ watchRepository: watchRepo, eventRepository: eventRepo });
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
        makeWatch({
          lastSeenRound: 1,
          lastSeenTable: 1,
          lastSeenOpponent: 'Bob',
          lastSeenResult: null,
        }),
      ]);

      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(
        makeDetail({
          currentRound: { id: 1, roundNumber: 1, status: 'COMPLETE', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
          pairings: [makePairing({ score1: 2, score2: 1, status: 'COMPLETE', outcome: 'win', winner: 'Alice' })],
        }),
      );

      const notify = vi.fn().mockResolvedValue(undefined);
      const deps = makeDeps({
        watchRepository: watchRepo,
        eventRepository: eventRepo,
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
    it('coalesces round, table, and opponent changes into one new-round line', async () => {
      const watchRepo = mockWatchRepository();
      watchRepo.list = vi.fn().mockResolvedValue([
        makeWatch({ lastSeenRound: 2, lastSeenTable: 1, lastSeenOpponent: 'Old Opponent' }),
      ]);
      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockResolvedValue(
        makeDetail({
          currentRound: { id: 3, roundNumber: 3, status: 'IN_PROGRESS', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
          pairings: [makePairing({ tableNumber: 5, player2: 'FireWings' })],
        }),
      );
      const notify = vi.fn().mockResolvedValue(undefined);
      const watcher = createEventWatcher(makeDeps({ watchRepository: watchRepo, eventRepository: eventRepo, notify }));

      await watcher.tick();

      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![1]).toBe('🆕 Round 3 — Table 5: You vs FireWings');
    });

    it('serializes concurrent ticks and leaves the next stable tick silent', async () => {
      const watchRepo = mockWatchRepository();
      let currentWatch = makeWatch();
      watchRepo.list = vi.fn().mockImplementation(async () => [currentWatch]);
      watchRepo.updateLastSeen = vi.fn().mockImplementation(async (_id, snapshot) => {
        currentWatch = {
          ...currentWatch,
          lastSeenRound: snapshot.round,
          lastSeenTable: snapshot.table,
          lastSeenOpponent: snapshot.opponent,
          lastSeenResult: snapshot.result,
        };
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const eventRepo = mockEventRepository();
      eventRepo.getEventDetail = vi.fn().mockImplementation(async () => {
        await gate;
        return makeDetail({
          currentRound: { id: 1, roundNumber: 1, status: 'IN_PROGRESS', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
          pairings: [makePairing({ tableNumber: 5 })],
        });
      });
      const notify = vi.fn().mockResolvedValue(undefined);
      const watcher = createEventWatcher(makeDeps({ watchRepository: watchRepo, eventRepository: eventRepo, notify }));

      const first = watcher.tick();
      const second = watcher.tick();
      expect(second).toBe(first);
      release();
      await first;
      await watcher.tick();

      expect(eventRepo.getEventDetail).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(watchRepo.updateLastSeen).toHaveBeenCalledTimes(1);
    });
  });
});
