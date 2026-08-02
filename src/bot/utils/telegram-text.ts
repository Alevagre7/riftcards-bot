/** Telegram rejects text messages and captions above this size. */
export const TELEGRAM_TEXT_LIMIT = 4096;

const TRUNCATION_MARKER = '\u2026\n<i>More entries omitted.</i>';

/**
 * Join already-formatted lines without producing a message Telegram will
 * reject. Lines are only dropped at boundaries, so callers do not end up
 * with half of an HTML tag or half of a rendered record.
 */
export function joinTelegramLines(
  lines: readonly string[],
  maxLength: number = TELEGRAM_TEXT_LIMIT,
): string {
  const full = lines.join('\n');
  if (full.length <= maxLength) return full;

  const kept: string[] = [];

  for (const line of lines) {
    const candidate = [...kept, line].join('\n');
    if (candidate.length + TRUNCATION_MARKER.length <= maxLength) {
      kept.push(line);
      continue;
    }
    break;
  }

  while (kept.length > 0 && [...kept, TRUNCATION_MARKER].join('\n').length > maxLength) {
    kept.pop();
  }

  const result = [...kept, TRUNCATION_MARKER].join('\n');
  return result.length <= maxLength
    ? result
    : TRUNCATION_MARKER.slice(0, maxLength);
}
