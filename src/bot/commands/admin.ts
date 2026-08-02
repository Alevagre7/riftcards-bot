// Admin command — lists active watches with Stop buttons.

import { Context } from 'telegraf';
import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';

export interface AdminCommandDeps {
  watchManager: IEventWatchManager;
  adminTelegramIds: number[];
}

export function createAdminCommand(deps: AdminCommandDeps) {
  return async (ctx: Context) => {
    const userId = ctx.from?.id;
    if (userId == null || !deps.adminTelegramIds.includes(userId)) {
      await ctx.reply('This command is restricted.');
      return;
    }

    const watches = await deps.watchManager.list();
    if (watches.length === 0) {
      await ctx.reply('No active watches.');
      return;
    }

    const lines: string[] = [];
    const buttons: InlineKeyboardButton[][] = [];

    for (const w of watches) {
      const ago = formatRelative(w.updatedAt, new Date());
      lines.push(
        `\u2022 ${w.telegramId} watching ${w.eventUsername} @ ${w.eventName} (event ${w.eventId}) \u2014 last change: round ${w.lastSeenRound ?? '\u2014'}, table ${w.lastSeenTable ?? '\u2014'} (${ago}); checked ${formatRelative(w.lastCheckedAt, new Date())}`,
      );
      buttons.push([{ text: 'Stop', callback_data: `admin:stop:${w.telegramId}:${w.revision}` }]);
    }

    await ctx.reply(lines.join('\n'), {
      reply_markup: { inline_keyboard: buttons },
    });
  };
}

function formatRelative(iso: string | null, now: Date): string {
  if (!iso) return '\u2014';
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
