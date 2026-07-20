import { describe, expect, it } from 'vitest';
import { KM_PER_MILE, kmToMiles } from './units.js';

describe('kmToMiles', () => {
  it('returns the canonical 80 km → ~50 mi conversion used by the default', () => {
    // The default config: EVENTS_RADIUS_KM=80, EVENTS_RADIUS_MI≈50.
    // This pins the value so a typo in the constant is loud.
    expect(kmToMiles(80)).toBeCloseTo(49.70968, 4);
  });

  it('is the exact reciprocal of the statute mile (1.609344 km)', () => {
    expect(KM_PER_MILE).toBeCloseTo(1 / 1.609344, 6);
  });

  it('returns 0 for 0 km', () => {
    expect(kmToMiles(0)).toBe(0);
  });
});
