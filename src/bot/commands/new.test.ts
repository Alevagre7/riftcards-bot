import { describe, expect, it } from 'vitest';
import { Card } from '../../core/entities/card.js';
import { isToday, startOfUtcDay } from './new.js';

const card = (updatedOn: string): Card => ({
  id: 'ogn-001/1',
  name: 'Test Card',
  setCode: 'ogn',
  collectorNumber: '1',
  rarity: 'Common',
  type: 'Unit',
  keywords: [],
  updatedOn,
});

describe('new command UTC date helpers', () => {
  const day = startOfUtcDay(new Date('2026-08-02T18:30:00Z'));

  it('uses the UTC calendar day regardless of the host timezone', () => {
    expect(day.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('accepts timestamps with offsets on the selected UTC day', () => {
    expect(isToday(card('2026-08-02T01:00:00+01:00'), day)).toBe(true);
    expect(isToday(card('2026-08-02T23:59:59.999Z'), day)).toBe(true);
  });

  it('excludes adjacent days, future timestamps, and malformed dates', () => {
    expect(isToday(card('2026-08-01T23:59:59.999Z'), day)).toBe(false);
    expect(isToday(card('2026-08-03T00:00:00.000Z'), day)).toBe(false);
    expect(isToday(card('not-a-date'), day)).toBe(false);
  });
});
