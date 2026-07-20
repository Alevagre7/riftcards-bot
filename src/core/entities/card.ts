// Card is the bot's flat view of a Riftbound card. The shape is
// designed for direct use by the bot layer (commands, formatters,
// inline queries); the riftapi wire shape is nested and the
// translation lives in riftapi-mapper.ts.
//
// The id field is a composite of the riftbound id and the collector
// number (`${riftboundId}/${collectorNumber}`, e.g. `ogn-011/298`).
// This is what makes each Card unique across the gallery — base
// prints, alternate arts, and overnumbered variants of the same
// card share a riftbound id but have different collector numbers.
//
// Domain (CSL string) is the comma-joined version of riftapi's
// domain[] array, for direct display in the bot caption.
//
// riftboundId is the upstream's print id without the collector
// number (e.g. `ogn-011`). It is what the /cards/{id} endpoint
// takes; the id field is what the bot's callback handlers use.
export interface Card {
  readonly id: string;
  readonly name: string;
  readonly setCode: string;
  readonly setName?: string;
  readonly collectorNumber: string;
  readonly rarity: string;
  readonly type: string;
  readonly supertype?: string;
  readonly domain?: string;
  readonly energy?: number;
  readonly might?: number;
  readonly power?: number;
  readonly text?: string;
  readonly keywords: readonly string[];
  readonly artist?: string;
  readonly imageUrl?: string;
  readonly riftboundId?: string;
  // Print-level metadata. See CONTEXT.md (Signature, Spoiler) and
  // ADR-0006 for the persistence model. The first three distinguish
  // prints; updatedOn drives the /new command.
  readonly isAlternateArt?: boolean;
  readonly isOvernumbered?: boolean;
  readonly isSignature?: boolean;
  readonly updatedOn?: string;
}
