import { Context, Markup } from 'telegraf';
import { ICardRepository } from '../../core/ports/card-repository.js';
import { sendCardPreview } from '../utils/send-card-preview.js';
import { formatVersionLabel, sortByVersion } from '../formatters/card-label.js';

function stripCommand(text: string, command: string): string {
  return text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`, 'i'), '').trim();
}

interface CardCommandDeps {
  cardRepository: ICardRepository;
}

export function createCardCommand(deps: CardCommandDeps) {
  return async (ctx: Context) => {
    const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') || '';
    const query = stripCommand(text, 'card');

    if (!query) {
      await ctx.reply(
        'Usage: /card &lt;name or ID&gt;\n\nExample: /card Flameblade\nExample: /card ogn-011',
        { parse_mode: 'HTML' },
      );
      return;
    }

    await ctx.sendChatAction('typing');

    // The id may be either a bare riftbound id (`ogn-011`) or a
    // composite (riftboundId/collectorNumber, e.g. `ogn-011/298`).
    // Both forms route through getCardByRiftboundId with the
    // riftbound id half. See ADR-0001.
    const idMatch = /^([a-z]{3,4}-\d{3}[a-z]?)(?:\/\d+)?$/i.exec(query);
    if (idMatch) {
      const card = await deps.cardRepository.getCardByRiftboundId(idMatch[1]!);
      if (card) {
        await sendCardPreview(ctx, card);
      } else {
        await ctx.reply(
          `No card found for ID "${query}".`,
          { parse_mode: 'HTML' },
        );
      }
      return;
    }

    const results = await deps.cardRepository.searchCards({
      query,
      limit: 10,
    });

    if (results.cards.length === 0) {
      await ctx.reply(
        `No card found for "${query}". Try a different name or ID.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (results.cards.length === 1 && results.cards[0]) {
      await sendCardPreview(ctx, results.cards[0]);
      return;
    }

    const exact = results.cards.find(
      (c) => c.name.toLowerCase() === query.toLowerCase(),
    );
    if (exact) {
      await sendCardPreview(ctx, exact);
      return;
    }

    const buttons = sortByVersion(results.cards).map((c) => [
      Markup.button.callback(
        // formatVersionLabel carries the print-level disambiguator
        // (e.g. `OGN-011 · Alt Art`); the callback payload uses
        // c.id (the composite key) so the action handler can
        // resolve any of the matches. See CONTEXT.md → Multi-version
        // label and the design discussion in ADR-0006.
        `${c.name} [${formatVersionLabel(c)}]`,
        `card:${c.id}`,
      ),
    ]);

    await ctx.reply(
      `Results for "<b>${query}</b>" (${results.total} found):`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons),
      },
    );
  };
}
