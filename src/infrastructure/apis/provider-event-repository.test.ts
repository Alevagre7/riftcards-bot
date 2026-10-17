import { describe, expect, it, vi } from 'vitest';
import type { IEventRepository } from '../../core/ports/event-repository.js';
import { ApiResponseError } from '../../core/errors/index.js';
import { ProviderEventRepository } from './provider-event-repository.js';

function repository(): IEventRepository {
  return {
    getEventById: vi.fn().mockResolvedValue(null),
    getEventRegistrations: vi.fn().mockResolvedValue([]),
    getEventDetail: vi.fn().mockResolvedValue(null),
    getEventMatches: vi.fn().mockResolvedValue([]),
    getEventStandings: vi.fn().mockResolvedValue([]),
  };
}

describe('event provider routing', () => {
  const location = { latitude: 37.39, longitude: -5.99, numMiles: 50 };

  it('never maps a failed or missing Riot event to a legacy provider', async () => {
    const riot = repository();
    const legacy = repository();
    const router = new ProviderEventRepository(riot, legacy);
    const event = 'riot:117093196872746571';
    expect(await router.getEventDetail(event, location)).toBeNull();
    (riot.getEventDetail as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiResponseError('Riot', 429));
    await expect(router.getEventDetail(event, location, { fresh: true })).rejects.toThrow();
    expect(legacy.getEventDetail).not.toHaveBeenCalled();
    expect(riot.getEventDetail).toHaveBeenLastCalledWith(event, location, { fresh: true });
  });

  it('retains historical numeric events and round identities', async () => {
    const riot = repository();
    const legacy = repository();
    const router = new ProviderEventRepository(riot, legacy);
    await router.getEventById(799609, location);
    await router.getEventRegistrations(799609, location);
    await router.getEventMatches(1234);
    await router.getEventStandings(1234);
    expect(legacy.getEventById).toHaveBeenCalledWith(799609, location);
    expect(legacy.getEventRegistrations).toHaveBeenCalledWith(799609, location);
    expect(legacy.getEventMatches).toHaveBeenCalledWith(1234);
    expect(legacy.getEventStandings).toHaveBeenCalledWith(1234);
    expect(riot.getEventById).not.toHaveBeenCalled();
  });
});
