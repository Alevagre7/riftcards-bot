import { Context } from 'telegraf';
import { ICardRepository } from '../../core/ports/card-repository.js';
import { sendCardPreview } from '../utils/send-card-preview.js';

interface CardActionDeps {
  cardRepository: ICardRepository;
}

export function createCardActionHandler(deps: CardActionDeps) {
  return async (ctx: Context) => {
    const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data || !data.startsWith('card:')) return;

    await ctx.answerCbQuery();

    const cardId = data.slice(5);
    const card = await deps.cardRepository.getCardById(cardId);
    if (!card) {
      await ctx.reply('Card not found.');
      return;
    }

    await sendCardPreview(ctx, card);
  };
}
