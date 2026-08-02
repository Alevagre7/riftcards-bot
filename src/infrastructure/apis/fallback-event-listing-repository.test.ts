import { describe, expect, it, vi } from 'vitest';
import { FallbackEventListingRepository } from './fallback-event-listing-repository.js';
import { EventListing } from '../../core/entities/event-listing.js';
import { EventLocation } from '../../core/ports/event-repository.js';

const location: EventLocation = { latitude: 0, longitude: 0, numMiles: 25 };
const listing: EventListing = {
  id: 1,
  name: 'Official Event',
  startDatetime: '2026-08-01T10:00:00Z',
  endDatetime: '2026-08-01T14:00:00Z',
  mode: 'Other',
  storeName: 'Store',
  registeredCount: 0,
  capacity: 32,
};

function repo(result: EventListing[] | Error) {
  return {
    getEvents: vi.fn().mockImplementation(() => result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
  };
}

describe('FallbackEventListingRepository', () => {
  it('returns primary data without calling fallback', async () => {
    const primary = repo([listing]);
    const fallback = repo([]);
    const out = await new FallbackEventListingRepository(primary, fallback).getEvents(new Date(1), new Date(2), location);
    expect(out).toEqual([listing]);
    expect(fallback.getEvents).not.toHaveBeenCalled();
  });

  it('falls back on primary errors and logs the provider switch', async () => {
    const primary = repo(new Error('network'));
    const fallback = repo([listing]);
    const logger = vi.fn();
    const out = await new FallbackEventListingRepository(primary, fallback, logger)
      .getEvents(new Date(1), new Date(2), location);
    expect(out).toEqual([listing]);
    expect(logger).toHaveBeenCalledWith(
      '[Events] Riftfound listing failed; using official V2 fallback:',
      expect.any(Error),
    );
  });

  it('does not fall back after a successful empty primary response', async () => {
    const primary = repo([]);
    const fallback = repo([listing]);
    const out = await new FallbackEventListingRepository(primary, fallback)
      .getEvents(new Date(1), new Date(2), location);
    expect(out).toEqual([]);
    expect(fallback.getEvents).not.toHaveBeenCalled();
  });

  it('propagates fallback errors', async () => {
    const primary = repo(new Error('primary'));
    const fallback = repo(new Error('fallback'));
    await expect(new FallbackEventListingRepository(primary, fallback)
      .getEvents(new Date(1), new Date(2), location)).rejects.toThrow('fallback');
  });
});
