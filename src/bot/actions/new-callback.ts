// new-callback: handles the "Show all N" button rendered by the
// /new command. We re-run the same fetch-and-render path so the
// data is fresh (no in-memory caching of the previous /new result).
// The action handler is independent of the command module so the
// dependency graph stays clean: the callback depends on the
// repository, not on the command factory.

import { Context } from 'telegraf';
import { ICardRepository } from '../../core/ports/card-repository.js';
import { reRenderAll } from '../commands/new.js';

interface NewActionDeps {
  cardRepository: ICardRepository;
}

export function createNewActionHandler(deps: NewActionDeps) {
  return async (ctx: Context) => {
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data || data !== 'new:show-all') return;
    await ctx.answerCbQuery();
    await reRenderAll(ctx, deps.cardRepository);
  };
}
