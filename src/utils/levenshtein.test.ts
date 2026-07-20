import { describe, expect, it } from 'vitest';
import { levenshtein } from './levenshtein.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('ahri', 'ahri')).toBe(0);
  });

  it('counts single-character substitutions', () => {
    expect(levenshtein('ahri', 'ahru')).toBe(1);
  });

  it('counts insertions and deletions', () => {
    expect(levenshtein('ahri', 'ah')).toBe(2);
    expect(levenshtein('ah', 'ahri')).toBe(2);
  });

  it('handles the empty-string cases', () => {
    expect(levenshtein('', 'ahri')).toBe(4);
    expect(levenshtein('ahri', '')).toBe(4);
    expect(levenshtein('', '')).toBe(0);
  });

  it('produces a stable rank for typical card-name typos', () => {
    // Real-world misspellings the user might type when looking
    // for a card. The distance is what we re-rank by.
    // akali → aklai: one transposition of 'a' and 'l', which
    // Levenshtein encodes as 2 edits (sub or ins+del).
    expect(levenshtein('akali', 'aklai')).toBe(2);
    // magma wurm → magma worm: single-character substitution.
    expect(levenshtein('magma wurm', 'magma worm')).toBe(1);
    // ahri → ahri (exact match) ranks at 0; ahri → akali ranks
    // higher, which is the whole point of the re-rank.
    expect(levenshtein('ahri', 'ahri')).toBeLessThan(levenshtein('ahri', 'akali'));
  });

  it('is case-sensitive (callers must lowercase first)', () => {
    expect(levenshtein('Ahri', 'ahri')).toBe(1);
  });
});
