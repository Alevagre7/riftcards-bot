import { describe, expect, it } from 'vitest';
import { stripCommand } from './strip-command.js';

describe('stripCommand', () => {
  it('strips the leading /command and any whitespace', () => {
    expect(stripCommand('/card Flameblade', 'card')).toBe('Flameblade');
  });

  it('strips a bot-name suffix', () => {
    expect(stripCommand('/card@RiftCardsBot ahri', 'card')).toBe('ahri');
  });

  it('returns an empty string when only the command is present', () => {
    expect(stripCommand('/card', 'card')).toBe('');
    expect(stripCommand('/card   ', 'card')).toBe('');
  });

  it('is case-insensitive on the command name', () => {
    expect(stripCommand('/CARD ogn-011', 'card')).toBe('ogn-011');
  });

  it('leaves the text alone if the command does not match', () => {
    // Defensive: the message handler routes by command, so this
    // branch should not fire in production, but the helper must
    // not corrupt unrelated text.
    expect(stripCommand('not a command', 'card')).toBe('not a command');
  });
});
