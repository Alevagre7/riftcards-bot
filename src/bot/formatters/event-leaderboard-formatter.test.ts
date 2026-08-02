import { describe, it, expect } from 'vitest';
import { formatEventLeaderboard } from './event-leaderboard-formatter.js';
import { EventStanding } from '../../core/entities/event-detail.js';

function makeStanding(overrides?: Partial<EventStanding>): EventStanding {
  return {
    rank: 1,
    name: 'Alice',
    roundNumber: 3,
    matchRecord: '3-1-1',
    points: 10,
    opponentMatchWinPercentage: 0.625,
    gameWinPercentage: 0.75,
    opponentGameWinPercentage: 0.5,
    ...overrides,
  };
}

describe('formatEventLeaderboard', () => {
  it('renders header with event name and round', () => {
    const out = formatEventLeaderboard({ name: 'Test Event', currentRound: 3, standings: [] });
    expect(out).toContain('Test Event');
    expect(out).toContain('<b>3</b>');
  });

  it('renders full W-L-D records, official points, and tiebreakers', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: 3,
      standings: [makeStanding({ name: 'Alice', matchRecord: '3-1-1', points: 10 })],
    });

    expect(out).toContain('🥇 <b>Alice</b> — <b>3-1-1</b> · <i>10 pts</i>');
    expect(out).toContain('OMW 62.5% · GW 75% · OGW 50%');
  });

  it('shows a draw record and one-point score without recomputation', () => {
    const out = formatEventLeaderboard({
      name: 'Test Event',
      currentRound: 2,
      standings: [makeStanding({ matchRecord: '1-0-1', points: 4 })],
    });
    expect(out).toContain('<b>1-0-1</b> · <i>4 pts</i>');
  });

  it('shows no-standings state', () => {
    const out = formatEventLeaderboard({ name: 'Test Event', currentRound: 2, standings: [] });
    expect(out).toContain('No standings available yet.');
  });
});
