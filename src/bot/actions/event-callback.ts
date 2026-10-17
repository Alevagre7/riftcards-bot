import { Context } from 'telegraf';
import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import type { EventId, RoundId } from '../../core/entities/event-id.js';
import { IEventRepository, EventLocation } from '../../core/ports/event-repository.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { IUserSettingsRepository } from '../../core/ports/user-settings-repository.js';
import { IEventWatchManager } from '../services/event-watch-manager.js';
import type { WatchSubscriptionResult } from '../services/event-watch-manager.js';
import type { EventWatch } from '../../core/entities/event-watch.js';
import { EventRoundSummary } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { EventPairing, EventStanding } from '../../core/entities/event-detail.js';
import {
  renderEventList,
  renderEventDetail,
  renderEventsPage,
  resolveEventLocation,
} from '../commands/events.js';
import { formatEventLeaderboard } from '../formatters/event-leaderboard-formatter.js';
import { formatEventRounds } from '../formatters/event-rounds-formatter.js';
import type { IEventNavigationContext } from '../state/event-navigation-context.js';
import { escapeHtml } from '../formatters/card-formatter.js';
import { formatEventWatchStatus, formatNoEventWatch } from '../formatters/event-watch-formatter.js';
import { encodeEventId, encodeRoundId, decodeEventId, decodeWatchCallback, watchSelectionCallback, watchReplacementCallback } from '../utils/event-callback-codec.js';

interface EventActionDeps {
  eventRepository: IEventRepository;
  eventListingRepository: IEventListingRepository;
  watchManager: IEventWatchManager;
  userSettingsRepository: IUserSettingsRepository;
  eventNavigationContext: IEventNavigationContext;
  defaultLocation: EventLocation;
  daysAhead: number;
  adminTelegramIds: number[];
}

export function createEventActionHandler(deps: EventActionDeps) {
  return async (ctx: Context) => {
    const data =
      ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data || (!data.startsWith('event:') && !data.startsWith('admin:') && !data.startsWith('watch:') && !data.startsWith('wps:') && !data.startsWith('wpr:'))) return;

    await ctx.answerCbQuery();

    if (data.startsWith('wps:') || data.startsWith('wpr:')) {
      const decoded = decodeWatchCallback(data);
      if (!decoded) {
        await ctx.reply('That button is invalid. Open the event again.');
        return;
      }
      if (decoded.revision !== undefined) {
        await handleWatchReplace(ctx, deps, decoded.eventId, decoded.registrationId, decoded.revision);
      } else {
        await handleWatchSelect(ctx, deps, decoded.eventId, decoded.registrationId);
      }
      return;
    }

    // No-op: page label click — silent ack
    if (data === 'event:noop') return;

    // Admin: stop watch
    const adminStopMatch = /^admin:stop:(\d+):(.+)$/.exec(data);
    if (adminStopMatch) {
      await handleAdminStop(ctx, deps, parseInt(adminStopMatch[1]!, 10), adminStopMatch[2]!);
      return;
    }

    if (data === 'watch:show') {
      await handleWatchStatus(ctx, deps, false);
      return;
    }
    if (data === 'watch:refresh') {
      await handleWatchStatus(ctx, deps, true);
      return;
    }
    const watchStopMatch = /^watch:stop:(.+)$/.exec(data);
    if (watchStopMatch) {
      await handleWatchStop(ctx, deps, watchStopMatch[1]!);
      return;
    }
    const watchReplaceMatch = /^watch:replace:(\d+):(\d+):(.+)$/.exec(data);
    if (watchReplaceMatch) {
      await handleWatchReplace(
        ctx,
        deps,
        parseInt(watchReplaceMatch[1]!, 10),
        parseInt(watchReplaceMatch[2]!, 10),
        watchReplaceMatch[3]!,
      );
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

    // Back to list uses the remembered window when a live list context exists.
    // A missing or expired context falls back to the configured default.
    if (data === 'event:list') {
      const stored = deps.eventNavigationContext.getEventList(ctx.from?.id);
      const days = stored?.daysAhead ?? deps.daysAhead;
      await renderEventList(ctx, deps, days);
      return;
    }

    // Event opened from an actual list row. The navigation context clears
    // only this Event's direct marker and preserves the list context.
    const listEventMatch = /^event:list:([0-9]+|r[0-9a-z]+)$/.exec(data);
    if (listEventMatch) {
      const eventId = decodeEventId(listEventMatch[1]!);
      const userId = ctx.from?.id;
      deps.eventNavigationContext.openEventFromList(userId, eventId);
      await renderEventDetail(ctx, deps, eventId);
      return;
    }

    // Leaderboard view (current round)
    const leaderboardMatch = /^event:([0-9]+|r[0-9a-z]+):leaderboard$/.exec(data);
    if (leaderboardMatch) {
      await handleLeaderboard(ctx, deps, decodeEventId(leaderboardMatch[1]!));
      return;
    }

    // Leaderboard for a specific round (←/→ round nav)
    const leaderboardRoundMatch = /^event:([0-9]+|r[0-9a-z]+):leaderboard:round:(\d+|q[A-Za-z0-9_-]{16})$/.exec(data);
    if (leaderboardRoundMatch) {
      await handleLeaderboard(
        ctx,
        deps,
        decodeEventId(leaderboardRoundMatch[1]!),
        leaderboardRoundMatch[2]!.startsWith('q') ? leaderboardRoundMatch[2]! : parseInt(leaderboardRoundMatch[2]!, 10),
      );
      return;
    }

    // All tables / rounds view (current round)
    const roundsMatch = /^event:([0-9]+|r[0-9a-z]+):rounds$/.exec(data);
    if (roundsMatch) {
      await handleRounds(ctx, deps, decodeEventId(roundsMatch[1]!));
      return;
    }

    // All tables for a specific round (←/→ round nav)
    const roundsRoundMatch = /^event:([0-9]+|r[0-9a-z]+):rounds:round:(\d+|q[A-Za-z0-9_-]{16})$/.exec(data);
    if (roundsRoundMatch) {
      await handleRounds(
        ctx,
        deps,
        decodeEventId(roundsRoundMatch[1]!),
        roundsRoundMatch[2]!.startsWith('q') ? roundsRoundMatch[2]! : parseInt(roundsRoundMatch[2]!, 10),
      );
      return;
    }
    // Watch: start picker
    const watchStartMatch = /^event:([0-9]+|r[0-9a-z]+):watch:start$/.exec(data);
    if (watchStartMatch) {
      await handleWatchStart(ctx, deps, decodeEventId(watchStartMatch[1]!));
      return;
    }

    // Watch: roster page navigation
    const watchPageMatch = /^event:([0-9]+|r[0-9a-z]+):watch:page:(-?\d+)$/.exec(data);
    if (watchPageMatch) {
      await handleWatchPage(
        ctx,
        deps,
        decodeEventId(watchPageMatch[1]!),
        parseInt(watchPageMatch[2]!, 10),
      );
      return;
    }

    // Watch: select player by stable registration id
    const watchSelectMatch = /^event:([0-9]+|r[0-9a-z]+):watch:select:(\d+)$/.exec(data);
    if (watchSelectMatch) {
      await handleWatchSelect(
        ctx,
        deps,
        decodeEventId(watchSelectMatch[1]!),
        parseInt(watchSelectMatch[2]!, 10),
      );
      return;
    }

    // Single event detail
    const match = /^event:([0-9]+|r[0-9a-z]+)$/.exec(data);
    if (match) {
      const id = decodeEventId(match[1]!);
      await renderEventDetail(ctx, deps, id);
      return;
    }

    // Unknown — ignore silently
  };
}

// ---------------------------------------------------------------------------
// Round view helpers (←/→ round nav + ← Back to event)
// ---------------------------------------------------------------------------

// Compose the full keyboard for a leaderboard / all-tables view. The
// layout is: an optional round-nav row, then a Back-to-event row.
// Hoisted so the handlers below can reference it.
function composeRoundViewKeyboard(
  allRounds: readonly EventRoundSummary[],
  displayedRoundId: RoundId | null,
  eventId: EventId,
  kind: 'leaderboard' | 'rounds',
): InlineKeyboardButton[][] {
  const keyboard: InlineKeyboardButton[][] = [];
  if (displayedRoundId != null) {
    const nav = buildRoundNavRow(allRounds, displayedRoundId, eventId, kind);
    if (nav.length > 0) keyboard.push(nav);
  }
  keyboard.push([{ text: '\u2190 Back to event', callback_data: `event:${encodeEventId(eventId)}` }]);
  return keyboard;
}

function orderRounds(
  phases: readonly { orderInPhases: number; rounds: readonly EventRoundSummary[] }[],
): EventRoundSummary[] {
  return [...phases]
    .sort((a, b) => a.orderInPhases - b.orderInPhases)
    .flatMap((phase) => [...phase.rounds].sort((a, b) => a.roundNumber - b.roundNumber));
}

function buildRoundNavRow(
  allRounds: readonly EventRoundSummary[],
  currentRoundId: RoundId,
  eventId: EventId,
  kind: 'leaderboard' | 'rounds',
): InlineKeyboardButton[] {
  const idx = allRounds.findIndex((r) => r.id === currentRoundId);
  if (idx === -1) return [];
  const row: InlineKeyboardButton[] = [];
  if (idx > 0) {
    const prev = allRounds[idx - 1]!;
    row.push({
      text: `\u2190 Round ${prev.roundNumber}`,
      callback_data: `event:${encodeEventId(eventId)}:${kind}:round:${encodeRoundId(prev.id)}`,
    });
  }
  if (idx < allRounds.length - 1) {
    const next = allRounds[idx + 1]!;
    row.push({
      text: `Round ${next.roundNumber} \u2192`,
      callback_data: `event:${encodeEventId(eventId)}:${kind}:round:${encodeRoundId(next.id)}`,
    });
  }
  return row;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

async function handleLeaderboard(
  ctx: Context,
  deps: EventActionDeps,
  eventId: EventId,
  roundId?: number | string,
): Promise<void> {
  const location = await resolveEventLocation(ctx.from?.id, deps);
  const data = await deps.eventRepository.getEventDetail(eventId, location);
  if (!data) {
    await ctx.reply('Event data not available.');
    return;
  }
  const allRounds = orderRounds(data.event.tournamentPhases);
  let displayedRoundId: RoundId | null = null;
  let displayedRoundNumber: number | null = null;
  let standings: readonly EventStanding[] = [];
  if (roundId != null) {
    const matches = allRounds.filter((r) => encodeRoundId(r.id) === String(roundId));
    const round = matches.length === 1 ? matches[0] : undefined;
    if (!round) {
      await ctx.reply('Round not found.');
      return;
    }
    displayedRoundId = round.id;
    displayedRoundNumber = round.roundNumber;
    standings = await deps.eventRepository.getEventStandings(round.id);
  } else {
    // Default view: the latest round that actually has standings
    // data. The current round often has none (standings are only
    // generated once the round completes or results land), which
    // previously rendered an empty leaderboard.
    const sorted = [...allRounds].reverse();
    const startIdx = data.currentRound != null
      ? Math.max(0, sorted.findIndex((r) => r.id === data.currentRound!.id))
      : 0;
    let found = false;
    for (let i = startIdx; i < sorted.length; i++) {
      const round = sorted[i]!;
      const rows = round.id === (data.standingsRoundId ?? data.currentRound?.id)
        ? data.standings
        : await deps.eventRepository.getEventStandings(round.id);
      if (rows.length > 0) {
        displayedRoundId = round.id;
        displayedRoundNumber = round.roundNumber;
        standings = rows;
        found = true;
        break;
      }
    }
    if (!found) {
      displayedRoundId = data.currentRound?.id ?? null;
      displayedRoundNumber = data.currentRound?.roundNumber ?? null;
      standings = data.standings;
    }
  }
  const body = formatEventLeaderboard({
    name: data.event.name,
    currentRound: displayedRoundNumber,
    standings,
  });
  const keyboard = composeRoundViewKeyboard(
    allRounds, displayedRoundId, eventId, 'leaderboard',
  );
  await ctx.editMessageText(body, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

async function handleRounds(
  ctx: Context,
  deps: EventActionDeps,
  eventId: EventId,
  roundId?: number | string,
): Promise<void> {
  const location = await resolveEventLocation(ctx.from?.id, deps);
  const data = await deps.eventRepository.getEventDetail(eventId, location);
  if (!data) {
    await ctx.reply('Event data not available.');
    return;
  }
  const allRounds = orderRounds(data.event.tournamentPhases);
  let displayedRound: EventRoundSummary | null;
  let displayedRoundId: RoundId | null;
  let displayedRoundNumber: number | null;
  let pairings: readonly EventPairing[];
  if (roundId != null) {
    const matches = allRounds.filter((r) => encodeRoundId(r.id) === String(roundId));
    const round = matches.length === 1 ? matches[0] : undefined;
    if (!round) {
      await ctx.reply('Round not found.');
      return;
    }
    displayedRound = round;
    displayedRoundId = round.id;
    displayedRoundNumber = round.roundNumber;
    pairings = await deps.eventRepository.getEventMatches(round.id);
  } else {
    displayedRound = data.currentRound;
    displayedRoundId = data.currentRound?.id ?? null;
    displayedRoundNumber = data.currentRound?.roundNumber ?? null;
    pairings = data.pairings;
  }
  const body = formatEventRounds({
    name: data.event.name,
    currentRound: displayedRound,
    pairings,
  });
  const keyboard = composeRoundViewKeyboard(
    allRounds, displayedRoundId, eventId, 'rounds',
  );
  await ctx.editMessageText(body, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  });
}

// ---------------------------------------------------------------------------
// Watch: start — show roster picker
// ---------------------------------------------------------------------------

const NAMES_PER_PAGE = 8;

async function handleWatchStart(
  ctx: Context,
  deps: EventActionDeps,
  eventId: EventId,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const location = await resolveEventLocation(ctx.from?.id, deps);
  const data = await deps.eventRepository.getEventDetail(eventId, location);
  if (!data) {
    await ctx.reply('Event data not available.');
    return;
  }

  if (data.event.supportsTracking === false) {
    await ctx.reply('Player tracking is currently available for 1v1 events only.');
    return;
  }
  await sendRosterPage(
    ctx,
    data.event.id,
    data.registrations.filter((entry) => entry.status === 'Active'),
    0,
  );
}

async function handleWatchPage(
  ctx: Context,
  deps: EventActionDeps,
  eventId: EventId,
  page: number,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const location = await resolveEventLocation(ctx.from?.id, deps);
  const data = await deps.eventRepository.getEventDetail(eventId, location);
  if (!data) {
    await ctx.reply('Roster changed, please try again.');
    return;
  }
  if (data.event.supportsTracking === false) {
    await ctx.reply('Player tracking is currently available for 1v1 events only.');
    return;
  }
  await sendRosterPage(
    ctx,
    data.event.id,
    data.registrations.filter((entry) => entry.status === 'Active'),
    page,
  );
}

async function sendRosterPage(
  ctx: Context,
  eventId: EventId,
  roster: readonly EventRegistration[],
  page: number,
): Promise<void> {
  const buttons: InlineKeyboardButton[][] = [];
  if (roster.length === 0) {
    buttons.push([{ text: '\u2190 Back to event', callback_data: `event:${encodeEventId(eventId)}` }]);
    await ctx.editMessageText('No active players available to watch yet.', {
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  const totalPages = Math.ceil(roster.length / NAMES_PER_PAGE);
  if (page < 0 || page >= totalPages) {
    await ctx.reply('Roster changed, please try again.');
    return;
  }

  const start = page * NAMES_PER_PAGE;
  const pageEntries = roster.slice(start, start + NAMES_PER_PAGE);
  const lines: string[] = [`Select a player to watch (page ${page + 1}/${totalPages}):`];

  for (const entry of pageEntries) {
    buttons.push([
      {
        text: `${entry.name} (${entry.status})`,
        callback_data: watchSelectionCallback(eventId, entry.id),
      },
    ]);
  }

  if (page + 1 < totalPages) {
    buttons.push([
      {
        text: 'Next \u203A',
        callback_data: `event:${encodeEventId(eventId)}:watch:page:${page + 1}`,
      },
    ]);
  }

  buttons.push([{ text: '\u2190 Back to event', callback_data: `event:${encodeEventId(eventId)}` }]);

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
  eventId: EventId,
  registrationId: number | string,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply('Could not identify your account.');
    return;
  }

  const location = await resolveEventLocation(userId, deps);
  const data = await deps.eventRepository.getEventDetail(eventId, location);
  if (!data) {
    await ctx.reply('Roster changed, please try again.');
    return;
  }

  const rosterEntry = data.registrations.find((entry) => entry.id === registrationId);
  if (data.event.supportsTracking === false) {
    await ctx.reply('Player watches support 1v1 events only.');
    return;
  }
  if (!rosterEntry || rosterEntry.status !== 'Active') {
    await ctx.reply('Roster changed, please try again.');
    return;
  }

  const result = await deps.watchManager.requestSubscription(userId, {
    eventId,
    supportsTracking: true,
    eventName: data.event.name,
    eventUsername: rosterEntry.name,
    ...(typeof eventId === 'string' ? { registrationId: rosterEntry.id } : {}),
  });
  await renderWatchSelectionResult(ctx, result, data.event.name, rosterEntry.name, eventId, registrationId);
}

async function handleWatchReplace(
  ctx: Context,
  deps: EventActionDeps,
  eventId: EventId,
  registrationId: number | string,
  expectedRevision: string,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply('Could not identify your account.');
    return;
  }
  const location = await resolveEventLocation(userId, deps);
  const data = await deps.eventRepository.getEventDetail(eventId, location);
  const rosterEntry = data?.registrations.find((entry) => entry.id === registrationId);
  if (data?.event.supportsTracking === false) {
    await ctx.reply('Player watches support 1v1 events only.');
    return;
  }
  if (!data || !rosterEntry || rosterEntry.status !== 'Active') {
    await ctx.reply('Roster changed, please try again.');
    return;
  }
  const result = await deps.watchManager.replaceSubscription(
    userId,
    { eventId, supportsTracking: true, eventName: data.event.name, eventUsername: rosterEntry.name,
      ...(typeof eventId === 'string' ? { registrationId: rosterEntry.id } : {}) },
    expectedRevision,
  );
  if (result.kind === 'stale') {
    await editWatchMessage(ctx, 'That replacement is no longer current.', [[{ text: 'View watch', callback_data: 'watch:show' }]]);
    return;
  }
  if (result.kind !== 'subscribed') return;
  await renderWatchConfirmation(ctx, result.watch, true);
}

async function renderWatchSelectionResult(
  ctx: Context,
  result: WatchSubscriptionResult,
  eventName: string,
  username: string,
  eventId: EventId,
  registrationId: number | string,
): Promise<void> {
  if (result.kind === 'unsupported') {
    await ctx.reply(result.reason);
    return;
  }
  if (result.kind === 'already-watching') {
    await editWatchMessage(
      ctx,
      `\uD83D\uDC41 Already watching <b>${escapeHtml(username)}</b> at <b>${escapeHtml(eventName)}</b>.`,
      [
        [{ text: 'View watch', callback_data: 'watch:show' }],
        [{ text: '\uD83D\uDED1 Stop watching', callback_data: `watch:stop:${result.watch.revision}` }],
      ],
    );
    return;
  }
  if (result.kind === 'needs-confirmation') {
    await editWatchMessage(
      ctx,
      `You are currently watching <b>${escapeHtml(result.current.eventUsername)}</b> at <b>${escapeHtml(result.current.eventName)}</b>. Replace it with <b>${escapeHtml(username)}</b> at <b>${escapeHtml(eventName)}</b>?`,
      [
        [{ text: 'Replace watch', callback_data: watchReplacementCallback(eventId, registrationId, result.current.revision) }],
        [{ text: 'Keep current', callback_data: 'watch:show' }],
      ],
    );
    return;
  }
  if (result.kind === 'subscribed') {
    await renderWatchConfirmation(ctx, result.watch, false);
  }
}

async function renderWatchConfirmation(
  ctx: Context,
  watch: EventWatch,
  replaced: boolean,
): Promise<void> {
  const action = replaced ? 'Watch replaced' : 'Watching';
  await editWatchMessage(
    ctx,
    `\uD83D\uDCE1 ${action} <b>${escapeHtml(watch.eventUsername)}</b> at <b>${escapeHtml(watch.eventName)}</b>. I\'ll DM you about every pairing and result update.`,
    [
      [{ text: 'View watch', callback_data: 'watch:show' }],
      [{ text: '\uD83D\uDED1 Stop watching', callback_data: `watch:stop:${watch.revision}` }],
    ],
  );
}

async function handleWatchStatus(
  ctx: Context,
  deps: EventActionDeps,
  refresh: boolean,
): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply('Could not identify your account.');
    return;
  }
  const status = refresh
    ? await deps.watchManager.refreshStatus(userId)
    : await deps.watchManager.getStatus(userId);
  if (!status) {
    const empty = formatNoEventWatch(deps.daysAhead);
    await editWatchMessage(ctx, empty.body, empty.buttons);
    return;
  }
  const message = formatEventWatchStatus(status, { daysAhead: deps.daysAhead });
  await editWatchMessage(ctx, message.body, message.buttons, true);
}

async function handleWatchStop(ctx: Context, deps: EventActionDeps, revision: string): Promise<void> {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Watch management is available in a private chat with me.');
    return;
  }
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.reply('Could not identify your account.');
    return;
  }
  const result = await deps.watchManager.stop(userId, revision);
  switch (result.kind) {
    case 'stopped':
      await editWatchMessage(ctx, '\uD83D\uDED1 Watch stopped.', []);
      return;
    case 'no-active-watch':
      await editWatchMessage(ctx, 'You are not watching anyone.', []);
      return;
    case 'stale':
      await editWatchMessage(ctx, 'That watch is no longer active.', []);
      return;
  }
}

async function editWatchMessage(
  ctx: Context,
  body: string,
  buttons: InlineKeyboardButton[][],
  html = true,
): Promise<void> {
  const options = {
    ...(html ? { parse_mode: 'HTML' as const } : {}),
    reply_markup: { inline_keyboard: buttons },
  };
  if (ctx.callbackQuery?.message) await ctx.editMessageText(body, options);
  else await ctx.reply(body, options);
}

// ---------------------------------------------------------------------------
// Admin: stop
// ---------------------------------------------------------------------------

async function handleAdminStop(
  ctx: Context,
  deps: EventActionDeps,
  targetTelegramId: number,
  revision: string,
): Promise<void> {
  const adminId = ctx.from?.id;
  if (adminId == null || !deps.adminTelegramIds.includes(adminId)) {
    await ctx.reply('This command is restricted.');
    return;
  }

  await deps.watchManager.stop(targetTelegramId, revision);

  // Re-fetch the list and rebuild the message
  const watches = await deps.watchManager.list();
  if (watches.length === 0) {
    await ctx.editMessageText('No active watches.');
    return;
  }

  const lines: string[] = [];
  const buttons: InlineKeyboardButton[][] = [];

  for (const w of watches) {
    const ago = formatRelative(w.updatedAt, new Date());
    lines.push(
      `\u2022 ${w.telegramId} watching ${w.eventUsername} @ ${w.eventName} (event ${w.eventId}) \u2014 last change: round ${w.lastSeenRound ?? '\u2014'}, table ${w.lastSeenTable ?? '\u2014'} (${ago}); checked ${formatRelative(w.lastCheckedAt, new Date())}`,
    );
    buttons.push([{ text: 'Stop', callback_data: `admin:stop:${w.telegramId}:${w.revision}` }]);
  }

  await ctx.editMessageText(lines.join('\n'), {
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string | null, now: Date): string {
  if (!iso) return '—';
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
