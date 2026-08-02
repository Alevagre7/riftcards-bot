import { describe, it, expect, vi } from 'vitest';
import { createEventWatcher, EventWatcherDeps } from './event-watcher.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { IEventRepository } from '../../core/ports/event-repository.js';
import { EventDetail, EventPairing } from '../../core/entities/event-detail.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { ApiResponseError } from '../../core/errors/index.js';
import type { EventWatch } from '../../core/entities/event-watch.js';

function mockWatchRepository(): IEventWatchRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    create: vi.fn(),
    replace: vi.fn(),
    delete: vi.fn(),
    deleteIfCurrent: vi.fn().mockResolvedValue(true),
    recordObservation: vi.fn().mockResolvedValue(true),
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
    notify: vi.fn().mockResolvedValue(undefined),
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

function makeRegistration(overrides?: Partial<EventRegistration>): EventRegistration {
  return {
    id: 1,
    name: 'Alice',
    status: 'Active',
    profileImageUrl: null,
    matchesWon: 0,
    matchesLost: 0,
    matchesDrawn: 0,
    isGuest: false,
    finalPlaceInStandings: null,
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
    registrations: [makeRegistration()],
    pairings: [],
    standings: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeWatch(overrides: Partial<EventWatch> = {}): EventWatch {
  const now = new Date().toISOString();
  return {
    telegramId: 1,
    revision: 'revision-1',
    eventId: 735205,
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

describe('createEventWatcher', () => {
  it('returns without calling the event repository when no watches exist', async () => {
    const deps = makeDeps();
    await createEventWatcher(deps).tick();
    expect(deps.eventRepository.getEventDetail).not.toHaveBeenCalled();
  });

  it('notifies on the first pairing with event context and records the snapshot', async () => {
    const watchRepository = mockWatchRepository();
    const watch = makeWatch();
    watchRepository.list = vi.fn().mockResolvedValue([watch]);
    watchRepository.get = vi.fn().mockResolvedValue(watch);
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockResolvedValue(
      makeDetail({
        currentRound: { id: 1, roundNumber: 1, status: 'IN_PROGRESS', pairingsStatus: 'GENERATED', standingsStatus: 'GENERATED' },
        pairings: [makePairing({ tableNumber: 5 })],
      }),
    );
    const notify = vi.fn().mockResolvedValue(undefined);

    await createEventWatcher(makeDeps({ watchRepository, eventRepository, notify })).tick();

    expect(notify).toHaveBeenCalledWith(1, expect.objectContaining({
      eventId: 735205,
      revision: 'revision-1',
      canStop: true,
      body: expect.stringContaining('Pairing found'),
    }));
    expect(notify.mock.calls[0]![1].body).toContain('Test Event');
    expect(watchRepository.recordObservation).toHaveBeenCalledWith(1, 'revision-1', expect.objectContaining({
      kind: 'success',
      changed: true,
      snapshot: { round: 1, table: 5, opponent: 'Bob', result: null },
    }));
  });

  it('batches two watches on the same event into one detail call', async () => {
    const watchRepository = mockWatchRepository();
    watchRepository.list = vi.fn().mockResolvedValue([
      makeWatch({ telegramId: 1, eventUsername: 'Alice' }),
      makeWatch({ telegramId: 2, eventUsername: 'Charlie', revision: 'revision-2' }),
    ]);
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockResolvedValue(
      makeDetail({
        pairings: [
          makePairing({ player1: 'Alice', player2: 'Bob' }),
          makePairing({ player1: 'Charlie', player2: 'Dave', tableNumber: 2 }),
        ],
      }),
    );

    await createEventWatcher(makeDeps({ watchRepository, eventRepository })).tick();
    expect(eventRepository.getEventDetail).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing event through two polls and ends it on the third', async () => {
    const watchRepository = mockWatchRepository();
    let watch = makeWatch();
    watchRepository.list = vi.fn().mockImplementation(async () => [watch]);
    watchRepository.get = vi.fn().mockImplementation(async () => watch);
    watchRepository.recordObservation = vi.fn().mockImplementation(async (_id, _revision, observation) => {
      if (observation.kind === 'not-found') {
        watch = { ...watch, consecutiveMissing: watch.consecutiveMissing + 1 };
      }
      return true;
    });
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockResolvedValue(null);
    const notify = vi.fn().mockResolvedValue(undefined);
    const watcher = createEventWatcher(makeDeps({ watchRepository, eventRepository, notify }));

    await watcher.tick();
    await watcher.tick();
    expect(notify).not.toHaveBeenCalled();
    await watcher.tick();

    expect(notify).toHaveBeenCalledWith(1, expect.objectContaining({ canStop: false }));
    expect(watchRepository.deleteIfCurrent).toHaveBeenCalledWith(1, 'revision-1');
  });

  it('keeps the watch and records health on a transient upstream failure', async () => {
    const watchRepository = mockWatchRepository();
    const watch = makeWatch();
    watchRepository.list = vi.fn().mockResolvedValue([watch]);
    watchRepository.get = vi.fn().mockResolvedValue(watch);
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockRejectedValue(new ApiResponseError('Riftbound V2', 500));

    await createEventWatcher(makeDeps({ watchRepository, eventRepository })).tick();

    expect(watchRepository.recordObservation).toHaveBeenCalledWith(1, 'revision-1', expect.objectContaining({
      kind: 'transient-failure',
    }));
    expect(watchRepository.deleteIfCurrent).not.toHaveBeenCalled();
  });

  it('ends completed events and does not expose a stop action on the terminal notice', async () => {
    const watchRepository = mockWatchRepository();
    const watch = makeWatch();
    watchRepository.list = vi.fn().mockResolvedValue([watch]);
    watchRepository.get = vi.fn().mockResolvedValue(watch);
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockResolvedValue(
      makeDetail({ event: makeEvent({ displayStatus: 'complete', eventStatus: 'COMPLETE' }) }),
    );
    const notify = vi.fn().mockResolvedValue(undefined);

    await createEventWatcher(makeDeps({ watchRepository, eventRepository, notify })).tick();

    expect(notify).toHaveBeenCalledWith(1, expect.objectContaining({ canStop: false }));
    expect(notify.mock.calls[0]![1].body).toContain('event is complete');
    expect(watchRepository.deleteIfCurrent).toHaveBeenCalledWith(1, 'revision-1');
  });

  it('ends a watch when the selected player is dropped', async () => {
    const watchRepository = mockWatchRepository();
    const watch = makeWatch();
    watchRepository.list = vi.fn().mockResolvedValue([watch]);
    watchRepository.get = vi.fn().mockResolvedValue(watch);
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockResolvedValue(
      makeDetail({ registrations: [makeRegistration({ status: 'Dropped' })] }),
    );
    const notify = vi.fn().mockResolvedValue(undefined);

    await createEventWatcher(makeDeps({ watchRepository, eventRepository, notify })).tick();

    expect(notify.mock.calls[0]![1].body).toContain('no longer active');
    expect(watchRepository.deleteIfCurrent).toHaveBeenCalledWith(1, 'revision-1');
  });

  it('does not notify or write an old revision after a replacement', async () => {
    const watchRepository = mockWatchRepository();
    const oldWatch = makeWatch();
    watchRepository.list = vi.fn().mockResolvedValue([oldWatch]);
    watchRepository.get = vi.fn().mockResolvedValue(makeWatch({ revision: 'new-revision', eventId: 99 }));
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockResolvedValue(
      makeDetail({ pairings: [makePairing()] }),
    );
    const notify = vi.fn().mockResolvedValue(undefined);

    await createEventWatcher(makeDeps({ watchRepository, eventRepository, notify })).tick();

    expect(notify).not.toHaveBeenCalled();
    expect(watchRepository.recordObservation).not.toHaveBeenCalled();
  });

  it('serializes concurrent ticks', async () => {
    const watchRepository = mockWatchRepository();
    watchRepository.list = vi.fn().mockResolvedValue([makeWatch()]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const eventRepository = mockEventRepository();
    eventRepository.getEventDetail = vi.fn().mockImplementation(async () => {
      await gate;
      return makeDetail({ pairings: [makePairing()] });
    });
    const watcher = createEventWatcher(makeDeps({ watchRepository, eventRepository }));

    const first = watcher.tick();
    const second = watcher.tick();
    expect(second).toBe(first);
    release();
    await first;
    expect(eventRepository.getEventDetail).toHaveBeenCalledTimes(1);
  });
});
