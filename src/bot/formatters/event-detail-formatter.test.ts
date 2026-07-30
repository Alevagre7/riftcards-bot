import { describe, expect, it } from 'vitest';
import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
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
  eventType: 'Nexus Night',
  price: 'Free',
  description: 'Weekly tournament with prizes for top players.',
  imageUrl: 'https://www.riftfound.com/banners/event.jpg',
  externalUrl: 'https://riftfound.com/events/123',
  locatorEventId: 42,
};

const registrations: EventRegistration[] = [
  { name: 'Alice', status: 'Registered' },
  { name: 'Bob', status: 'Pending' },
];

describe('formatEventDetail', () => {
  function body(event: Event = baseEvent, reg: readonly EventRegistration[] | 'unavailable' = []): string {
    return formatEventDetail(event, reg).body;
  }

  it('includes the event name in an HTML bold header', () => {
    expect(body()).toContain('<b>Weekly Riftbound</b>');
  });

  it('includes date, time and timezone', () => {
    expect(body()).toContain('Europe/Madrid');
    expect(body()).toContain('Jul');
  });

  it('includes store name', () => {
    expect(body()).toContain('Card Castle');
  });

  it('includes store address when present', () => {
    expect(body()).toContain('123 Main St');
  });

  it('omits store address line when empty', () => {
    const ev = { ...baseEvent, storeAddress: '' };
    expect(body(ev)).not.toContain('\uD83D\uDCCD');
  });

  it('includes format and category', () => {
    expect(body()).toContain('Standard');
    expect(body()).toContain('LOCALS');
  });

  it('omits format/category line when both are empty', () => {
    const ev = { ...baseEvent, format: '', category: '' };
    expect(body(ev)).not.toContain('\uD83C\uDFAE');
  });

  it('shows capacity with meeting type when present', () => {
    expect(body()).toContain('8/32');
    expect(body()).toContain('Player Meeting');
  });

  it('shows capacity without meeting type when absent', () => {
    const ev = { ...baseEvent, meetingType: '' };
    expect(body(ev)).toContain('8/32');
    expect(body(ev)).not.toContain('Player Meeting');
  });

  it('shows "Free" for free events via price string', () => {
    expect(body()).toContain('Free');
  });

  it('shows formatted cost for paid events via price string', () => {
    const ev = { ...baseEvent, price: '\u20AC6.00', isFree: false };
    expect(body(ev)).toContain('\u20AC6.00');
  });

  it('falls back to isFree/costAmount when price is empty', () => {
    const ev = { ...baseEvent, price: '', isFree: false, costAmount: 35, costCurrency: 'EUR' };
    expect(body(ev)).toContain('\u20AC');
  });

  it('falls back to isFree true when price is empty', () => {
    const ev = { ...baseEvent, price: '', isFree: true, costAmount: null, costCurrency: '' };
    expect(body(ev)).toContain('Free');
  });

  it('shows cost with fallback currency when currency is empty', () => {
    const ev = { ...baseEvent, price: '', isFree: false, costAmount: 20, costCurrency: '' };
    expect(body(ev)).toContain('\u20AC');
  });

  it('shows players section with registrations', () => {
    const out = body(baseEvent, registrations);
    expect(out).toContain('Players (2):');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).toContain('Registered');
    expect(out).toContain('Pending');
  });

  it('omits players section when registrations is empty', () => {
    expect(body()).not.toContain('Players');
  });

  it('shows "Players: unavailable" when registrations is unavailable', () => {
    expect(body(baseEvent, 'unavailable')).toContain('Players: unavailable');
  });

  it('includes eventType when present', () => {
    expect(body()).toContain('Nexus Night');
  });

  it('omits eventType line when empty', () => {
    const ev = { ...baseEvent, eventType: '' };
    expect(body(ev)).not.toContain('\uD83C\uDFAF');
  });

  it('includes description when present', () => {
    expect(body()).toContain('Weekly tournament with prizes for top players.');
  });

  it('omits description when empty', () => {
    const ev = { ...baseEvent, description: '' };
    expect(body(ev)).not.toContain('\uD83D\uDCDD');
  });

  it('includes externalUrl link when non-null', () => {
    expect(body()).toContain('https://riftfound.com/events/123');
  });

  it('omits externalUrl line when null', () => {
    const ev = { ...baseEvent, externalUrl: null };
    expect(body(ev)).not.toContain('\uD83D\uDD17');
  });

  it('includes locator URL', () => {
    expect(body()).toContain('https://locator.riftbound.uvsgames.com/events/42');
  });

  it('uses newline separators', () => {
    expect(body()).toContain('\n');
  });

  // --- Button tests ---

  it('returns buttons with Leaderboard, All tables, and Back when isStarted is true', () => {
    const result = formatEventDetail(baseEvent, [], { isStarted: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('Leaderboard');
    expect(texts).toContain('All tables');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('returns buttons with Leaderboard, All tables, and Back when isStarted is undefined (fallback)', () => {
    const result = formatEventDetail(baseEvent, []);
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('Leaderboard');
    expect(texts).toContain('All tables');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('omits Leaderboard and All tables when isStarted is false', () => {
    const result = formatEventDetail(baseEvent, [], { isStarted: false });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('Leaderboard');
    expect(texts).not.toContain('All tables');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('shows Watch button alongside Leaderboard when isStarted is true and privateChat', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true, isStarted: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('Leaderboard');
    expect(texts).toContain('Watch');
  });

  it('shows Watch button without Leaderboard when isStarted is false and privateChat', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true, isStarted: false });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('Leaderboard');
    expect(texts).not.toContain('All tables');
    expect(texts).toContain('Watch');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('includes Watch button only in privateChat with locatorEventId', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('Watch');
  });

  it('omits Watch button when not in private chat', () => {
    const result = formatEventDetail(baseEvent, []);
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('Watch');
  });

  it('omits Watch button when locatorEventId is missing', () => {
    const { locatorEventId: _, ...ev } = { ...baseEvent, locatorEventId: undefined as undefined };
    const result = formatEventDetail(ev, [], { privateChat: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('Watch');
  });

  it('uses leaderboard callback_data for Leaderboard button', () => {
    const result = formatEventDetail(baseEvent, [], { isStarted: true });
    const btn = result.buttons.flat().find(
      (b): b is InlineKeyboardButton.CallbackButton => b.text === 'Leaderboard' && 'callback_data' in b,
    );
    expect(btn?.callback_data).toBe('event:42:leaderboard');
  });

  it('uses correct callback_data for Watch button', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true });
    const watchBtn = result.buttons.flat().find(
      (b): b is InlineKeyboardButton.CallbackButton => b.text === 'Watch' && 'callback_data' in b,
    );
    expect(watchBtn?.callback_data).toBe('event:42:watch:start');
  });
});
