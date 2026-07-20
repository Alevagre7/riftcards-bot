import { describe, expect, it } from 'vitest';
import { Event } from '../../core/entities/event.js';
import { formatEventList } from './event-list-formatter.js';

const baseEvent: Event = {
  id: '42',
  name: 'Weekly Riftbound',
  storeName: 'Card Castle',
  storeAddress: '123 Main St',
  storeWebsite: '',
  storeEmail: '',
  startDate: new Date('2026-07-21T18:00:00Z'),
  endDate: new Date('2026-07-21T22:00:00Z'),
  format: 'Standard',
  category: 'LOCALS',
  meetingType: 'Player Meeting',
  capacity: { registered: 8, max: 32 },
  isFree: true,
  costAmount: null,
  costCurrency: '',
  locatorUrl: 'https://locator.riftbound.uvsgames.com/events/42',
};

describe('formatEventList', () => {
  it('returns empty body and no buttons when the list is empty', () => {
    const out = formatEventList([], 7);
    expect(out.body).toMatch(/No events found/);
    expect(out.buttons).toHaveLength(0);
  });

  it('echoes the daysAhead value in the header (default 7)', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.body).toContain('next 7 days');
  });

  it('echoes the daysAhead value for a 14-day window', () => {
    const out = formatEventList([baseEvent], 14);
    expect(out.body).toContain('next 14 days');
  });

  it('uses singular "day" for a 1-day window', () => {
    const out = formatEventList([baseEvent], 1);
    expect(out.body).toContain('next 1 day');
    expect(out.body).not.toContain('next 1 days');
  });

  it('uses singular "day" in the empty state for a 1-day window', () => {
    const out = formatEventList([], 1);
    expect(out.body).toContain('next 1 day');
  });

  it('uses plural "days" in the empty state for multi-day windows', () => {
    expect(formatEventList([], 7).body).toContain('next 7 days');
    expect(formatEventList([], 14).body).toContain('next 14 days');
  });

  it('produces 1 button row for 1 event', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.buttons).toHaveLength(1);
    expect(out.buttons[0]![0]!.callbackData).toBe('event:42');
  });

  it('produces 8 button rows for 8 events (max before Show all)', () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      ...baseEvent,
      id: String(i + 1),
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7);
    // 8 events → 8 rows (no Show all)
    expect(out.buttons).toHaveLength(8);
    expect(out.buttons[7]![0]!.callbackData).toBe('event:8');
  });

  it('produces 8 event rows + Show all for 9 events', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({
      ...baseEvent,
      id: String(i + 1),
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7);
    expect(out.buttons).toHaveLength(9); // 8 event rows + 1 Show all
    const lastRow = out.buttons[8]!;
    expect(lastRow).toHaveLength(1);
    expect(lastRow[0]!.label).toContain('Show all');
    expect(lastRow[0]!.callbackData).toBe('event:list:show-all');
  });

  it('sorts events by startDate ascending', () => {
    const events = [
      { ...baseEvent, id: '3', startDate: new Date('2026-07-23T18:00:00Z'), name: 'Late' },
      { ...baseEvent, id: '1', startDate: new Date('2026-07-21T18:00:00Z'), name: 'Early' },
      { ...baseEvent, id: '2', startDate: new Date('2026-07-22T18:00:00Z'), name: 'Middle' },
    ];
    const out = formatEventList(events, 7);
    expect(out.buttons).toHaveLength(3);
    expect(out.buttons[0]![0]!.callbackData).toBe('event:1');
    expect(out.buttons[1]![0]!.callbackData).toBe('event:2');
    expect(out.buttons[2]![0]!.callbackData).toBe('event:3');
  });

  it('includes event name in the body with HTML bold tags', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.body).toContain('<b>Weekly Riftbound</b>');
  });

  it('includes store name in the body date line', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.body).toContain('Card Castle');
  });
});
