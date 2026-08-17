import { describe, expect, it, vi } from 'vitest';
import { EventListing } from '../../core/entities/event-listing.js';
import { createEventNavigationContext } from './event-navigation-context.js';

const LISTING_A: EventListing = {
  id: 100,
  name: 'Event A',
  startDatetime: '2026-08-01T10:00:00Z',
  endDatetime: '2026-08-01T14:00:00Z',
  timezone: 'UTC',
  mode: 'Skirmish',
  storeName: 'Store A',
  registeredCount: 8,
  capacity: 32,
};

const LISTING_B: EventListing = {
  id: 200,
  name: 'Event B',
  startDatetime: '2026-08-02T10:00:00Z',
  endDatetime: '2026-08-02T14:00:00Z',
  timezone: 'UTC',
  mode: 'Nexus Night',
  storeName: 'Store B',
  registeredCount: 4,
  capacity: 16,
};

const LISTING_C: EventListing = {
  id: 300,
  name: 'Event C',
  startDatetime: '2026-08-03T10:00:00Z',
  endDatetime: '2026-08-03T14:00:00Z',
  timezone: 'UTC',
  mode: 'Other',
  storeName: 'Store C',
  registeredCount: 2,
  capacity: 8,
};

const LIST_TTL_MS = 5 * 60 * 1000;
const DIRECT_TTL_MS = 30 * 60 * 1000;

function makeClock() {
  let now = 1_000_000;
  const clock = vi.fn(() => now);
  return {
    clock,
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

describe('createEventNavigationContext', () => {
  it('remembers and retrieves a TelegramUser Event list context', () => {
    const { clock } = makeClock();
    const navigation = createEventNavigationContext(clock);
    const listings = [LISTING_B, LISTING_A] as const;

    navigation.rememberEventList(123, listings, 14);

    expect(navigation.getEventList(123)).toEqual({
      events: listings,
      daysAhead: 14,
    });
  });

  it('returns null for missing list context', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    expect(navigation.getEventList(123)).toBeNull();
  });

  it('does not show Back to list without a live list context', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(false);
  });

  it('expires list context at five minutes and evicts it lazily', () => {
    const { clock, advance } = makeClock();
    const navigation = createEventNavigationContext(clock);

    navigation.rememberEventList(123, [LISTING_A], 7);
    advance(LIST_TTL_MS - 1);
    expect(navigation.getEventList(123)).not.toBeNull();

    advance(1);
    expect(navigation.getEventList(123)).toBeNull();

    navigation.rememberEventList(123, [LISTING_B], 14);
    expect(navigation.getEventList(123)).toEqual({
      events: [LISTING_B],
      daysAhead: 14,
    });
  });

  it('isolates list contexts by TelegramUser', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    navigation.rememberEventList(123, [LISTING_A], 7);
    navigation.rememberEventList(456, [LISTING_B], 14);

    expect(navigation.getEventList(123)).toEqual({ events: [LISTING_A], daysAhead: 7 });
    expect(navigation.getEventList(456)).toEqual({ events: [LISTING_B], daysAhead: 14 });
  });

  it('does not create or read state for an undefined TelegramUser id', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    navigation.rememberEventList(undefined, [LISTING_A], 7);
    navigation.openEventDirectly(undefined, LISTING_A.id);
    navigation.openEventFromList(undefined, LISTING_A.id);

    expect(navigation.getEventList(undefined)).toBeNull();
    expect(navigation.shouldShowBackToList(undefined, LISTING_A.id)).toBe(false);

    navigation.rememberEventList(123, [LISTING_A], 7);
    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(true);
  });

  it('direct-open clears the list context and records direct origin', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    navigation.rememberEventList(123, [LISTING_A, LISTING_B], 7);
    navigation.openEventDirectly(123, LISTING_A.id);

    expect(navigation.getEventList(123)).toBeNull();

    navigation.rememberEventList(123, [LISTING_A, LISTING_B], 7);
    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(false);
    expect(navigation.shouldShowBackToList(123, LISTING_B.id)).toBe(true);
  });

  it('expires direct origin at thirty minutes and evicts it lazily', () => {
    const { clock, advance } = makeClock();
    const navigation = createEventNavigationContext(clock);

    navigation.openEventDirectly(123, LISTING_A.id);
    advance(DIRECT_TTL_MS - 1);
    navigation.rememberEventList(123, [LISTING_A], 7);
    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(false);

    advance(1);
    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(true);

    navigation.openEventDirectly(123, LISTING_A.id);
    navigation.rememberEventList(123, [LISTING_A], 7);
    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(false);
  });

  it('list-open clears only the selected Event direct-origin marker', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    navigation.openEventDirectly(123, LISTING_A.id);
    navigation.openEventDirectly(123, LISTING_B.id);
    navigation.rememberEventList(123, [LISTING_A, LISTING_B, LISTING_C], 7);

    navigation.openEventFromList(123, LISTING_A.id);

    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(true);
    expect(navigation.shouldShowBackToList(123, LISTING_B.id)).toBe(false);
    expect(navigation.shouldShowBackToList(123, LISTING_C.id)).toBe(true);
  });

  it('isolates direct origin by TelegramUser and Event', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    navigation.openEventDirectly(123, LISTING_A.id);
    navigation.rememberEventList(123, [LISTING_A, LISTING_B], 7);
    navigation.rememberEventList(456, [LISTING_A, LISTING_B], 14);

    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(false);
    expect(navigation.shouldShowBackToList(123, LISTING_B.id)).toBe(true);
    expect(navigation.shouldShowBackToList(456, LISTING_A.id)).toBe(true);
  });

  it('keeps direct-origin state independent when a list is remembered', () => {
    const navigation = createEventNavigationContext(() => 1_000_000);

    navigation.openEventDirectly(123, LISTING_A.id);
    navigation.rememberEventList(123, [LISTING_A], 7);

    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(false);

    navigation.openEventFromList(123, LISTING_A.id);
    expect(navigation.shouldShowBackToList(123, LISTING_A.id)).toBe(true);
  });
});
