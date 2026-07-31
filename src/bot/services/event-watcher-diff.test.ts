import { describe, it, expect } from 'vitest';
import { detectPairingChange } from './event-watcher-diff.js';
import type { EventWatch } from '../../core/entities/event-watch.js';
import type { EventPairing } from '../../core/entities/event-detail.js';

type WatchSnapshot = Pick<
  EventWatch,
  'lastSeenRound' | 'lastSeenTable' | 'lastSeenOpponent' | 'lastSeenResult'
>;

function prev(overrides?: Partial<WatchSnapshot>): WatchSnapshot {
  return {
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
    ...overrides,
  };
}

describe('detectPairingChange', () => {
  it('new-round fires when prev had no round and now there is one', () => {
    const result = detectPairingChange(prev({ lastSeenRound: null }), pairing(), 2);
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('new-round');
  });

  it('round-changed fires when round number differs', () => {
    const result = detectPairingChange(prev({ lastSeenRound: 1 }), pairing(), 2);
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('round-changed');
    expect(result.reasons).not.toContain('new-round');
  });

  it('table-changed fires when table number differs', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenTable: 1 }),
      pairing({ tableNumber: 2 }),
      1,
    );
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('table-changed');
  });

  it('opponent-changed fires when opponent name does not match either player', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenOpponent: 'Charlie' }),
      pairing({ player1: 'Alice', player2: 'Bob' }),
      1,
    );
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('opponent-changed');
  });

  it('opponent-changed does NOT fire when opponent matches one player', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenOpponent: 'Alice' }),
      pairing({ player1: 'Alice', player2: 'Bob' }),
      1,
    );
    expect(result.changed).toBe(false);
    expect(result.reasons).not.toContain('opponent-changed');
  });

  it('result-submitted fires when scores appear', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenResult: null }),
      pairing({ score1: 2, score2: 1 }),
      1,
    );
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('result-submitted');
  });

  it('result-changed fires when score outcome changes', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: 1, lastSeenResult: 'win' }),
      pairing({ score1: 0, score2: 2 }),
      1,
    );
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('result-changed');
  });

  it('multiple reasons can fire in one tick', () => {
    const result = detectPairingChange(
      prev({ lastSeenRound: null }),
      pairing({ tableNumber: 3, score1: 1, score2: 0 }),
      1,
    );
    expect(result.changed).toBe(true);
    expect(result.reasons).toContain('new-round');
    expect(result.reasons).toContain('result-submitted');
  });

  it('no change when nothing differs', () => {
    const result = detectPairingChange(
      prev({
        lastSeenRound: 1,
        lastSeenTable: 1,
        lastSeenOpponent: 'Bob',
        lastSeenResult: null,
      }),
      pairing({ tableNumber: 1 }),
      1,
    );
    expect(result.changed).toBe(false);
    expect(result.reasons).toEqual([]);
  });
});
