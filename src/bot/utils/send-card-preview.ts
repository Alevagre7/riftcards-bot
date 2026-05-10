import { Context } from 'telegraf';
import { Card } from '../../core/entities/card.js';
import { escapeHtml } from '../formatters/card-formatter.js';

export async function sendCardPreview(ctx: Context, card: Card): Promise<void> {
  if (card.imageUrl) {
    await ctx.replyWithPhoto(card.imageUrl, {
      caption: escapeHtml(card.name),
      parse_mode: 'HTML',
    });
  } else {
    await ctx.reply(escapeHtml(card.name), {
      parse_mode: 'HTML',
    });
  }
}
