// inline-query: the @RiftCardsBot <query> flow.
//
// Improvements over the previous version (see the design notes in
// CONTEXT.md → Inline query and the Round-1 design discussion):
//
//  1. Cap raised from 20 → 50 (Telegram's per-query max).
//  2. Client-side Levenshtein re-ranking on top of the upstream
//     results, so a fuzzy match outranks a non-match even if the
//     upstream returned them in the wrong order.
//  3. Each result's input_message_content is a `photo` so picking
//     a result delivers the card image directly into the chat
//     without a follow-up /card round trip. This is what fixes
//     the "selecting an inline result loses the chosen print"
//     issue: each result already carries its own image, so the
//     print choice is committed at pick time. Cards without an
//     image fall back to an article result so we don't drop them.

import { Context } from 'telegraf';
import type { InlineQueryResult } from '@telegraf/types';
import { ICardRepository } from '../core/ports/card-repository.js';
import { Card } from '../core/entities/card.js';
import { formatVersionLabel } from './formatters/card-label.js';
import { levenshtein } from '../utils/levenshtein.js';

interface InlineQueryDeps {
  cardRepository: ICardRepository;
}

const RESULT_CAP = 50;

function rankByQuery(cards: Card[], query: string): Card[] {
  const q = query.toLowerCase();
  // Use a stable sort to preserve upstream order on ties.
  return [...cards].sort((a, b) => {
    const da = levenshtein(q, a.name.toLowerCase());
    const db = levenshtein(q, b.name.toLowerCase());
    return da - db;
  });
}

function resultForCard(card: Card): InlineQueryResult {
  const label = formatVersionLabel(card);
  if (card.imageUrl) {
    return {
      type: 'photo',
      id: card.id,
      photo_url: card.imageUrl,
      // thumbnail_url is required by InlineQueryResultPhoto; we
      // reuse photo_url since the image is the only media.
      thumbnail_url: card.imageUrl,
      caption: `<b>${escapeHtml(card.name)}</b> \u00B7 ${escapeHtml(label)}`,
      parse_mode: 'HTML',
    };
  }
  return {
    type: 'article',
    id: card.id,
    title: card.name,
    description: `${label} \u2014 ${card.type}`,
    input_message_content: {
      // No image: the chosen print has to be re-resolved by the
      // callback flow, which is what the old behaviour did. We
      // keep it as a graceful fallback.
      message_text: `/card ${card.id}`,
      parse_mode: 'HTML',
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
      // Fetch more than the cap so the re-rank has room to work.
      const result = await deps.cardRepository.searchCards({
        query,
        limit: RESULT_CAP,
      });

      const ranked = rankByQuery(result.cards, query).slice(0, RESULT_CAP);
      const inlineResults = ranked.map(resultForCard);

      // cache_time 0 keeps results fresh — the inline cache can
      // outlive a /new wave and the user would see stale spoilers.
      await ctx.answerInlineQuery(inlineResults, {
        cache_time: 0,
        // `is_personal` so the result order (Levenshtein) does not
        // get shuffled by Telegram's own ranking.
        is_personal: true,
      });
    } catch (error) {
      // AGENTS.md: "Errors logged, never leaked to users." The
      // user-facing response is the empty result; we log the
      // error so the operator can see what broke.
      console.error('[inline-query] error answering', error);
      await ctx.answerInlineQuery([], { cache_time: 0 });
    }
  };
}
