import { describe, expect, it } from 'vitest';
import { Event } from '../../core/entities/event.js';
import { formatEventList } from './event-list-formatter.js';

const baseEvent: Event = {
  id: 42,
  name: 'Weekly Riftbound',
  displayStatus: 'upcoming',
  eventStatus: 'SCHEDULED',
  startDatetime: '2026-07-21T18:00:00+00:00',
  endDatetime: '2026-07-21T22:00:00+00:00',
  timezone: 'Europe/Madrid',
  capacity: 32,
  registeredCount: 8,
  startingPlayerCount: 8,
  store: {
    id: 1,
    name: 'Card Castle',
    fullAddress: '123 Main St',
    latitude: 0,
    longitude: 0,
    timezone: 'Europe/Madrid',
    country: 'ES',
  },
  gameplayFormatName: 'Standard',
  headerImageUrl: null,
  queueStatus: 'ACCEPTING_SIGNUPS',
  eventType: 'LOCALS',
  eventFormat: 'OTHER',
  description: '',
  costInCents: 0,
  currency: 'EUR',
  isOnDemand: false,
  isTestEvent: false,
  tournamentPhases: [],
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

  it('uses singular "day" for a 1-day window with one event', () => {
    const out = formatEventList([baseEvent], 1);
    expect(out.body).toBe('\uD83D\uDCC5 <b>1</b> event in the next 1 day');
  });

  it('uses singular "day" in the empty state for a 1-day window', () => {
    const out = formatEventList([], 1);
    expect(out.body).toContain('next 1 day');
  });

  it('uses plural "days" in the empty state for multi-day windows', () => {
    expect(formatEventList([], 7).body).toContain('next 7 days');
    expect(formatEventList([], 14).body).toContain('next 14 days');
  });

  it('uses singular "event" for 1 event', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.body).toBe('\uD83D\uDCC5 <b>1</b> event in the next 7 days');
  });

  it('uses plural "events" for multiple events', () => {
    const events = [
      { ...baseEvent, id: 1 },
      { ...baseEvent, id: 2 },
    ];
    const out = formatEventList(events, 7);
    expect(out.body).toMatch(/<b>2<\/b> events/);
  });

  it('produces 1 button row for 1 event', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.buttons).toHaveLength(1);
    expect(out.buttons[0]![0]!.callbackData).toBe('event:42');
  });

  it('produces 8 button rows for 8 events (fits one page)', () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      ...baseEvent,
      id: i + 1,
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7);
    expect(out.buttons).toHaveLength(8);
    expect(out.buttons[7]![0]!.callbackData).toBe('event:8');
  });

  it('produces 8 event rows + pagination row for 9 events on page 0', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({
      ...baseEvent,
      id: i + 1,
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7, 0, 8);
    expect(out.buttons).toHaveLength(9);
    const paginationRow = out.buttons[8]!;
    expect(paginationRow).toHaveLength(2);
    expect(paginationRow[0]!.label).toBe('Page 1 of 2');
    expect(paginationRow[0]!.callbackData).toBe('event:noop');
    expect(paginationRow[1]!.label).toBe('Next \u2192');
    expect(paginationRow[1]!.callbackData).toBe('event:page:1');
  });

  it('preserves caller-provided order (formatter no longer sorts)', () => {
    const events = [
      { ...baseEvent, id: 3, startDatetime: '2026-07-23T18:00:00+00:00', name: 'Late' },
      { ...baseEvent, id: 1, startDatetime: '2026-07-21T18:00:00+00:00', name: 'Early' },
      { ...baseEvent, id: 2, startDatetime: '2026-07-22T18:00:00+00:00', name: 'Middle' },
    ];
    const out = formatEventList(events, 7, 0, 8);
    expect(out.buttons).toHaveLength(3);
    expect(out.buttons[0]![0]!.callbackData).toBe('event:3');
    expect(out.buttons[1]![0]!.callbackData).toBe('event:1');
    expect(out.buttons[2]![0]!.callbackData).toBe('event:2');
  });

  it('no longer includes event name in the body', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.body).not.toContain('Weekly Riftbound');
  });

  it('no longer includes store name in the body', () => {
    const out = formatEventList([baseEvent], 7);
    expect(out.body).not.toContain('Card Castle');
  });

  // --- New button label tests ---

  it('uses button label format icon day · eventType · storeName · count', () => {
    const out = formatEventList([baseEvent], 7);
    const label = out.buttons[0]![0]!.label;
    // baseEvent.eventType = 'LOCALS' → 🔵, startDatetime 2026-07-21 → "Tue 21"
    expect(label).toBe('\uD83D\uDD35 Tue 21 · LOCALS · Card Castle · 8/32');
  });

  it('falls back to "Event" when eventType is empty', () => {
    const ev = { ...baseEvent, eventType: '' };
    const out = formatEventList([ev], 7);
    const label = out.buttons[0]![0]!.label;
    expect(label).toMatch(/^\u26AA /);
    expect(label).toContain('· Event ·');
  });

  it('preserves empty store name', () => {
    const ev = { ...baseEvent, store: { ...baseEvent.store, name: '' } };
    const out = formatEventList([ev], 7);
    const label = out.buttons[0]![0]!.label;
    expect(label).toBe('\uD83D\uDD35 Tue 21 · LOCALS ·  · 8/32');
  });

  it('truncates long store name to 64-char limit with icon prefix and … suffix', () => {
    const longStoreName = 'A'.repeat(60);
    const ev = { ...baseEvent, store: { ...baseEvent.store, name: longStoreName } };
    const out = formatEventList([ev], 7);
    const label = out.buttons[0]![0]!.label;
    // Label should be at most 64 chars
    expect(label.length).toBeLessThanOrEqual(64);
    // Starts with 🔵 icon prefix (baseEvent.eventType = 'LOCALS')
    expect(label).toMatch(/^\uD83D\uDD35 Tue 21/);
    // Ends with … (right tail truncated, count is cut first)
    expect(label.endsWith('…')).toBe(true);
  });

  it('preserves count in label for borderline-length store name', () => {
    // 32-char storeName fits exactly with eventType='LOCALS' (🔵):
    // 🔵(2) (1) ·(3) Tue 21(6) ·(3) LOCALS(6) ·(3) <storeName>(32) ·(3) 8/32(4) = 63
    const borderlineStoreName = 'A'.repeat(32); // 32 chars
    const ev = { ...baseEvent, store: { ...baseEvent.store, name: borderlineStoreName } };
    const out = formatEventList([ev], 7);
    const label = out.buttons[0]![0]!.label;
    expect(label.length).toBeLessThanOrEqual(64);
    expect(label).toMatch(/^\uD83D\uDD35 Tue 21/);
    expect(label).toContain('8/32');
    expect(label.endsWith('…')).toBe(false); // not truncated
  });

  it('label never exceeds 64 chars for very long store name', () => {
    const veryLongStoreName = 'Super Duper Mega Hyper Ultra Long Card Game Store Name That Goes On Forever And Ever';
    const ev = { ...baseEvent, store: { ...baseEvent.store, name: veryLongStoreName } };
    const out = formatEventList([ev], 7);
    const label = out.buttons[0]![0]!.label;
    expect(label.length).toBeLessThanOrEqual(64);
  });

  it('includes pagination row on the last page with only Prev', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({
      ...baseEvent,
      id: i + 1,
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7, 1, 8);
    expect(out.buttons).toHaveLength(2);
    const paginationRow = out.buttons[1]!;
    expect(paginationRow).toHaveLength(2);
    expect(paginationRow[0]!.label).toBe('\u2190 Prev');
    expect(paginationRow[0]!.callbackData).toBe('event:page:0');
    expect(paginationRow[1]!.label).toBe('Page 2 of 2');
    expect(paginationRow[1]!.callbackData).toBe('event:noop');
  });

  it('includes prev and next on middle pages', () => {
    const events = Array.from({ length: 17 }, (_, i) => ({
      ...baseEvent,
      id: i + 1,
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7, 1, 8);
    expect(out.buttons).toHaveLength(9);
    const paginationRow = out.buttons[8]!;
    expect(paginationRow).toHaveLength(3);
    expect(paginationRow[0]!.label).toBe('\u2190 Prev');
    expect(paginationRow[0]!.callbackData).toBe('event:page:0');
    expect(paginationRow[1]!.label).toBe('Page 2 of 3');
    expect(paginationRow[1]!.callbackData).toBe('event:noop');
    expect(paginationRow[2]!.label).toBe('Next \u2192');
    expect(paginationRow[2]!.callbackData).toBe('event:page:2');
  });

  it('no pagination row when events fit on one page', () => {
    const events = Array.from({ length: 3 }, (_, i) => ({
      ...baseEvent,
      id: i + 1,
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7, 0, 8);
    expect(out.buttons).toHaveLength(3);
  });

  it('clamps negative page to 0', () => {
    const out = formatEventList([baseEvent], 7, -5, 8);
    expect(out.buttons).toHaveLength(1);
    expect(out.buttons[0]![0]!.callbackData).toBe('event:42');
  });

  it('clamps out-of-range page to last valid page', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({
      ...baseEvent,
      id: i + 1,
      name: `Event ${i + 1}`,
    }));
    const out = formatEventList(events, 7, 99, 8);
    expect(out.buttons).toHaveLength(2);
    const paginationRow = out.buttons[1]!;
    expect(paginationRow[0]!.label).toBe('\u2190 Prev');
  });

  // --- Event-type icon mapping tests ---

  it('maps "LOCALS" to \uD83D\uDD35', () => {
    const ev = { ...baseEvent, eventType: 'LOCALS' };
    const out = formatEventList([ev], 7);
    expect(out.buttons[0]![0]!.label.startsWith('\uD83D\uDD35 ')).toBe(true);
  });

  it('maps "CONVENTIONS" to \uD83D\uDFE3', () => {
    const ev = { ...baseEvent, eventType: 'CONVENTIONS' };
    const out = formatEventList([ev], 7);
    expect(out.buttons[0]![0]!.label.startsWith('\uD83D\uDFE3 ')).toBe(true);
  });

  it('maps lowercase "conventions" to \uD83D\uDFE3 (case-insensitive)', () => {
    const ev = { ...baseEvent, eventType: 'conventions' };
    const out = formatEventList([ev], 7);
    expect(out.buttons[0]![0]!.label.startsWith('\uD83D\uDFE3 ')).toBe(true);
  });

  it('maps unknown eventType to \u26AA', () => {
    const ev = { ...baseEvent, eventType: 'OTHER' };
    const out = formatEventList([ev], 7);
    expect(out.buttons[0]![0]!.label.startsWith('\u26AA ')).toBe(true);
  });

  it('icon for empty eventType is \u26AA', () => {
    const ev = { ...baseEvent, eventType: '' };
    const out = formatEventList([ev], 7);
    expect(out.buttons[0]![0]!.label.startsWith('\u26AA ')).toBe(true);
  });
});
