import { describe, expect, it } from 'vitest';
import { EventPairing } from '../../core/entities/event-detail.js';
import { EventRoundSummary } from '../../core/entities/event.js';
import { formatEventRounds } from './event-rounds-formatter.js';

const round: EventRoundSummary = {
  id: 1,
  roundNumber: 3,
  status: 'COMPLETE',
  pairingsStatus: 'COMPLETE',
  standingsStatus: 'COMPLETE',
};

function pairing(overrides?: Partial<EventPairing>): EventPairing {
  return {
    tableNumber: 7,
    player1: 'Alice',
    player2: 'Bob',
    score1: null,
    score2: null,
    isBye: false,
    status: 'COMPLETE',
    outcome: 'unavailable',
    winner: null,
    drawType: null,
    gamesDrawn: 0,
    ...overrides,
  };
}

describe('formatEventRounds', () => {
  it('renders a win with winner normalized left and the sword between names', () => {
    const out = formatEventRounds({
      name: 'Event',
      currentRound: round,
      pairings: [pairing({ player1: 'Bob', player2: 'Alice', score1: 1, score2: 2, outcome: 'win', winner: 'Alice' })],
    });
    expect(out).toContain('🦺 <b>Table 7</b> · 🏆 <b>Alice</b> ⚔️ <b>Bob</b> · <b>2–1</b>');
  });

  it('renders intentional and unintentional draws without fabricated scores', () => {
    const intentional = formatEventRounds({
      name: 'Event', currentRound: round,
      pairings: [pairing({ outcome: 'draw', drawType: 'intentional' })],
    });
    const unintentional = formatEventRounds({
      name: 'Event', currentRound: round,
      pairings: [pairing({ outcome: 'draw', drawType: 'unintentional' })],
    });
    expect(intentional).toContain('🤝 <b>Draw</b> <i>(intentional)</i>');
    expect(unintentional).toContain('🤝 <b>Draw</b> <i>(unintentional)</i>');
    expect(intentional).not.toContain('not reported');
  });

  it('distinguishes pending, conflict, loss, and unavailable results', () => {
    const out = formatEventRounds({
      name: 'Event', currentRound: round,
      pairings: [
        pairing({ tableNumber: 1, outcome: 'pending', status: 'IN_PROGRESS' }),
        pairing({ tableNumber: 2, outcome: 'conflict' }),
        pairing({ tableNumber: 3, outcome: 'loss' }),
        pairing({ tableNumber: 4, outcome: 'unavailable' }),
      ],
    });
    expect(out).toContain('⏳ <i>not reported</i>');
    expect(out).toContain('⚠️ <i>reports conflict</i>');
    expect(out).toContain('❌ <i>loss recorded</i>');
    expect(out).toContain('⚠️ <i>result unavailable</i>');
  });

  it('escapes player names', () => {
    const out = formatEventRounds({
      name: 'Event', currentRound: round,
      pairings: [pairing({ player1: '<Alice>', player2: 'Bob & Co.' })],
    });
    expect(out).toContain('&lt;Alice&gt;');
    expect(out).toContain('Bob &amp; Co.');
  });
});
