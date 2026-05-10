import { Context } from 'telegraf';
import type { InlineQueryResult } from '@telegraf/types';
import { ICardRepository } from '../core/ports/card-repository.js';

interface InlineQueryDeps {
  cardRepository: ICardRepository;
}

export function createInlineQueryHandler(deps: InlineQueryDeps) {
  return async (ctx: Context) => {
    if (!ctx.inlineQuery) return;

    const query = ctx.inlineQuery.query.trim();
    if (!query || query.length < 2) {
      await ctx.answerInlineQuery([], { cache_time: 0 });
      return;
    }

    try {
      const result = await deps.cardRepository.searchCards({
        query,
        limit: 20,
      });

      const inlineResults = result.cards.slice(0, 20).map((card) => ({
        type: 'article' as const,
        id: card.id,
        title: card.name,
        description: `${card.setCode.toUpperCase()}-${card.collectorNumber} \u2014 ${card.type}`,
        thumb_url: card.imageUrl,
        input_message_content: {
          message_text: `/card ${card.name}`,
          parse_mode: 'HTML' as const,
        },
      }));

      await ctx.answerInlineQuery(inlineResults as InlineQueryResult[], { cache_time: 300 });
    } catch {
      await ctx.answerInlineQuery([], { cache_time: 0 });
    }
  };
}
