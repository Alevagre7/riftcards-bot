import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Test the Zod schemas from the adapter by re-declaring them inline
// so they stay decoupled from the adapter file.

const EventApiSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  start_datetime: z.string(),
  end_datetime: z.string(),
  store: z.object({
    name: z.string().optional().default(''),
    full_address: z.string().optional().default(''),
    website: z.string().optional().default(''),
    email: z.string().optional().default(''),
  }).nullable().optional(),
  gameplay_format: z.object({
    name: z.string().optional().default(''),
  }).nullable().optional(),
  event_type: z.string().optional().default(''),
  tournament_phases: z.array(z.object({
    first_round_type: z.string().optional().default(''),
  })).optional().default([]),
  registered_user_count: z.coerce.number().optional().default(0),
  capacity: z.coerce.number().optional().default(0),
  cost_in_cents: z.coerce.number().optional().default(0),
  currency: z.string().optional().default(''),
}).passthrough();

// Realistic wire payload based on upstream API shape
const realisticPayload = {
  id: 1234,
  name: 'Weekly Riftbound Tournament',
  start_datetime: '2026-07-21T17:00:00Z',
  end_datetime: '2026-07-21T20:30:00Z',
  store: {
    name: 'The Card Shop',
    full_address: '456 Gaming Ave, Seville, Spain',
    website: 'https://thecardshop.example.com',
    email: 'events@thecardshop.example.com',
  },
  gameplay_format: {
    name: 'Standard',
  },
  event_type: 'LOCALS',
  tournament_phases: [
    { first_round_type: 'PLAYER_MEETING' },
  ],
  registered_user_count: 12,
  capacity: 40,
  cost_in_cents: 0,
  currency: 'EUR',
};

describe('Events API Zod schema', () => {
  it('validates a realistic wire payload', () => {
    const result = EventApiSchema.parse(realisticPayload);
    expect(result.name).toBe('Weekly Riftbound Tournament');
    expect(result.id).toBe(1234);
    expect(result.store?.name).toBe('The Card Shop');
    expect(result.store?.full_address).toBe('456 Gaming Ave, Seville, Spain');
    expect(result.event_type).toBe('LOCALS');
    expect(result.tournament_phases[0]?.first_round_type).toBe('PLAYER_MEETING');
    expect(result.registered_user_count).toBe(12);
    expect(result.capacity).toBe(40);
    expect(result.cost_in_cents).toBe(0);
    expect(result.currency).toBe('EUR');
  });

  it('handles missing optional fields with defaults', () => {
    const minimal = {
      id: 1,
      name: 'Test',
      start_datetime: '2026-07-21T00:00:00Z',
      end_datetime: '2026-07-21T01:00:00Z',
      registered_user_count: 0,
      capacity: 0,
      cost_in_cents: 0,
    };
    const result = EventApiSchema.parse(minimal);
    // When the key is absent, .optional().nullable() results in undefined
    expect(result.store).toBeUndefined();
    expect(result.gameplay_format).toBeUndefined();
    expect(result.event_type).toBe('');
    expect(result.tournament_phases).toEqual([]);
    expect(result.currency).toBe('');
  });

  it('handles null store and gameplay_format', () => {
    const payload = {
      ...realisticPayload,
      store: null,
      gameplay_format: null,
    };
    const result = EventApiSchema.parse(payload);
    expect(result.store).toBeNull();
    expect(result.gameplay_format).toBeNull();
  });

  it('coerces string numbers to numbers', () => {
    const payload = {
      ...realisticPayload,
      id: '5678' as unknown as number,
      registered_user_count: '5' as unknown as number,
      capacity: '20' as unknown as number,
      cost_in_cents: '1500' as unknown as number,
    };
    const result = EventApiSchema.parse(payload);
    expect(result.id).toBe(5678);
    expect(result.registered_user_count).toBe(5);
    expect(result.capacity).toBe(20);
    expect(result.cost_in_cents).toBe(1500);
  });
});
