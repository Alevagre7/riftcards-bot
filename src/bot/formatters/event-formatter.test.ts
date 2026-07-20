import { describe, expect, it } from 'vitest';
import { Event } from '../../core/entities/event.js';
import { formatEventList } from './event-formatter.js';

const sampleEvent: Event = {
  name: 'Weekly Riftbound',
  storeName: 'Card Castle',
  startDate: new Date('2026-07-21T18:00:00Z'),
  endDate: new Date('2026-07-21T22:00:00Z'),
  format: 'Standard',
};

describe('formatEventList', () => {
  it('returns a "no events" message when the list is empty', () => {
    const out = formatEventList([], 7);
    expect(out).toMatch(/No events found/);
  });

  it('echoes the daysAhead value in the header (default 7)', () => {
    const out = formatEventList([sampleEvent], 7);
    expect(out).toContain('next 7 days');
  });

  it('echoes the daysAhead value for a 14-day window', () => {
    // Without this, an operator setting EVENTS_DAYS_AHEAD=14
    // would see "next 7 days" in the header.
    const out = formatEventList([sampleEvent], 14);
    expect(out).toContain('next 14 days');
  });

  it('uses singular "day" for a 1-day window', () => {
    const out = formatEventList([sampleEvent], 1);
    expect(out).toContain('next 1 day');
    expect(out).not.toContain('next 1 days');
  });

  it('uses singular "day" in the empty state for a 1-day window', () => {
    const out = formatEventList([], 1);
    expect(out).toContain('next 1 day');
  });

  it('uses plural "days" in the empty state for multi-day windows', () => {
    expect(formatEventList([], 7)).toContain('next 7 days');
    expect(formatEventList([], 14)).toContain('next 14 days');
  });
});
