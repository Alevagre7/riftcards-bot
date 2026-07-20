import { describe, expect, it } from 'vitest';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { formatEventDetail } from './event-detail-formatter.js';

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

const registrations: EventRegistration[] = [
  { name: 'Alice', status: 'COMPLETE' },
  { name: 'Bob', status: 'PENDING' },
];

describe('formatEventDetail', () => {
  it('includes the event name in an HTML bold header', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('<b>Weekly Riftbound</b>');
  });

  it('includes date, time and timezone', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('Europe/Madrid');
    expect(out).toContain('Jul');
  });

  it('includes store name', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('Card Castle');
  });

  it('includes store address when present', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('123 Main St');
  });

  it('omits store address line when empty', () => {
    const ev = { ...baseEvent, storeAddress: '' };
    const out = formatEventDetail(ev, []);
    expect(out).not.toContain('\uD83D\uDCCD');
  });

  it('includes format and category', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('Standard');
    expect(out).toContain('LOCALS');
  });

  it('omits format/category line when both are empty', () => {
    const ev = { ...baseEvent, format: '', category: '' };
    const out = formatEventDetail(ev, []);
    expect(out).not.toContain('\uD83C\uDFAE');
  });

  it('shows capacity with meeting type when present', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('8/32');
    expect(out).toContain('Player Meeting');
  });

  it('shows capacity without meeting type when absent', () => {
    const ev = { ...baseEvent, meetingType: '' };
    const out = formatEventDetail(ev, []);
    expect(out).toContain('8/32');
    expect(out).not.toContain('Player Meeting');
  });

  it('shows "Free" for free events', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('Free');
  });

  it('shows formatted cost for paid events', () => {
    const ev = {
      ...baseEvent,
      isFree: false,
      costAmount: 35,
      costCurrency: 'EUR',
    };
    const out = formatEventDetail(ev, []);
    expect(out).toContain('\u20AC'); // € symbol
  });

  it('shows cost with fallback currency when currency is empty', () => {
    const ev = {
      ...baseEvent,
      isFree: false,
      costAmount: 20,
      costCurrency: '',
    };
    const out = formatEventDetail(ev, []);
    // Falls back to EUR
    expect(out).toContain('\u20AC');
  });

  it('omits cost line for free events', () => {
    const ev = { ...baseEvent, isFree: true, costAmount: null, costCurrency: '' };
    const out = formatEventDetail(ev, []);
    expect(out).toContain('Free');
  });

  it('shows players section with registrations', () => {
    const out = formatEventDetail(baseEvent, registrations);
    expect(out).toContain('Players (2):');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).toContain('COMPLETE');
    expect(out).toContain('PENDING');
  });

  it('omits players section when registrations is empty', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).not.toContain('Players');
  });

  it('shows "Players: unavailable" when registrations is unavailable', () => {
    const out = formatEventDetail(baseEvent, 'unavailable');
    expect(out).toContain('Players: unavailable');
  });

  it('includes locator URL', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('https://locator.riftbound.uvsgames.com/events/42');
  });

  it('uses newline separators', () => {
    const out = formatEventDetail(baseEvent, []);
    expect(out).toContain('\n');
  });
});
