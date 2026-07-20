import { Context } from 'telegraf';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { renderEventList, renderEventDetail, sendShowAllMessages } from '../commands/events.js';

interface EventActionDeps {
  eventRepository: IEventRepository;
  userSettingsRepository: IUserSettingsRepository;
  defaultLocation: EventLocation;
  daysAhead: number;
}

export function createEventActionHandler(deps: EventActionDeps) {
  return async (ctx: Context) => {
    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data || !data.startsWith('event:')) return;

    await ctx.answerCbQuery();

    // Show all (no cap) — send as new message(s)
    if (data === 'event:list:show-all') {
      await sendShowAllMessages(ctx, deps);
      return;
    }

    // Back to list — edit current message
    if (data === 'event:list') {
      await renderEventList(ctx, deps, deps.daysAhead);
      return;
    }

    // Single event detail
    const match = /^event:(\d+)$/.exec(data);
    if (match) {
      const id = match[1]!;
      await renderEventDetail(ctx, deps, id);
      return;
    }

    // Unknown event: callback — ignore silently
  };
}
