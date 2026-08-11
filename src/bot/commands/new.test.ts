import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { Card } from '../../core/entities/card.js';
import { ICardRepository } from '../../core/ports/card-repository.js';
import { createNewCommand, isToday, reRenderAll, startOfUtcDay } from './new.js';

const card = (updatedOn: string): Card => ({
  id: 'ogn-001/1',
  name: 'Test Card',
  setCode: 'ogn',
  collectorNumber: '1',
  rarity: 'Common',
  type: 'Unit',
  keywords: [],
  updatedOn,
});

describe('new command UTC date helpers', () => {
  const day = startOfUtcDay(new Date('2026-08-02T18:30:00Z'));

  it('uses the UTC calendar day regardless of the host timezone', () => {
    expect(day.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('accepts timestamps with offsets on the selected UTC day', () => {
    expect(isToday(card('2026-08-02T01:00:00+01:00'), day)).toBe(true);
    expect(isToday(card('2026-08-02T23:59:59.999Z'), day)).toBe(true);
  });

  it('excludes adjacent days, future timestamps, and malformed dates', () => {
    expect(isToday(card('2026-08-01T23:59:59.999Z'), day)).toBe(false);
    expect(isToday(card('2026-08-03T00:00:00.000Z'), day)).toBe(false);
    expect(isToday(card('not-a-date'), day)).toBe(false);
  });
});

const RIOT_VEN_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e49461109a4116c22af9206719f53fb73aee36d0-744x1039.png?accountingTag=RB';
const RIOT_UNL_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/05fc9613bd3a3c3c5002ff1d7d665b37fd18dcb7-744x1039.png?accountingTag=RB';

function imageCard(over: Partial<Card> = {}): Card {
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
    searchCards: vi.fn(),
    getCardById: vi.fn(),
    getCardByRiftboundId: vi.fn(),
    getCardByName: vi.fn(),
    getCardByTcgPlayerId: vi.fn(),
    getSets: vi.fn().mockResolvedValue([{ id: 'ven', code: 'ven', name: 'Beyond the Gates' }]),
    getCardsBySet: vi.fn().mockResolvedValue({
      cards,
      total: cards.length,
      page: 1,
      hasMore: false,
    }),
    getRandomCard: vi.fn(),
  };
}

function mediaContext(): {
  ctx: Context;
  replyWithMediaGroup: ReturnType<typeof vi.fn>;
} {
  const replyWithMediaGroup = vi.fn().mockResolvedValue([]);
  return {
    ctx: {
      sendChatAction: vi.fn().mockResolvedValue(true),
      reply: vi.fn().mockResolvedValue(true),
      replyWithMediaGroup,
    } as unknown as Context,
    replyWithMediaGroup,
  };
}

describe('new command card image payloads', () => {
  it('transforms album URLs in updated-card order and preserves non-Sanity URLs', async () => {
    const today = startOfUtcDay(new Date());
    const cards = [
      imageCard({
        id: 'ven-137/137',
        name: 'Shady Spectacles',
        imageUrl: RIOT_VEN_URL,
        updatedOn: new Date(today.getTime() + 1_000).toISOString(),
      }),
      imageCard({
        id: 'unl-067/67',
        name: 'Ruined Rex',
        imageUrl: RIOT_UNL_URL,
        updatedOn: new Date(today.getTime() + 2_000).toISOString(),
      }),
      imageCard({
        id: 'other-001/1',
        name: 'Other source',
        imageUrl: 'https://example.test/cards/other.png',
        updatedOn: new Date(today.getTime() + 3_000).toISOString(),
      }),
    ];
    const { ctx, replyWithMediaGroup } = mediaContext();

    await createNewCommand({ cardRepository: repository(cards) })(ctx);

    expect(replyWithMediaGroup).toHaveBeenCalledWith([
      {
        type: 'photo',
        media: 'https://example.test/cards/other.png',
        caption: 'Other source',
      },
      {
        type: 'photo',
        media: `${RIOT_UNL_URL}&fm=png`,
        caption: 'Ruined Rex',
      },
      {
        type: 'photo',
        media: `${RIOT_VEN_URL}&fm=png`,
        caption: 'Shady Spectacles',
      },
    ]);
  });

  it('transforms every album in the show-all re-render path', async () => {
    const today = startOfUtcDay(new Date());
    const cards = Array.from({ length: 11 }, (_, index) => imageCard({
      id: `ven-${String(index + 1).padStart(3, '0')}/${index + 1}`,
      name: `Card ${index + 1}`,
      imageUrl: RIOT_VEN_URL,
      updatedOn: new Date(today.getTime() + index * 1_000).toISOString(),
    }));
    const { ctx, replyWithMediaGroup } = mediaContext();

    await reRenderAll(ctx, repository(cards));

    expect(replyWithMediaGroup).toHaveBeenCalledTimes(2);
    expect(replyWithMediaGroup.mock.calls[0]![0]).toHaveLength(10);
    expect(replyWithMediaGroup.mock.calls[1]![0]).toHaveLength(1);
    expect(replyWithMediaGroup.mock.calls.flatMap(([media]) => media).every(
      (item: { media: string }) => item.media === `${RIOT_VEN_URL}&fm=png`,
    )).toBe(true);
  });
});
