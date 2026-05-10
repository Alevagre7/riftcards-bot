import { Context } from 'telegraf';
import { ICardRepository } from '../../core/ports/card-repository.js';
import { sendCardPreview } from '../utils/send-card-preview.js';

interface RandomCommandDeps {
  cardRepository: ICardRepository;
}

export function createRandomCommand(deps: RandomCommandDeps) {
  return async (ctx: Context) => {
    await ctx.sendChatAction('typing');

    const card = await deps.cardRepository.getRandomCard();

    if (!card) {
      await ctx.reply('Could not get a random card. Please try again.', { parse_mode: 'HTML' });
      return;
    }

    await sendCardPreview(ctx, card);
  };
}
