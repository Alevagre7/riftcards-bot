# 1. Composite key for Card.id

Date: 2026-07-19

## Status

Accepted.

## Context

The bot's upstream data sources (riftapi and riftcodex) have no opaque
internal UUIDs for cards. Each card is identified by a `riftboundId`
(e.g. `ogn-011`) and a `collectorNumber` (e.g. `298`). The riftboundId
alone is not unique in the gallery: alternate-art prints of the same
card share a riftboundId (e.g. `ogn-066` and `ogn-066a` are different
prints with one riftboundId). The previous bot implementation used a
third-party UUID generated at bot ingestion time, which meant the id
had no relationship to the card data and could not be reconstructed
without a lookup table.

The bot's callback handlers (`card:{id}` button payloads) and the
`ICardRepository.getCardById()` contract need a stable, intrinsic
identifier that callers can derive from data they already have.

## Decision

`Card.id` is a composite string: `${riftboundId}/${collectorNumber}`,
for example `ogn-011/298` or `ogn-066a/298`. Both halves are intrinsic
card properties available at construction time. No UUIDs are generated
or stored.

Both adapters (`RiftapiAdapter`, `RiftcodexAdapter`) and the mapper
(`riftapi-mapper.ts`) construct the id the same way. The
`getCardById(id)` method in each adapter parses the slash, extracts
the `riftboundId` half, and delegates to `getCardByRiftboundId()`.
Callers that already hold the riftboundId can skip parsing and call
`getCardByRiftboundId()` directly. Callback handlers that parse the
id from a button payload always have the full composite.

## Consequences

- Easier: no UUID generation, no lookup table, no id collision between
  alternate arts. The id is reproducible from any card listing.
- Harder: `getCardById` must parse the composite on every call. A
  mis-format (no slash, wrong case) produces a 400-level error that
  must be handled upstream.
- Harder: search results and inline query results must include the
  composite id in each result object so the callback handlers receive
  it — but they already do via the `Card.id` field.
- Given up: the ability to reassign ids without updating every stored
  reference. This is acceptable because ids are derived from immutable
  upstream data.
