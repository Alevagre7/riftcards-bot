import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from 'telegraf';
import { createAdminCommand } from './admin.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';

function mockWatchManager(): IEventWatchManager {
  return {
    list: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn(),
    refreshStatus: vi.fn(),
    requestSubscription: vi.fn(),
    replaceSubscription: vi.fn(),
    stop: vi.fn(),
  };
}

function makeCtx(overrides?: Partial<Context>): Context {
  return {
    from: { id: 123, is_bot: false, first_name: 'Test' },
    reply: vi.fn(),
    ...overrides,
  } as unknown as Context;
}

describe('createAdminCommand', () => {
  it('rejects non-admin users', async () => {
    const ctx = makeCtx({ from: { id: 999, is_bot: false, first_name: 'Hacker' } });
    const watchManager = mockWatchManager();
    const cmd = createAdminCommand({
      watchManager,
      adminTelegramIds: [123],
    });

    await cmd(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('This command is restricted.');
    expect(watchManager.list).not.toHaveBeenCalled();
  });

  it('shows "No active watches" when list is empty', async () => {
    const ctx = makeCtx();
    const watchManager = mockWatchManager();
    const cmd = createAdminCommand({
      watchManager,
      adminTelegramIds: [123],
    });

    await cmd(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('No active watches.');
  });

  it('lists active watches with Stop buttons', async () => {
    const ctx = makeCtx();
    const watchManager = mockWatchManager();
    watchManager.list = vi.fn().mockResolvedValue([
      {
        telegramId: 1,
        revision: 'revision-1',
        eventId: 735205,
        eventName: 'Test Event',
        eventUsername: 'Alice',
        hasObservedPairing: true,
        lastSeenRound: 2,
        lastSeenTable: 3,
        lastSeenOpponent: 'Bob',
        lastSeenResult: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
        consecutiveMissing: 0,
      },
    ]);

    const cmd = createAdminCommand({
      watchManager,
      adminTelegramIds: [123],
    });

    await cmd(ctx);

    expect(ctx.reply).toHaveBeenCalled();
    const callArgs = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(callArgs[0]).toContain('Alice');
    expect(callArgs[0]).toContain('Test Event');
    expect(callArgs[1]?.reply_markup?.inline_keyboard[0]?.[0]?.text).toBe('Stop');
  });
});
