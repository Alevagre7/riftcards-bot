import { describe, it, expect } from 'vitest';
import { formatEventLeaderboard } from './event-leaderboard-formatter.js';
import { EventStanding } from '../../core/entities/event-detail.js';

function makeStanding(overrides?: Partial<EventStanding>): EventStanding {
  return {
    rank: 1,
    name: 'Alice',
    wins: 3,
    losses: 1,
    draws: 0,
    matchPoints: 9,
    matchRecord: '3-1-0',
    ...overrides,
  };
}

describe('formatEventLeaderboard', () => {
  it('renders header with event name and round', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: 3,
      standings: [],
    });
    expect(out).toContain('Test Event');
    expect(out).toContain('Round 3');
  });

  it('shows question mark when currentRound is null', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: null,
      standings: [],
    });
    expect(out).toContain('Round ?');
  });

  it('renders standings rows with rank, name, and W-L', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: 3,
      standings: [
        makeStanding({ rank: 1, name: 'Alice', wins: 3, losses: 1 }),
        makeStanding({ rank: 2, name: 'Bob', wins: 2, losses: 2 }),
        makeStanding({ rank: 3, name: 'Charlie', wins: 1, losses: 3 }),
      ],
    });

    expect(out).toContain('#1 Alice (3-1)');
    expect(out).toContain('#2 Bob (2-2)');
    expect(out).toContain('#3 Charlie (1-3)');
  });

  it('shows "No standings available yet" when standings is empty', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: 2,
      standings: [],
    });
    expect(out).toContain('No standings available yet.');
  });
});
