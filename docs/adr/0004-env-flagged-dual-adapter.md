# 4. Env-flagged dual adapter with no default

Date: 2026-07-19

## Status

Accepted.

## Context

The bot supports two card data backends: the primary, self-hosted
riftapi (a new Go service) and the legacy Riftcodex public API (the
env-flagged fallback). The two adapters implement the same
`ICardRepository` port, but the riftapi adapter has a richer
interface (server-side search ranking, `/cards/random` endpoint,
set metadata) and is the long-term target.

A naive default would silently serve the wrong adapter when the env
var is unset, delaying error detection until a user notices stale
or missing data. A misconfigured deployment should fail immediately
at startup so the operator knows the system is not working.

## Decision

Keep both `RiftapiAdapter` and `RiftcodexAdapter` selectable via
`CARD_SOURCE=riftapi|riftcodex`, with no default value. The
`loadConfig()` function validates the variable before the Zod schema
runs and throws a clear error if it is unset or contains an
unrecognised value. The DI switch in `index.ts` (`buildCardRepository`)
is exhaustive on the two cases; TypeScript's type narrowing ensures
no default branch is needed.

Each adapter's required base URL is validated conditionally on the
selected `CARD_SOURCE`, so a deployment using `riftapi` does not need
to configure `RIFTCODEX_BASE_URL` and vice versa.

## Consequences

- Easier: fail-fast on misconfiguration. A missing `CARD_SOURCE`
  produces an immediate, descriptive error at startup. The two
  adapters coexist in the same codebase with no ambiguity about which
  one is active.
- Harder: every new deployment must set `CARD_SOURCE`. A
  docker-compose.yml or Helm chart that omits the env var will crash
  loop. This is considered a feature, not a bug.
- Harder: the switch in `index.ts` must be kept in sync with the
  `cardSourceSchema` enum. A new adapter requires changes in three
  places: the enum, the switch, and `loadConfig`'s conditional URL
  validation.
- Given up: the convenience of a zero-config dev mode that defaults
  to one adapter. Developers must set `CARD_SOURCE` in their `.env`
  file, which is documented in `.env.example`.
