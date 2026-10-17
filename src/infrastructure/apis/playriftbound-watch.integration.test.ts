import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'telegraf';
import { createEventActionHandler } from '../../bot/actions/event-callback.js';
import { createEventWatchManager } from '../../bot/services/event-watch-manager.js';
import { createEventWatcher } from '../../bot/services/event-watcher.js';
import { createEventNavigationContext } from '../../bot/state/event-navigation-context.js';
import { watchSelectionCallback } from '../../bot/utils/event-callback-codec.js';
import { openDatabase } from '../persistence/open-database.js';
import { SqliteEventWatchRepository } from '../persistence/sqlite-event-watch-repository.js';
import { SqliteUserSettingsRepository } from '../persistence/sqlite-user-settings-repository.js';
import { PlayRiftboundAdapter } from './playriftbound.adapter.js';

describe('Riot player selection, restart, and final notification', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('retains exact identities across restart and delivers the final result before closing the watch', async () => {
    const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/playriftbound-tournament.json', import.meta.url), 'utf8'));
    const organizer = JSON.parse(readFileSync(new URL('./__fixtures__/playriftbound-organizer.json', import.meta.url), 'utf8'));
    const tournament = fixture.data.competeTournaments[0];
    const firstStage = tournament.stages[0];
    const firstSection = firstStage.sections[0];
    const rawRound = firstSection.rounds[0];
    const rawMatch = rawRound.matches[0];
    const finalOutcomes = structuredClone(rawMatch.teamOutcomes);
    firstSection.rounds = [rawRound];
    firstStage.sections = [firstSection];
    tournament.stages = [firstStage];
    tournament.config.roundCount = 1;
    rawRound.status = 'IN_PROGRESS';
    rawRound.endOfRoundStandings = [];
    rawMatch.teamOutcomes = [];
    for (const game of rawMatch.games) game.teamOutcomes = [];
    organizer.data.organizerSummary.id = tournament.organizerId;

    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const operation = JSON.parse(options.body).operationName;
      if (operation === 'GetCompeteTournamentForRiftboundPlayer') return Response.json(fixture);
      if (operation === 'OrganizerSummary') return Response.json(organizer);
      throw new Error(`Unexpected operation: ${operation}`);
    }));
    const api = new PlayRiftboundAdapter({ timeoutMs: 5000, retryAttempts: 1 });
    const location = { latitude: 37.39, longitude: -5.99, numMiles: 50 };
    const eventId = `riot:${tournament.id}` as const;
    const detail = await api.getEventDetail(eventId, location);
    const pairing = detail?.pairings[0];
    const playerId = detail?.registrations.find((entry) => entry.status === 'Active' &&
      [pairing?.player1Id, pairing?.player2Id].includes(String(entry.id)))?.id;
    expect(playerId).toBeTruthy();
    if (typeof playerId !== 'string') throw new Error('Fixture must include an active 1v1 player identity');

    const directory = mkdtempSync(join(tmpdir(), 'riftbot-riot-watch-'));
    const path = join(directory, 'watch.db');
    let db = openDatabase(path);
    try {
      const repository = new SqliteEventWatchRepository(db);
      const manager = createEventWatchManager({ watchRepository: repository, eventRepository: api, defaultLocation: location });
      const handler = createEventActionHandler({
        eventRepository: api, eventListingRepository: api, watchManager: manager,
        userSettingsRepository: new SqliteUserSettingsRepository(db),
        eventNavigationContext: createEventNavigationContext(), defaultLocation: location,
        daysAhead: 7, adminTelegramIds: [],
      });
      const ctx = {
        from: { id: 7 }, chat: { id: 7, type: 'private' },
        callbackQuery: { id: 'test', data: watchSelectionCallback(eventId, playerId), message: {} },
        answerCbQuery: vi.fn(), reply: vi.fn(), editMessageText: vi.fn(),
      } as unknown as Context;
      await handler(ctx);
      const before = await repository.get(7);
      expect(before).toMatchObject({ eventId, registrationId: playerId });

      db.close();
      db = openDatabase(path);
      const reopened = new SqliteEventWatchRepository(db);
      expect(await reopened.get(7)).toEqual(before);
      const notify = vi.fn().mockResolvedValue(undefined);
      const watcher = createEventWatcher({
        watchRepository: reopened, eventRepository: api, defaultLocation: location,
        notify, intervalMs: 30000, logger: () => {},
      });
      await watcher.tick();
      expect(notify).toHaveBeenCalledTimes(1);
      expect((await reopened.get(7))?.lastSeenResult).toBeNull();

      // Riot can keep the match IN_PROGRESS after finalizing the round.
      rawRound.status = 'FINALIZED';
      rawMatch.teamOutcomes = finalOutcomes;
      await watcher.tick();
      expect(notify).toHaveBeenCalledTimes(3);
      expect(notify.mock.calls[1]![1].body).toMatch(/Round 1 result: (Win|Loss)/);
      expect(notify.mock.calls[2]![1].body).toContain('event is complete');
      expect(await reopened.get(7)).toBeNull();
    } finally {
      if (db.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
