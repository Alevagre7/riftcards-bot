import { Context } from 'telegraf';
import { IEventWatchManager } from '../services/event-watch-manager.js';
import { formatEventWatchStatus, formatNoEventWatch } from '../formatters/event-watch-formatter.js';
import { stripCommand } from '../utils/strip-command.js';

export interface WatchingCommandDeps {
  readonly watchManager: IEventWatchManager;
  readonly daysAhead: number;
  readonly now?: () => Date;
}

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private';
}

export async function renderWatching(ctx: Context, deps: WatchingCommandDeps): Promise<void> {
  if (!isPrivateChat(ctx)) {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply('Could not identify your account. Please try again.');
    return;
  }
  const status = await deps.watchManager.getStatus(userId);
  if (!status) {
    const empty = formatNoEventWatch(deps.daysAhead);
    await ctx.reply(empty.body, { reply_markup: { inline_keyboard: empty.buttons } });
    return;
  }
  const result = formatEventWatchStatus(status, {
    now: deps.now?.() ?? new Date(),
    daysAhead: deps.daysAhead,
  });
  await ctx.reply(result.body, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: result.buttons },
  });
}

export function createWatchingCommand(deps: WatchingCommandDeps) {
  return async (ctx: Context): Promise<void> => {
    const text =
      ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string'
        ? ctx.message.text
        : '';
    const args = stripCommand(text, 'watching').trim().toLowerCase();
    if (args !== '' && args !== 'stop') {
      await ctx.reply('Usage: /watching or /watching stop');
      return;
    }
    if (args === 'stop') {
      if (!isPrivateChat(ctx)) {
        await ctx.reply('Watch management is available in a private chat with me.');
        return;
      }
      const userId = ctx.from?.id;
      if (userId == null) {
        await ctx.reply('Could not identify your account. Please try again.');
        return;
      }
      const result = await deps.watchManager.stop(userId);
      switch (result.kind) {
        case 'stopped':
          await ctx.reply('Watch stopped.');
          return;
        case 'no-active-watch':
          await ctx.reply('You are not watching anyone.');
          return;
        case 'stale':
          await ctx.reply('That watch is no longer active.');
          return;
      }
    }
    await renderWatching(ctx, deps);
  };
}
