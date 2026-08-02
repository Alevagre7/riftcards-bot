import { describe, expect, it } from 'vitest';
import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { Event } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { formatEventDetail } from './event-detail-formatter.js';

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
  headerImageUrl: 'https://example.com/banner.jpg',
  queueStatus: 'ACCEPTING_SIGNUPS',
  eventType: 'LOCALS',
  eventFormat: 'OTHER',
  description: 'Weekly tournament with prizes for top players.',
  costInCents: 0,
  currency: 'EUR',
  isOnDemand: false,
  isTestEvent: false,
  tournamentPhases: [],
};

const registrations: EventRegistration[] = [
  { id: 1, name: 'Alice', status: 'Active', profileImageUrl: null, matchesWon: 2, matchesLost: 1, matchesDrawn: 0, isGuest: false, finalPlaceInStandings: 3 },
  { id: 2, name: 'Bob', status: 'Dropped', profileImageUrl: null, matchesWon: 0, matchesLost: 0, matchesDrawn: 0, isGuest: false, finalPlaceInStandings: null },
];

describe('formatEventDetail', () => {
  function body(event: Event = baseEvent, reg: readonly EventRegistration[] | 'unavailable' = []): string {
    return formatEventDetail(event, reg).body;
  }

  it('includes the event name in an HTML bold header', () => {
    expect(body()).toContain('<b>Weekly Riftbound</b>');
  });

  it('includes date, time and the event timezone', () => {
    expect(body()).toContain('Europe/Madrid');
    expect(body()).toContain('Jul');
  });

  it('falls back safely when upstream date metadata is invalid', () => {
    const ev = {
      ...baseEvent,
      timezone: 'Not/AZone',
      startDatetime: 'not-a-date',
      endDatetime: 'also-not-a-date',
      currency: 'not-a-currency',
      costInCents: 3500,
    };

    const out = body(ev);

    expect(out).toContain('Time unavailable (UTC)');
    expect(out).toContain('35.00 not-a-currency');
  });

  it('includes store name', () => {
    expect(body()).toContain('Card Castle');
  });

  it('includes store address when present', () => {
    expect(body()).toContain('123 Main St');
  });

  it('omits store address line when empty', () => {
    const ev = { ...baseEvent, store: { ...baseEvent.store, fullAddress: '' } };
    expect(body(ev)).not.toContain('\uD83D\uDCCD');
  });

  it('includes gameplay format and event type', () => {
    expect(body()).toContain('Standard');
    expect(body()).toContain('LOCALS');
  });

  it('omits format line when both format and type are empty', () => {
    const ev = { ...baseEvent, gameplayFormatName: '', eventType: '' };
    expect(body(ev)).not.toContain('\uD83C\uDFAE');
  });

  it('shows capacity as bold registered/max players', () => {
    expect(body()).toContain('<b>8/32</b> players');
  });

  it('shows "Free" when costInCents is 0', () => {
    expect(body()).toContain('Free');
  });

  it('shows formatted cost when costInCents is non-zero', () => {
    const ev = { ...baseEvent, costInCents: 3500, currency: 'EUR' };
    expect(body(ev)).toContain('\u20AC35.00');
  });

  it('omits cost line when costInCents is null', () => {
    const ev = { ...baseEvent, costInCents: null };
    expect(body(ev)).not.toContain('\uD83D\uDCB0');
  });

  it('shows players section with registrations', () => {
    const out = body(baseEvent, registrations);
    expect(out).toContain('Players (2):');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).toContain('Active');
    expect(out).toContain('Dropped');
  });

  it('omits players section when registrations is empty', () => {
    expect(body()).not.toContain('Players');
  });

  it('shows "Players: unavailable" when registrations is unavailable', () => {
    expect(body(baseEvent, 'unavailable')).toContain('Players: unavailable');
  });

  it('includes description when present', () => {
    expect(body()).toContain('Weekly tournament with prizes for top players.');
  });

  it('omits description when empty', () => {
    const ev = { ...baseEvent, description: '' };
    expect(body(ev)).not.toContain('\uD83D\uDCDD');
  });

  it('includes the synthesized locator URL using the numeric id', () => {
    expect(body()).toContain('https://locator.riftbound.uvsgames.com/events/42');
  });

  it('does not leak stale legacy fields (price/externalUrl/meetingType)', () => {
    const out = body();
    expect(out).not.toContain('externalUrl');
    expect(out).not.toContain('Player Meeting');
    expect(out).not.toContain('meetingType');
  });

  it('uses newline separators', () => {
    expect(body()).toContain('\n');
  });

  // --- Button tests ---

  it('returns buttons with Leaderboard, All tables, and Back when isStarted is true', () => {
    const result = formatEventDetail(baseEvent, [], { isStarted: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).toContain('\uD83D\uDCCB All tables');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('returns buttons with Leaderboard, All tables, and Back when isStarted is undefined (fallback)', () => {
    const result = formatEventDetail(baseEvent, []);
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).toContain('\uD83D\uDCCB All tables');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('omits Leaderboard and All tables when isStarted is false', () => {
    const result = formatEventDetail(baseEvent, [], { isStarted: false });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).not.toContain('\uD83D\uDCCB All tables');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('shows Watch button alongside Leaderboard when isStarted is true and privateChat', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true, isStarted: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).toContain('\uD83D\uDC41 Watch');
  });

  it('shows Watch for an upcoming event even when isStarted is false', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true, isStarted: false });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).not.toContain('\uD83D\uDCCB All tables');
    expect(texts).toContain('\uD83D\uDC41 Watch');
    expect(texts).toContain('\u2190 Back to list');
  });

  it('omits Watch for completed events while retaining completed-event views', () => {
    const result = formatEventDetail(
      { ...baseEvent, displayStatus: 'complete' },
      [],
      { privateChat: true },
    );
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('\uD83D\uDC41 Watch');
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).toContain('\uD83D\uDCCB All tables');
  });

  it('includes Watch button in private chat', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).toContain('\uD83D\uDC41 Watch');
  });

  it('omits Watch button when not in private chat', () => {
    const result = formatEventDetail(baseEvent, []);
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('\uD83D\uDC41 Watch');
  });

  it('uses leaderboard callback_data for Leaderboard button', () => {
    const result = formatEventDetail(baseEvent, [], { isStarted: true });
    const btn = result.buttons.flat().find(
      (b): b is InlineKeyboardButton.CallbackButton => b.text === '\uD83C\uDFC6 Leaderboard' && 'callback_data' in b,
    );
    expect(btn?.callback_data).toBe('event:42:leaderboard');
  });

  it('uses correct callback_data for Watch button', () => {
    const result = formatEventDetail(baseEvent, [], { privateChat: true });
    const watchBtn = result.buttons.flat().find(
      (b): b is InlineKeyboardButton.CallbackButton => b.text === '\uD83D\uDC41 Watch' && 'callback_data' in b,
    );
    expect(watchBtn?.callback_data).toBe('event:42:watch:start');
  });

  it('shows the active player and management action for the current event', () => {
    const result = formatEventDetail(baseEvent, [], {
      privateChat: true,
      watchState: { kind: 'current', username: 'Alice' },
    });
    const button = result.buttons.flat().find((candidate) => candidate.text === '👁 Watching Alice');
    expect(button && 'callback_data' in button ? button.callback_data : undefined).toBe('watch:show');
  });

  it('shows Change watch when the active watch belongs to another event', () => {
    const result = formatEventDetail(baseEvent, [], {
      privateChat: true,
      watchState: { kind: 'other' },
    });
    const button = result.buttons.flat().find((candidate) => candidate.text === '👁 Change watch');
    expect(button && 'callback_data' in button ? button.callback_data : undefined).toBe('event:42:watch:start');
  });

  it('omits "Back to list" when showBackToList is false (event-id path)', () => {
    const result = formatEventDetail(baseEvent, [], { showBackToList: false });
    const texts = result.buttons.flat().map((b) => b.text);
    expect(texts).not.toContain('\u2190 Back to list');
    // Other buttons still present
    expect(texts).toContain('\uD83C\uDFC6 Leaderboard');
    expect(texts).toContain('\uD83D\uDCCB All tables');
  });
});
