import { describe, expect, it } from 'vitest';
import { NexusTable } from '../../core/entities/nexus-table.js';
import { formatNexusTable } from './nexus-table-formatter.js';

function baseTable(over: Partial<NexusTable> = {}): NexusTable {
  return {
    username: 'TestPlayer',
    event: {
      id: 'evt-001',
      name: 'Weekly Nexus Night',
      store: { id: 'str-001', name: 'Card Castle', address: '123 Main St' },
      startDate: new Date('2026-07-29T18:00:00Z'),
      format: 'Standard',
    },
    round: { number: 3, label: 'Round 3', status: 'inProgress', result: null },
    tableNumber: 5,
    opponent: { name: 'OpponentPlayer', score: null },
    standings: { rank: 2, points: 6, wins: 2, losses: 0, draws: 0 },
    record: { wins: 2, losses: 0, draws: 0 },
    status: { active: true, inProgress: true },
    fetchedAt: '2026-07-29T21:00:00.000Z',
    ...over,
  };
}

describe('formatNexusTable', () => {
  it('includes the username in the header', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('<b>Nexus Table \u2014 TestPlayer</b>');
  });

  it('includes event name and store', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('Weekly Nexus Night');
    expect(out).toContain('Card Castle');
  });

  it('includes round and table number', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('Round 3');
    expect(out).toContain('Table 5');
  });

  it('shows Table N/A when round present but no table number', () => {
    const out = formatNexusTable(baseTable({ tableNumber: null }));
    expect(out).toContain('Round 3');
    expect(out).toContain('Table N/A');
  });

  it('shows table number without round when round is null', () => {
    const out = formatNexusTable(baseTable({ round: null, tableNumber: 5 }));
    expect(out).toContain('Table 5');
    expect(out).not.toContain('Round');
  });

  it('includes opponent name', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('Opponent: OpponentPlayer');
  });

  it('includes opponent score when present', () => {
    const out = formatNexusTable(
      baseTable({ opponent: { name: 'OpponentPlayer', score: 1 } }),
    );
    expect(out).toContain('Opponent Score: 1');
  });

  it('omits opponent score when null', () => {
    const out = formatNexusTable(baseTable());
    expect(out).not.toContain('Opponent Score');
  });

  it('includes record as W-L-D', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('Record: 2-0-0');
  });

  it('includes standings when present', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('Standings: rank 2');
    expect(out).toContain('6 pts');
  });

  it('omits standings block when null', () => {
    const out = formatNexusTable(baseTable({ standings: null }));
    expect(out).not.toContain('Standings');
  });

  it('shows "in progress" status when inProgress is true', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('Status: in progress');
  });

  it('shows "completed" status when round status is completed', () => {
    const out = formatNexusTable(
      baseTable({
        round: { number: 3, label: 'Round 3', status: 'completed', result: 'win' },
        status: { active: true, inProgress: false },
      }),
    );
    expect(out).toContain('Status: completed');
  });

  it('shows "pending" status when not in progress and not completed', () => {
    const out = formatNexusTable(
      baseTable({
        round: { number: 1, label: 'Round 1', status: 'pending', result: null },
        status: { active: true, inProgress: false },
      }),
    );
    expect(out).toContain('Status: pending');
  });

  it('includes locator link when event is present', () => {
    const out = formatNexusTable(baseTable());
    expect(out).toContain('https://locator.riftbound.uvsgames.com/events/evt-001');
  });

  it('omits locator link when event is null', () => {
    const out = formatNexusTable(
      baseTable({ event: null, round: null, tableNumber: null, opponent: null, standings: null }),
    );
    expect(out).not.toContain('Locator');
  });

  it('shows empty state when event, round, and opponent are all null', () => {
    const out = formatNexusTable(
      baseTable({ event: null, round: null, tableNumber: null, opponent: null, standings: null }),
    );
    expect(out).toContain('No active pairing for TestPlayer');
  });

  it('escapes HTML in username', () => {
    const out = formatNexusTable(
      baseTable({
        username: '<script>alert("xss")</script>',
        event: null,
        round: null,
        tableNumber: null,
        opponent: null,
        standings: null,
      }),
    );
    expect(out).toContain('&lt;script&gt;alert(');
    expect(out).toContain('&lt;/script&gt;');
    expect(out).not.toContain('<script>');
  });
});
