import { Context } from 'telegraf';
import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { ILocatorRepository } from '../../core/ports/locator-repository.js';
import { IEventWatchRepository } from '../../core/ports/event-watch-repository.js';
import { renderEventList, renderEventDetail, renderEventsPage } from '../commands/events.js';
import { formatEventLeaderboard } from '../formatters/event-leaderboard-formatter.js';
import { formatEventRounds } from '../formatters/event-rounds-formatter.js';
import { eventsPaginationState } from '../state/events-pagination-state.js';

interface EventActionDeps {
  eventRepository: IEventRepository;
  locatorRepository: ILocatorRepository;
  watchRepository: IEventWatchRepository;
  userSettingsRepository: IUserSettingsRepository;
  defaultLocation: EventLocation;
  daysAhead: number;
  adminTelegramIds: number[];
}

export function createEventActionHandler(deps: EventActionDeps) {
  return async (ctx: Context) => {
    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data || !data.startsWith('event:') && !data.startsWith('admin:')) return;

    await ctx.answerCbQuery();

    // No-op: page label click — silent ack
    if (data === 'event:noop') return;

    // Admin: stop watch
    const adminStopMatch = /^admin:stop:(\d+)$/.exec(data);
    if (adminStopMatch) {
      await handleAdminStop(ctx, deps, parseInt(adminStopMatch[1]!, 10));
      return;
    }

    // Event pagination
    const pageMatch = /^event:page:(\d+)$/.exec(data);
    if (pageMatch) {
      const page = parseInt(pageMatch[1]!, 10);
      await renderEventsPage(ctx, deps, page);
      return;
    }

    // Window picker menu (event:range:<days>)
    const rangeMatch = /^event:range:(\d+)$/.exec(data);
    if (rangeMatch) {
      const days = parseInt(rangeMatch[1]!, 10);
      if (days > 0) {
        await renderEventList(ctx, deps, days);
      }
      return;
    }

    // Back to list — use the window the user last picked, not the
    // config default. The state is set by renderEventList itself;
    // when no prior pick (state missing or 5-min TTL expired), fall
    // back to deps.daysAhead.
    if (data === 'event:list') {
      const userId = ctx.from?.id;
      const stored = userId != null ? eventsPaginationState.get(userId) : null;
      const days = stored?.daysAhead ?? deps.daysAhead;
      await renderEventList(ctx, deps, days);
      return;
    }

    // Leaderboard view
    const leaderboardMatch = /^event:(\d+):leaderboard$/.exec(data);
    if (leaderboardMatch) {
      await handleLeaderboard(ctx, deps, leaderboardMatch[1]!);
      return;
    }

    // All tables / rounds view
    const roundsMatch = /^event:(\d+):rounds$/.exec(data);
    if (roundsMatch) {
      await handleRounds(ctx, deps, roundsMatch[1]!);
      return;
    }

    // Watch: start picker
    const watchStartMatch = /^event:(\d+):watch:start$/.exec(data);
    if (watchStartMatch) {
      await handleWatchStart(ctx, deps, parseInt(watchStartMatch[1]!, 10));
      return;
    }

    // Watch: select player from roster page:idx
    const watchSelectMatch = /^event:(\d+):watch:(\d+):(\d+)$/.exec(data);
    if (watchSelectMatch) {
      await handleWatchSelect(
        ctx,
        deps,
        parseInt(watchSelectMatch[1]!, 10),
        parseInt(watchSelectMatch[2]!, 10),
        parseInt(watchSelectMatch[3]!, 10),
      );
      return;
    }

    // Single event detail
    const match = /^event:(\d+)$/.exec(data);
    if (match) {
      const id = match[1]!;
      await renderEventDetail(ctx, deps, id);
      return;
    }

    // Unknown — ignore silently
  };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

async function handleLeaderboard(ctx: Context, deps: EventActionDeps, eventIdStr: string): Promise<void> {
  const eventId = parseInt(eventIdStr, 10);
  if (isNaN(eventId)) {
    await ctx.answerCbQuery('Invalid event.');
    return;
  }
  const data = await deps.locatorRepository.getEventData(eventId);
  if (!data) {
    await ctx.answerCbQuery('Locator data not available.');
    return;
  }
  const body = formatEventLeaderboard(data);
  await ctx.editMessageText(body);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

async function handleRounds(ctx: Context, deps: EventActionDeps, eventIdStr: string): Promise<void> {
  const eventId = parseInt(eventIdStr, 10);
  if (isNaN(eventId)) {
    await ctx.answerCbQuery('Invalid event.');
    return;
  }
  const data = await deps.locatorRepository.getEventData(eventId);
  if (!data) {
    await ctx.answerCbQuery('Locator data not available.');
    return;
  }
  const body = formatEventRounds(data);
  await ctx.editMessageText(body);
}

// ---------------------------------------------------------------------------
// Watch: start — show roster picker
// ---------------------------------------------------------------------------

const NAMES_PER_PAGE = 8;

async function handleWatchStart(
  ctx: Context,
  deps: EventActionDeps,
  eventId: number,
): Promise<void> {
  const data = await deps.locatorRepository.getEventData(eventId);
  if (!data) {
    await ctx.answerCbQuery('Locator unavailable for this event.', { show_alert: true });
    return;
  }

  await sendRosterPage(ctx, data.eventId, data.roster, 0);
}

async function sendRosterPage(
  ctx: Context,
  eventId: number,
  roster: readonly { displayName: string; status: string; profileImageUrl: string | null }[],
  page: number,
): Promise<void> {
  const totalPages = Math.ceil(roster.length / NAMES_PER_PAGE);
  const start = page * NAMES_PER_PAGE;
  const pageEntries = roster.slice(start, start + NAMES_PER_PAGE);

  const lines: string[] = [`Select a player to watch (page ${page + 1}/${totalPages}):`];
  const buttons: InlineKeyboardButton[][] = [];

  for (let i = 0; i < pageEntries.length; i++) {
    const entry = pageEntries[i]!;
    const idx = start + i;
    buttons.push([
      {
        text: `${entry.displayName} (${entry.status})`,
        callback_data: `event:${eventId}:watch:${page}:${idx}`,
      },
    ]);
  }

  if (page + 1 < totalPages) {
    buttons.push([
      {
        text: 'Next \u203A',
        callback_data: `event:${eventId}:watch:${page + 1}:0`,
      },
    ]);
  }

  // Back button
  buttons.push([{ text: '\u2190 Back to event', callback_data: `event:${eventId}` }]);

  await ctx.editMessageText(lines.join('\n'), {
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------------------------------------------------------------------------
// Watch: select — confirm watch
// ---------------------------------------------------------------------------

async function handleWatchSelect(
  ctx: Context,
  deps: EventActionDeps,
  eventId: number,
  page: number,
  idx: number,
): Promise<void> {
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.answerCbQuery('Could not identify your account.', { show_alert: true });
    return;
  }

  const data = await deps.locatorRepository.getEventData(eventId);
  if (!data) {
    await ctx.answerCbQuery('Roster changed, please try again.', { show_alert: true });
    return;
  }

  const rosterEntry = data.roster[idx];
  if (!rosterEntry) {
    await ctx.answerCbQuery('Roster changed, please try again.', { show_alert: true });
    return;
  }

  const now = new Date().toISOString();
  await deps.watchRepository.upsert({
    telegramId: userId,
    eventId,
    eventName: data.name,
    eventUsername: rosterEntry.displayName,
    lastSeenRound: null,
    lastSeenTable: null,
    lastSeenOpponent: null,
    lastSeenResult: null,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.editMessageText(
    `\uD83D\uDCE1 I'll DM you when your next pairing appears. Use /events unwatch to stop.`,
    { reply_markup: { inline_keyboard: [] } },
  );
}

// ---------------------------------------------------------------------------
// Admin: stop
// ---------------------------------------------------------------------------

async function handleAdminStop(
  ctx: Context,
  deps: EventActionDeps,
  targetTelegramId: number,
): Promise<void> {
  const adminId = ctx.from?.id;
  if (adminId == null || !deps.adminTelegramIds.includes(adminId)) {
    await ctx.answerCbQuery('This command is restricted.');
    return;
  }

  await deps.watchRepository.delete(targetTelegramId);

  // Re-fetch the list and rebuild the message
  const watches = await deps.watchRepository.list();
  if (watches.length === 0) {
    await ctx.editMessageText('No active watches.');
    return;
  }

  const lines: string[] = [];
  const buttons: InlineKeyboardButton[][] = [];

  for (const w of watches) {
    const ago = formatRelative(w.updatedAt, new Date());
    lines.push(
      `\u2022 ${w.telegramId} watching ${w.eventUsername} @ ${w.eventName} (event ${w.eventId}) \u2014 last seen: round ${w.lastSeenRound ?? '\u2014'}, table ${w.lastSeenTable ?? '\u2014'} (${ago})`,
    );
    buttons.push([{ text: 'Stop', callback_data: `admin:stop:${w.telegramId}` }]);
  }

  await ctx.editMessageText(lines.join('\n'), {
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}
