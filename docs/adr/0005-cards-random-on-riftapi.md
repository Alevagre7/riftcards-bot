# 5. Add /cards/random to riftapi, not the bot

Date: 2026-07-19

## Status

Accepted.

## Context

The bot's `/random` command needs to return a single randomly chosen
card. The legacy Riftcodex adapter implements this as a two-call flow:
fetch the names index (`/index/card-names`), pick a name at random
client-side, then fetch that card by name (`/cards/name?fuzzy=...`).
This is brittle — it depends on the names index being available and
synchronised with the card data — and doubles the latency of a
single-card response.

The riftapi store is a local SQLite database (~1.2k rows) running on
the same Docker network as the bot. SQLite's `ORDER BY RANDOM() LIMIT 1`
is efficient at this scale and avoids the count-and-offset dance.
Putting the random selection on the server lets the bot make one round
trip and get back a complete Card object.

## Decision

The `/cards/random` endpoint lives on riftapi, not in the bot:

- Riftapi adds `GET /cards/random` which calls
  `CardRepo.GetRandomCard()` → `ORDER BY RANDOM() LIMIT 1` and returns
  the full card JSON directly (same shape as `/cards/{id}`).
- The riftapi has server-side tests (`TestCardRandom`) that verify
  the endpoint returns cards from the seed set and returns 404 on an
  empty store.
- The bot's `RiftapiAdapter.getRandomCard()` is a single call to
  `GET /cards/random`. The `RiftcodexAdapter.getRandomCard()` retains
  the two-call fallback for the legacy adapter.
- No client-side random-selection logic exists in the riftapi adapter;
  the bot just maps the response through the existing mapper.

## Consequences

- Easier: the bot's `/random` command becomes a one-call flow with no
  index dependency and no client-side randomness edge cases. The
  riftapi's SQL implementation is deterministic to test and ~ms fast.
  The existing `TestCardRandom` suite covers the server-side logic.
- Harder: the riftcodex adapter (fallback) still uses the two-call
  flow, so the bot's `getRandomCard` contract has two implementations
  with different reliability profiles. In practice the riftapi adapter
  is the primary path.
- Given up: the ability to return a random card when the riftapi
  database is empty or unreachable (the riftcodex adapter still works
  against its own index as a fallback, but only for `CARD_SOURCE=riftcodex`).
  The primary deployment always has a populated store because the sync
  is a prerequisite for the bot to function.
