import { Context, Markup } from 'telegraf';
import { ICardRepository } from '../../core/ports/card-repository.js';
import { Card } from '../../core/entities/card.js';

// /new — the daily-spoiled-cards command. Surfaces every Card
// whose upstream `metadata.updated_on` falls in the current UTC
// calendar day. See CONTEXT.md → Spoiler for the precise
// definition.
//
// Presentation (per the design decision in the Round-1 grilling):
//   - 0 cards:   empty-state message that names the 03:00 UTC sync
//                so the user knows when to retry.
//   - 1–10 cards: single MediaGroup of all cards.
//   - >10 cards:  first 5 photos + a "Show all N" inline button.
//                The callback re-runs the same fetch-and-render
//                flow and groups the full list in MediaGroups of
//                up to 10 (Telegram's per-message album limit).

interface NewCommandDeps {
  cardRepository: ICardRepository;
}

const ALBUM_LIMIT = 10;
const PREVIEW_COUNT = 5;

const TZ_OFFSET_MIN = new Date().getTimezoneOffset();

function startOfUtcDay(now: Date): Date {
  // Build a UTC-anchored midnight for the date that is "today" in
  // UTC, regardless of the host's local timezone. We avoid
  // Date.UTC-and-set because the test environment may be in any
  // zone; the math below is independent of the host clock.
  const utcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  return utcMidnight;
}

function isToday(card: Card, todayUtcMidnight: Date): boolean {
  if (!card.updatedOn) return false;
  // updatedOn is an ISO-8601 string from the upstream. String
  // comparison on ISO timestamps is correct (lex order = chrono
  // order), so we compare against the ISO form of the boundary.
  const boundaryIso = todayUtcMidnight.toISOString();
  return card.updatedOn >= boundaryIso;
}

async function fetchUpdatedToday(
  cardRepository: ICardRepository,
  todayUtcMidnight: Date,
): Promise<Card[]> {
  // Walk every set and every page within. The dataset is small
  // (~1.2k cards today, 4 sets), so a full scan is fine. We could
  // add a port method later if the table grows.
  const sets = await cardRepository.getSets();
  const out: Card[] = [];
  for (const set of sets) {
    let page = 1;
    while (true) {
      const result = await cardRepository.getCardsBySet(set.code, page, 100);
      for (const c of result.cards) {
        if (isToday(c, todayUtcMidnight)) out.push(c);
      }
      if (!result.hasMore) break;
      page += 1;
    }
  }
  // Newest first. Re-rank within "today" by updatedOn descending;
  // upstream is already sorted by some default that does not
  // necessarily match.
  out.sort((a, b) => (b.updatedOn ?? '').localeCompare(a.updatedOn ?? ''));
  return out;
}

async function sendAlbum(ctx: Context, cards: Card[]): Promise<void> {
  const media = cards
    .filter((c) => c.imageUrl)
    .map((c) => ({
      type: 'photo' as const,
      media: c.imageUrl as string,
      caption: c.name,
    }));
  if (media.length === 0) return;
  await ctx.replyWithMediaGroup(media);
}

export function createNewCommand(deps: NewCommandDeps) {
  return async (ctx: Context) => {
    await ctx.sendChatAction('typing');

    const todayUtcMidnight = startOfUtcDay(new Date());
    const cards = await fetchUpdatedToday(deps.cardRepository, todayUtcMidnight);

    if (cards.length === 0) {
      await ctx.reply('No new cards today. Try again after the 03:00 UTC sync.');
      return;
    }

    if (cards.length <= ALBUM_LIMIT) {
      await sendAlbum(ctx, cards);
      return;
    }

    // >10 cards: preview the first 5 + offer a "Show all N" button.
    await sendAlbum(ctx, cards.slice(0, PREVIEW_COUNT));
    await ctx.reply(
      `Showing ${PREVIEW_COUNT} of ${cards.length} new cards today.`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`Show all ${cards.length}`, 'new:show-all')],
      ]),
    );
  };
}

// reRenderAll is invoked from the new-callback handler. It runs
// the same fetch as /new and groups the full list into albums of
// up to ALBUM_LIMIT. Exported so the callback can call it without
// re-walking the search logic.
export async function reRenderAll(
  ctx: Context,
  cardRepository: ICardRepository,
): Promise<void> {
  await ctx.sendChatAction('typing');
  const todayUtcMidnight = startOfUtcDay(new Date());
  const cards = await fetchUpdatedToday(cardRepository, todayUtcMidnight);

  if (cards.length === 0) {
    await ctx.reply('No new cards today. Try again after the 03:00 UTC sync.');
    return;
  }

  for (let i = 0; i < cards.length; i += ALBUM_LIMIT) {
    const chunk = cards.slice(i, i + ALBUM_LIMIT);
    await sendAlbum(ctx, chunk);
  }
}

// `TZ_OFFSET_MIN` is read once at module load and exported for
// tests that need to assert the UTC boundary calculation.
export const _internal = { TZ_OFFSET_MIN };
