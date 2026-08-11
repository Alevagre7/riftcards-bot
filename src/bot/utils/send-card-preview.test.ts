import { describe, expect, it, vi } from 'vitest';
import { Context } from 'telegraf';
import { Card } from '../../core/entities/card.js';
import { sendCardPreview } from './send-card-preview.js';

const RIOT_IMAGE_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e49461109a4116c22af9206719f53fb73aee36d0-744x1039.png?accountingTag=RB';
const RIOT_PNG_URL = `${RIOT_IMAGE_URL}&fm=png`;

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

function context(): {
  ctx: Context;
  reply: ReturnType<typeof vi.fn>;
  replyWithPhoto: ReturnType<typeof vi.fn>;
} {
  const reply = vi.fn().mockResolvedValue(undefined);
  const replyWithPhoto = vi.fn().mockResolvedValue(undefined);
  return {
    ctx: { reply, replyWithPhoto } as unknown as Context,
    reply,
    replyWithPhoto,
  };
}

describe('sendCardPreview', () => {
  it('sends an eligible Riot image using the stable PNG URL', async () => {
    const { ctx, replyWithPhoto } = context();

    await sendCardPreview(ctx, card({ imageUrl: RIOT_IMAGE_URL }));

    expect(replyWithPhoto).toHaveBeenCalledWith(RIOT_PNG_URL, {
      caption: 'Shady Spectacles',
      parse_mode: 'HTML',
    });
  });

  it('leaves a non-Sanity image URL unchanged', async () => {
    const { ctx, replyWithPhoto } = context();
    const source = 'https://example.test/cards/shady-spectacles.png';

    await sendCardPreview(ctx, card({ imageUrl: source }));

    expect(replyWithPhoto).toHaveBeenCalledWith(source, {
      caption: 'Shady Spectacles',
      parse_mode: 'HTML',
    });
  });

  it('uses the existing text fallback when the card has no image', async () => {
    const { ctx, reply, replyWithPhoto } = context();

    await sendCardPreview(ctx, card());

    expect(reply).toHaveBeenCalledWith('Shady Spectacles', { parse_mode: 'HTML' });
    expect(replyWithPhoto).not.toHaveBeenCalled();
  });
});
