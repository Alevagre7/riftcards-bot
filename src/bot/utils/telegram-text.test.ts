import { describe, expect, it } from 'vitest';
import { joinTelegramLines, TELEGRAM_TEXT_LIMIT } from './telegram-text.js';

describe('joinTelegramLines', () => {
  it('keeps rendered output within Telegram’s text limit', () => {
    const output = joinTelegramLines(Array.from({ length: 1000 }, (_, i) => `row ${i}`));

    expect(output.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
    expect(output).toContain('More entries omitted.');
  });

  it('does not add a marker when all lines fit', () => {
    expect(joinTelegramLines(['one', 'two'])).toBe('one\ntwo');
  });
});
