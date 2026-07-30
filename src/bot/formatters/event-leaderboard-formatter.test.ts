import { describe, it, expect } from 'vitest';
import { formatEventLeaderboard } from './event-leaderboard-formatter.js';
import type { LocatorEventData } from '../../core/ports/locator-repository.js';

function makeData(overrides?: Partial<LocatorEventData>): LocatorEventData {
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

describe('formatEventLeaderboard', () => {
  it('renders header with event name and round', () => {
    const data = makeData({ currentRound: 3, standings: [] });
    const out = formatEventLeaderboard(data);
    expect(out).toContain('Test Event');
    expect(out).toContain('Round 3');
  });

  it('shows question mark when currentRound is null', () => {
    const data = makeData({ currentRound: null });
    const out = formatEventLeaderboard(data);
    expect(out).toContain('Round ?');
  });

  it('renders standings rows with rank, name, and W-L', () => {
    const data = makeData({
      currentRound: 3,
      standings: [
        { rank: 1, name: 'Alice', wins: 3, losses: 1 },
        { rank: 2, name: 'Bob', wins: 2, losses: 2 },
        { rank: 3, name: 'Charlie', wins: 1, losses: 3 },
      ],
    });

    const out = formatEventLeaderboard(data);
    expect(out).toContain('#1 Alice (3-1)');
    expect(out).toContain('#2 Bob (2-2)');
    expect(out).toContain('#3 Charlie (1-3)');
  });

  it('shows question marks when wins/losses are null', () => {
    const data = makeData({
      standings: [
        { rank: 1, name: 'Alice', wins: null, losses: null },
      ],
    });

    const out = formatEventLeaderboard(data);
    expect(out).toContain('#1 Alice (?-?)');
  });

  it('shows "No standings available yet" when standings is empty', () => {
    const data = makeData({ standings: [] });
    const out = formatEventLeaderboard(data);
    expect(out).toContain('No standings available yet.');
  });
});
