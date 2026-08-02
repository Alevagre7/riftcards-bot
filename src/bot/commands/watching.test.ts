import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { createWatchingCommand } from './watching.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';

function manager(): IEventWatchManager {
  return {
    getStatus: vi.fn().mockResolvedValue(null),
    refreshStatus: vi.fn(),
    requestSubscription: vi.fn(),
    replaceSubscription: vi.fn(),
    stop: vi.fn(),
    list: vi.fn(),
  };
}

function ctx(text: string, type: 'private' | 'group' = 'private'): Context {
  return {
    from: { id: 7, is_bot: false, first_name: 'Test' },
    chat: { id: 7, type },
    message: { text },
    reply: vi.fn(),
  } as unknown as Context;
}

describe('createWatchingCommand', () => {
  it('shows an empty state with a browse button', async () => {
    const watchManager = manager();
    const command = createWatchingCommand({ watchManager, daysAhead: 7 });
    const context = ctx('/watching');

    await command(context);

    expect(context.reply).toHaveBeenCalledWith(
      'You are not watching anyone.',
      { reply_markup: { inline_keyboard: [[{ text: '📅 Browse events', callback_data: 'event:range:7' }]] } },
    );
  });

  it('stops the active watch through the canonical command', async () => {
    const watchManager = manager();
    watchManager.stop = vi.fn().mockResolvedValue({ kind: 'stopped' });
    const command = createWatchingCommand({ watchManager, daysAhead: 7 });
    const context = ctx('/watching stop');

    await command(context);

    expect(watchManager.stop).toHaveBeenCalledWith(7);
    expect(context.reply).toHaveBeenCalledWith('Watch stopped.');
  });

  it('rejects management commands in group chats', async () => {
    const watchManager = manager();
    const command = createWatchingCommand({ watchManager, daysAhead: 7 });
    const context = ctx('/watching', 'group');

    await command(context);

    expect(context.reply).toHaveBeenCalledWith('Watch management is available in a private chat with me.');
    expect(watchManager.getStatus).not.toHaveBeenCalled();
  });
});
