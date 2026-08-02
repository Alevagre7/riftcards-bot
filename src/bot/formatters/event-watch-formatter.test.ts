import { describe, expect, it } from 'vitest';
import { EventWatch } from '../../core/entities/event-watch.js';
import { WatchStatus } from '../services/event-watch-manager.js';
import { formatEventWatchStatus, formatNoEventWatch } from './event-watch-formatter.js';

function status(): WatchStatus {
  const now = new Date().toISOString();
  const watch: EventWatch = {
    telegramId: 7,
    revision: 'revision-1',
    eventId: 42,
    eventName: 'Test Event',
    eventUsername: 'Alice',
    hasObservedPairing: true,
    lastSeenRound: 2,
    lastSeenTable: 5,
    lastSeenOpponent: 'Bob',
    lastSeenResult: null,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: now,
    consecutiveFailures: 0,
    consecutiveMissing: 0,
  };
  return {
    watch,
    kind: 'paired',
    live: null,
    refreshed: false,
    refreshError: false,
  };
}

describe('formatEventWatchStatus', () => {
  it('uses the configured event window for the change-watch action', () => {
    const message = formatEventWatchStatus(status(), {
      now: new Date(),
      daysAhead: 14,
    });

    expect(message.buttons[1]?.[0]).toEqual({
      text: '🔄 Change watch',
      callback_data: 'event:range:14',
    });
  });
});

describe('formatNoEventWatch', () => {
  it('uses the configured event window for browsing', () => {
    expect(formatNoEventWatch(14).buttons[0]?.[0]).toEqual({
      text: '📅 Browse events',
      callback_data: 'event:range:14',
    });
  });
});
