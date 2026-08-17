import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { Card } from '../core/entities/card.js';
import { ICardRepository } from '../core/ports/card-repository.js';
import { createInlineQueryHandler } from './inline-query.js';

const RIOT_IMAGE_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e49461109a4116c22af9206719f53fb73aee36d0-744x1039.png?accountingTag=RB';
const RIOT_JPEG_URL = `${RIOT_IMAGE_URL}&fm=jpg&q=90`;
const VEN_174_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/45d83debda443f1bf88e1cf7123eb8b844143124-744x1039.png?accountingTag=RB';
const VEN_174_JPEG_URL = `${VEN_174_URL}&fm=jpg&q=90`;

function card(over: Partial<Card> = {}): Card {
  return {
    id: 'ven-137/137',
    name: 'Shady Spectacles',
    setCode: 'ven',
    collectorNumber: '137',
    rarity: 'Common',
    type: 'Equipment',
    keywords: [],
    ...over,
  };
}

function repository(cards: Card[]): ICardRepository {
  return {
    searchCards: vi.fn().mockResolvedValue({
      cards,
      total: cards.length,
      page: 1,
      hasMore: false,
    }),
    getCardById: vi.fn(),
    getCardByRiftboundId: vi.fn(),
    getCardByName: vi.fn(),
    getCardByTcgPlayerId: vi.fn(),
    getSets: vi.fn(),
    getCardsBySet: vi.fn(),
    getRandomCard: vi.fn(),
  };
}

function context(query: string): {
  ctx: Context;
  answerInlineQuery: ReturnType<typeof vi.fn>;
} {
  const answerInlineQuery = vi.fn().mockResolvedValue(true);
  return {
    ctx: {
      inlineQuery: { query },
      answerInlineQuery,
    } as unknown as Context,
    answerInlineQuery,
  };
}

describe('createInlineQueryHandler image payloads', () => {
  it('uses one stable JPEG URL for photo_url and thumbnail_url without dimensions', async () => {
    const { ctx, answerInlineQuery } = context('Shady Spectacles');
    const handler = createInlineQueryHandler({ cardRepository: repository([card({ imageUrl: RIOT_IMAGE_URL })]) });

    await handler(ctx);

    const [results] = answerInlineQuery.mock.calls[0]! as [Array<Record<string, unknown>>];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'photo',
      photo_url: RIOT_JPEG_URL,
      thumbnail_url: RIOT_JPEG_URL,
    });
    expect(results[0]).not.toHaveProperty('photo_width');
    expect(results[0]).not.toHaveProperty('photo_height');
  });

  it('normalizes the VEN-174 inline result to JPEG with its complete caption', async () => {
    const { ctx, answerInlineQuery } = context('Irelia, Fervent');
    const handler = createInlineQueryHandler({
      cardRepository: repository([card({
        id: 'ven-174/174',
        name: 'Irelia, Fervent',
        riftboundId: 'ven-174',
        collectorNumber: '174',
        isOvernumbered: true,
        imageUrl: VEN_174_URL,
      })]),
    });

    await handler(ctx);

    const [results] = answerInlineQuery.mock.calls[0]! as [Array<Record<string, unknown>>];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'photo',
      id: 'ven-174/174',
      photo_url: VEN_174_JPEG_URL,
      thumbnail_url: VEN_174_JPEG_URL,
      caption: '<b>Irelia, Fervent</b> \u00B7 VEN-174 \u00B7 Overnumbered',
      parse_mode: 'HTML',
    });
    expect(results[0]).not.toHaveProperty('photo_width');
    expect(results[0]).not.toHaveProperty('photo_height');
  });

  it('leaves a non-Sanity photo URL unchanged', async () => {
    const source = 'https://example.test/cards/shady-spectacles.png';
    const { ctx, answerInlineQuery } = context('Shady Spectacles');
    const handler = createInlineQueryHandler({ cardRepository: repository([card({ imageUrl: source })]) });

    await handler(ctx);

    const [results] = answerInlineQuery.mock.calls[0]! as [Array<Record<string, unknown>>];
    expect(results[0]).toMatchObject({
      photo_url: source,
      thumbnail_url: source,
    });
  });

  it('keeps the article fallback for a card without an image', async () => {
    const { ctx, answerInlineQuery } = context('Text-only card');
    const handler = createInlineQueryHandler({ cardRepository: repository([card({
      id: 'ven-138/138',
      name: 'Text-only card',
    })]) });

    await handler(ctx);

    const [results] = answerInlineQuery.mock.calls[0]! as [Array<Record<string, unknown>>];
    expect(results[0]).toMatchObject({ type: 'article', id: 'ven-138/138' });
  });
});
