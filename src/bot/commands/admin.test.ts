import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Context } from 'telegraf';
import { createAdminCommand } from './admin.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';

function mockWatchRepository(): IEventWatchRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    updateLastSeen: vi.fn(),
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
    const watchRepo = mockWatchRepository();
    const cmd = createAdminCommand({
      watchRepository: watchRepo,
      adminTelegramIds: [123],
    });

    await cmd(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('This command is restricted.');
    expect(watchRepo.list).not.toHaveBeenCalled();
  });

  it('shows "No active watches" when list is empty', async () => {
    const ctx = makeCtx();
    const watchRepo = mockWatchRepository();
    const cmd = createAdminCommand({
      watchRepository: watchRepo,
      adminTelegramIds: [123],
    });

    await cmd(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('No active watches.');
  });

  it('lists active watches with Stop buttons', async () => {
    const ctx = makeCtx();
    const watchRepo = mockWatchRepository();
    watchRepo.list = vi.fn().mockResolvedValue([
      {
        telegramId: 1,
        eventId: 735205,
        eventName: 'Test Event',
        eventUsername: 'Alice',
        lastSeenRound: 2,
        lastSeenTable: 3,
        lastSeenOpponent: 'Bob',
        lastSeenResult: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const cmd = createAdminCommand({
      watchRepository: watchRepo,
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
