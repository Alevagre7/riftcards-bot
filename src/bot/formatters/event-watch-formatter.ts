import type { InlineKeyboardButton } from '@telegraf/types/markup.js';
import { escapeHtml } from './card-formatter.js';
import {
  statusLiveState,
  WatchStatus,
} from '../services/event-watch-manager.js';

export interface EventWatchMessage {
  readonly body: string;
  readonly buttons: InlineKeyboardButton[][];
}

function formatRelative(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const diffSec = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function formatResult(result: WatchStatus['watch']['lastSeenResult']): string | null {
  switch (result) {
    case 'win': return 'Win';
    case 'loss': return 'Loss';
    case 'draw': return 'Draw';
    case 'bye': return 'Bye';
    default: return null;
  }
}

export function formatEventWatchStatus(
  status: WatchStatus,
  options: { now?: Date; daysAhead?: number } = {},
): EventWatchMessage {
  const now = options.now ?? new Date();
  const daysAhead = options.daysAhead ?? 7;
  const { watch } = status;
  const live = statusLiveState(status);
  const lines = [
    `👁 <b>Watching ${escapeHtml(watch.eventUsername)}</b>`,
    `🏆 ${escapeHtml(watch.eventName)}`,
  ];

  switch (status.kind) {
    case 'degraded':
      lines.push(`⚠️ Temporarily unavailable (${watch.consecutiveFailures} failed checks).`);
      break;
    case 'missing':
      lines.push(`⏳ Event data unavailable; retry ${watch.consecutiveMissing}/3.`);
      break;
    case 'waiting':
      lines.push('⏳ Waiting for their next pairing.');
      break;
    case 'paired': {
      const round = live.round == null ? 'unknown' : String(live.round);
      const table = live.table == null ? 'unknown' : String(live.table);
      const opponent = live.opponent ?? 'not assigned';
      lines.push(`🎲 Round ${round} · Table ${table} · vs ${escapeHtml(opponent)}`);
      const result = formatResult(live.result);
      if (result) lines.push(`📝 Result: ${result}`);
      break;
    }
  }

  lines.push(`Last change: ${formatRelative(watch.updatedAt, now)}`);
  lines.push(`Last checked: ${formatRelative(watch.lastCheckedAt, now)}`);
  if (status.refreshError) lines.push('⚠️ Refresh could not reach the event right now.');

  return {
    body: lines.join('\n'),
    buttons: [
      [{ text: '🔄 Refresh', callback_data: 'watch:refresh' }],
      [{ text: '🔄 Change watch', callback_data: `event:range:${daysAhead}` }],
      [{ text: '🛑 Stop watching', callback_data: `watch:stop:${watch.revision}` }],
    ],
  };
}

export function formatNoEventWatch(daysAhead: number): EventWatchMessage {
  return {
    body: 'You are not watching anyone.',
    buttons: [[{ text: '📅 Browse events', callback_data: `event:range:${daysAhead}` }]],
  };
}
