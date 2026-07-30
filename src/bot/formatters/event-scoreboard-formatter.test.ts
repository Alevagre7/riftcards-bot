import { describe, it, expect } from 'vitest';
import { formatEventScoreboard } from './event-scoreboard-formatter.js';
import type { LocatorEventData } from '../../core/ports/locator-repository.js';

function makeData(overrides?: Partial<LocatorEventData>): LocatorEventData {
  return {
    eventId: 735205,
    name: 'Test Event',
    currentRound: 2,
    roster: [],
    pairings: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('formatEventScoreboard', () => {
  it('renders current round with scores', () => {
    const data = makeData({
      currentRound: 1,
      pairings: [
        { tableNumber: 1, player1: 'Alice', player2: 'Bob', score1: 2, score2: 1 },
        { tableNumber: 2, player1: 'Charlie', player2: 'Dave', score1: 0, score2: 0 },
      ],
    });

    const out = formatEventScoreboard(data);
    expect(out).toContain('Test Event');
    expect(out).toContain('Round 1');
    expect(out).toContain('Alice vs Bob');
    expect(out).toContain('2-1');
    expect(out).toContain('Charlie vs Dave');
    expect(out).toContain('0-0');
  });

  it('shows "not reported" when scores are null', () => {
    const data = makeData({
      currentRound: 1,
      pairings: [
        { tableNumber: 1, player1: 'Alice', player2: 'Bob', score1: null, score2: null },
      ],
    });

    const out = formatEventScoreboard(data);
    expect(out).toContain('not reported');
  });

  it('shows "No active round" when currentRound is null', () => {
    const data = makeData({ currentRound: null });
    const out = formatEventScoreboard(data);
    expect(out).toContain('No active round');
  });

  it('shows "No pairings yet" when currentRound is set but no pairings', () => {
    const data = makeData({ currentRound: 1, pairings: [] });
    const out = formatEventScoreboard(data);
    expect(out).toContain('No pairings yet');
  });
});
