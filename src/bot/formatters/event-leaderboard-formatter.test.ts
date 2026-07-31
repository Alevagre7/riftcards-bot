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
    expect(out).toContain('<b>3</b>');
  });

  it('shows question mark when currentRound is null', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: null,
      standings: [],
    });
    expect(out).toContain('<b>?</b>');
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

    expect(out).toContain('\uD83E\uDD47 <b>Alice</b> \u2014 <b>3-1</b> \u00B7 <i>9 pts</i>');
    expect(out).toContain('\uD83E\uDD48 <b>Bob</b> \u2014 <b>2-2</b> \u00B7 <i>9 pts</i>');
    expect(out).toContain('\uD83E\uDD49 <b>Charlie</b> \u2014 <b>1-3</b> \u00B7 <i>9 pts</i>');
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
