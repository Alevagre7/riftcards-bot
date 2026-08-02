import { describe, it, expect } from 'vitest';
import { detectPairingChange, pairingToResult } from './event-watcher-diff.js';
import type { EventWatch } from '../../core/entities/event-watch.js';
import type { EventPairing } from '../../core/entities/event-detail.js';

type WatchSnapshot = Pick<
  EventWatch,
  'lastSeenRound' | 'lastSeenTable' | 'lastSeenOpponent' | 'lastSeenResult' | 'hasObservedPairing'
>;

function prev(overrides?: Partial<WatchSnapshot>): WatchSnapshot {
  return {
    hasObservedPairing: true,
    lastSeenRound: null,
    lastSeenTable: null,
    lastSeenOpponent: null,
    lastSeenResult: null,
    ...overrides,
  };
}

function pairing(overrides?: Partial<EventPairing>): EventPairing {
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

describe('detectPairingChange', () => {
  it('detects new rounds and independent table changes', () => {
    const result = detectPairingChange(
      prev({ lastSeenTable: 1 }),
      pairing({ tableNumber: 2 }),
      2,
      'Alice',
    );
    expect(result.reasons).toEqual(['new-round', 'table-changed']);
  });

  it('distinguishes the first observed pairing from a new round', () => {
    const result = detectPairingChange(
      prev({ hasObservedPairing: false }),
      pairing(),
      1,
      'Alice',
    );
    expect(result.reasons).toContain('first-pairing');
    expect(result.reasons).not.toContain('new-round');
  });

  it('detects opponent changes', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenOpponent: 'Charlie' }),
      pairing(),
      1,
      'Alice',
    );
    expect(result.reasons).toContain('opponent-changed');
  });

  it('detects a submitted win from explicit outcome data', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1 }),
      pairing({ status: 'COMPLETE', outcome: 'win', winner: 'Alice', score1: 2, score2: 1 }),
      1,
      'Alice',
    );
    expect(result.reasons).toContain('result-submitted');
  });

  it('detects a result change from player two perspective', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenResult: 'loss' }),
      pairing({ status: 'COMPLETE', outcome: 'win', winner: 'Bob', score1: 0, score2: 2 }),
      1,
      'Bob',
    );
    expect(result.reasons).toContain('result-changed');
  });

  it('does not notify for pending, conflict, or unavailable outcomes', () => {
    for (const outcome of ['pending', 'conflict', 'unavailable'] as const) {
      const result = detectPairingChange(
        prev({ lastSeenRound: 1 }),
        pairing({ outcome }),
        1,
        'Alice',
      );
      expect(result.reasons).not.toContain('result-submitted');
    }
  });

  it('maps an official null-score draw to draw', () => {
    expect(pairingToResult(
      pairing({ status: 'COMPLETE', outcome: 'draw', drawType: 'intentional' }),
      'Alice',
    )).toBe('draw');
  });

  it('maps a bye to bye', () => {
    expect(pairingToResult(
      pairing({ outcome: 'bye', isBye: true }),
      'Alice',
    )).toBe('bye');
  });

  it('reports no changes for the same snapshot', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenTable: 1, lastSeenOpponent: 'Bob' }),
      pairing(),
      1,
      'Alice',
    );
    expect(result).toEqual({ changed: false, reasons: [] });
  });
});
