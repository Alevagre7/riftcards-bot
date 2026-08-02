import { describe, expect, it } from 'vitest';
import { EventListing } from '../../core/entities/event-listing.js';
import { formatEventList } from './event-list-formatter.js';

const baseEvent: EventListing = {
  id: 42,
  name: 'Weekly Riftbound',
  startDatetime: '2026-07-21T18:00:00+00:00',
  endDatetime: '2026-07-21T22:00:00+00:00',
  mode: 'Skirmish',
  storeName: 'Card Castle',
  registeredCount: 8,
  capacity: 32,
};

describe('formatEventList', () => {
  it('returns empty body and no buttons when the list is empty', () => {
    const out = formatEventList([], 7);
    expect(out.body).toContain('No events found');
    expect(out.buttons).toHaveLength(0);
  });

  it('renders the count and singular day label', () => {
    expect(formatEventList([baseEvent], 1).body)
      .toBe('\uD83D\uDCC5 <b>1</b> event in the next 1 day');
  });

  it('preserves caller order and uses event ids in callbacks', () => {
    const events = [
      { ...baseEvent, id: 3 },
      { ...baseEvent, id: 1 },
      { ...baseEvent, id: 2 },
    ];
    const out = formatEventList(events, 7);
    expect(out.buttons.map((row) => row[0]!.callbackData)).toEqual([
      'event:3', 'event:1', 'event:2',
    ]);
  });

  it('renders normalized mode, store, and count in the requested layout', () => {
    const label = formatEventList([baseEvent], 7).buttons[0]![0]!.label;
    expect(label).toBe('🩷 Tue 21 · Skirmish · Card Castle · 8/32');
  });

  it('maps every mode to its color-preserving icon', () => {
    const modes = [
      ['Skirmish', '🩷'],
      ['Nexus Night', '🟣'],
      ['Pre-Rift', '🟢'],
      ['Other', '⚪'],
    ] as const;
    for (const [mode, icon] of modes) {
      const label = formatEventList([{ ...baseEvent, mode }], 7).buttons[0]![0]!.label;
      expect(label.startsWith(`${icon} `)).toBe(true);
    }
  });

  it('preserves an empty store name', () => {
    const label = formatEventList([{ ...baseEvent, storeName: '' }], 7).buttons[0]![0]!.label;
    expect(label).toBe('🩷 Tue 21 · Skirmish ·  · 8/32');
  });

  it('truncates only the middle while preserving the count suffix', () => {
    const label = formatEventList([{ ...baseEvent, storeName: 'A'.repeat(60) }], 7)
      .buttons[0]![0]!.label;
    expect(label.length).toBeLessThanOrEqual(64);
    expect(label.endsWith(' · 8/32')).toBe(true);
    expect(label).toContain('…');
  });

  it('keeps the count suffix with a 60-character store', () => {
    const label = formatEventList([{ ...baseEvent, storeName: 'A'.repeat(60) }], 7)
      .buttons[0]![0]!.label;
    expect(label.slice(-7)).toBe(' · 8/32');
  });

  it('paginates nine events with a distinct next route', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ ...baseEvent, id: i + 1 }));
    const out = formatEventList(events, 7, 0, 8);
    const row = out.buttons.at(-1)!;
    expect(row[0]!.label).toBe('Page 1 of 2');
    expect(row[1]!.callbackData).toBe('event:page:1');
  });

  it('renders only previous navigation on the final page', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ ...baseEvent, id: i + 1 }));
    const out = formatEventList(events, 7, 1, 8);
    const row = out.buttons.at(-1)!;
    expect(row[0]!.callbackData).toBe('event:page:0');
    expect(row[1]!.label).toBe('Page 2 of 2');
  });
});
