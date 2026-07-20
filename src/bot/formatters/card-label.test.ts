import { describe, expect, it } from 'vitest';
import { Card } from '../../core/entities/card.js';
import { formatVersionLabel, sortByVersion } from './card-label.js';

const baseCard = (over: Partial<Card> = {}): Card => ({
  id: 'ogn-011/11',
  name: 'Magma Wurm',
  setCode: 'ogn',
  collectorNumber: '11',
  rarity: 'Common',
  type: 'Unit',
  keywords: [],
  riftboundId: 'ogn-011',
  ...over,
});

describe('formatVersionLabel', () => {
  it('uppercases the set code from the riftbound id', () => {
    expect(formatVersionLabel(baseCard())).toBe('OGN-011');
  });

  it('keeps the local-part case (so alt-art suffix is readable)', () => {
    expect(
      formatVersionLabel(
        baseCard({ riftboundId: 'ogn-011a', collectorNumber: '11a' }),
      ),
    ).toBe('OGN-011a');
  });

  it('falls back to setCode-collectorNumber when riftboundId is missing', () => {
    // exactOptionalPropertyTypes forbids `riftboundId: undefined`,
    // so we destructure to omit the field entirely.
    const { riftboundId: _omit, ...rest } = baseCard();
    expect(formatVersionLabel(rest)).toBe('OGN-11');
  });

  it('appends "· Alt Art" when isAlternateArt is set', () => {
    expect(
      formatVersionLabel(
        baseCard({ riftboundId: 'ogn-011a', isAlternateArt: true }),
      ),
    ).toBe('OGN-011a \u00B7 Alt Art');
  });

  it('appends "· Overnumbered" when isOvernumbered is set', () => {
    expect(
      formatVersionLabel(
        baseCard({ riftboundId: 'ogn-298b', isOvernumbered: true }),
      ),
    ).toBe('OGN-298b \u00B7 Overnumbered');
  });

  it('does NOT append "· Signature" — Signature is card-level, not print-level', () => {
    // This is the canonical rule from CONTEXT.md: signatures are a
    // type of Card, not a variant of a print. The label must stay
    // print-disambiguator-only.
    const signed = baseCard({ riftboundId: 'ogn-270', isSignature: true });
    expect(formatVersionLabel(signed)).toBe('OGN-270');
  });

  it('combines multiple print-level suffixes in stable order', () => {
    expect(
      formatVersionLabel(
        baseCard({
          riftboundId: 'ogn-298a',
          isAlternateArt: true,
          isOvernumbered: true,
        }),
      ),
    ).toBe('OGN-298a \u00B7 Alt Art \u00B7 Overnumbered');
  });
});

describe('sortByVersion', () => {
  it('puts the base print first', () => {
    const alt = baseCard({ id: 'ogn-011a/11a', riftboundId: 'ogn-011a', isAlternateArt: true });
    const base = baseCard();
    expect(sortByVersion([alt, base])).toEqual([base, alt]);
  });

  it('sorts prints within the same tier by collector number ascending', () => {
    const a = baseCard({ id: 'ogn-013/13', riftboundId: 'ogn-013', collectorNumber: '13' });
    const b = baseCard({ id: 'ogn-011/11', riftboundId: 'ogn-011', collectorNumber: '11' });
    const c = baseCard({ id: 'ogn-012/12', riftboundId: 'ogn-012', collectorNumber: '12' });
    expect(sortByVersion([a, b, c])).toEqual([b, c, a]);
  });

  it('does not mutate the input array', () => {
    const alt = baseCard({ id: 'ogn-011a/11a', riftboundId: 'ogn-011a', isAlternateArt: true });
    const base = baseCard();
    const input = [alt, base];
    const snapshot = [...input];
    sortByVersion(input);
    expect(input).toEqual(snapshot);
  });

  it('returns an empty array for empty input', () => {
    expect(sortByVersion([])).toEqual([]);
  });
});
