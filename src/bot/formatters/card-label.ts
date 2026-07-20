// card-label: pure formatters for the multi-version search results
// displayed in /card buttons and the inline query list.
//
// The label format is print-level only — card-level properties like
// Signature do NOT appear here (see CONTEXT.md → Signature). The
// riftbound id is the natural label because it already encodes
// print-level suffixes (e.g. `ogn-066a` is the alt art of `ogn-066`).
// See ADR-0001 (composite key) and the Round-1 design discussion.

import { Card } from '../../core/entities/card.js';

// formatVersionLabel returns the button/text label for a single
// print. The set code is uppercased to match the public set_code
// style (e.g. `VEN-21` rather than `ven-21`). The local part of the
// riftbound id keeps its original case so the letter suffix on alt
// arts is readable (`VEN-21a` rather than `VEN-21A`).
//
// Examples:
//   riftbound_id `ven-21`        → `VEN-21`
//   riftbound_id `ven-21a`       → `VEN-21a`
//   riftbound_id `ogn-066`       → `OGN-066`
//
// Print-level suffixes (`Alt Art`, `Overnumbered`) are appended
// after the label, separated by ` · `, only when the boolean flag
// is set on the entity. Signature is intentionally absent: it is
// a card-level type, not a print-level variant (see CONTEXT.md).
export function formatVersionLabel(card: Card): string {
  const base = labelBase(card);
  const suffixes: string[] = [];
  if (card.isAlternateArt) suffixes.push('Alt Art');
  if (card.isOvernumbered) suffixes.push('Overnumbered');
  return suffixes.length > 0 ? `${base} \u00B7 ${suffixes.join(' \u00B7 ')}` : base;
}

function labelBase(card: Card): string {
  if (card.riftboundId) {
    const [setCode, ...rest] = card.riftboundId.split('-');
    if (setCode && rest.length > 0) {
      return `${setCode.toUpperCase()}-${rest.join('-')}`;
    }
  }
  return `${card.setCode.toUpperCase()}-${card.collectorNumber}`;
}

// sortByVersion sorts cards with base prints first, then prints
// carrying the alt-art / overnumbered flag, in ascending
// collector-number order. This is the canonical order for
// multi-version result lists so the user always sees the base
// print at the top.
export function sortByVersion(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const aBase = !a.isAlternateArt && !a.isOvernumbered ? 0 : 1;
    const bBase = !b.isAlternateArt && !b.isOvernumbered ? 0 : 1;
    if (aBase !== bBase) return aBase - bBase;
    return compareCollectorNumber(a.collectorNumber, b.collectorNumber);
  });
}

function compareCollectorNumber(a: string, b: string): number {
  // Natural sort: "11" < "11a" < "11b" < "12". The riftbound id
  // encodes the print suffix in its second segment; the collector
  // number is bare. We compare on numeric prefix, then on the rest
  // of the string so `11a` sorts between `11` and `12`.
  const aNum = parseInt(a, 10);
  const bNum = parseInt(b, 10);
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum) {
    return aNum - bNum;
  }
  return a.localeCompare(b);
}
