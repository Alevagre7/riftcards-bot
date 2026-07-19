# riftcards-bot — Implementation Plan

Migrating the Riftbound card Telegram bot from a third-party card API
to the self-hosted riftapi. This is a two-PR refactor.

---

## 0. Scope

In scope:
- Add a `/cards/random` endpoint to riftapi
- Refactor the bot to use riftapi as its primary card data source
- Keep the third-party adapter as an env-flagged fallback
- Drop the in-memory cache, the Cloudflare Worker proxy, and the prices adapter
- Drop `tcgplayerId` and `flavorText` from the bot's domain
- Make the events adapter's coordinates configurable
- Move the bot to a new public GitHub repo (`Alevagre7/riftcards-bot`) under MIT
- Add a lean `CONTEXT.md` and a small `docs/adr/` directory capturing the
  hard-to-reverse decisions
- Redact project-specific references from `AGENTS.md` and
  `PRODUCT_DESCRIPTION.md`
- Add tests for the new adapter and mapper
- Write a public-friendly `README.md`

Explicitly out of scope:
- Adding a `/cards/random?set_id=` filter
- Re-introducing any cache layer
- Documenting the same-host Docker setup in either repo
- Adding tests for the events adapter or for commands/formatters

---

## 1. Design (settled)

### 1.1 Card identity

`Card.id` is a composite of the riftbound id and the collector number.
String form: `${riftbound_id}/${collector_number}` (e.g. `ogn-011/298`).
Unique per print (base, alternate art, overnumbered).

### 1.2 Card domain shape

The bot's `Card` entity stays flat. The new `RiftapiAdapter` maps
the nested riftapi wire shape (`classification` / `text` / `media` /
`set` / `metadata` / `attributes`) onto the flat bot domain at the
adapter boundary.

| Bot field | Riftapi source |
|---|---|
| `id` | `riftbound_id + "/" + collector_number` |
| `name` | `name` |
| `setCode` | `set.set_id` (lowercased) |
| `setName` | `set.label` |
| `collectorNumber` | `collector_number` (string form) |
| `rarity` | `classification.rarity` |
| `type` | `classification.type` |
| `supertype` | `classification.supertype` |
| `domain` | `classification.domain.join(", ")` (CSV string) |
| `energy` | `attributes.energy` |
| `might` | `attributes.might` |
| `power` | `attributes.power` |
| `text` | `text.plain` (HTML stripped if needed; bot already has a stripper) |
| `keywords` | `tags` (string[]) |
| `artist` | `media.artist` |
| `imageUrl` | `media.image_url` |
| `riftboundId` | `riftbound_id` |

Dropped fields: `tcgplayerId`, `flavorText` (no current command uses them).

### 1.3 Adapters and config

Two adapters kept, env-flag selected at startup:

```
CARD_SOURCE=riftapi    # or riftcodex
RIFTAPI_BASE_URL=...   # required if CARD_SOURCE=riftapi
```

No default for `CARD_SOURCE`; the bot fails fast at startup if it is
unset. This is intentional: a misconfigured deployment should not
silently fall back to the old adapter.

The old `RIFTCODEX_PROXY_URL` env var is removed. The Cloudflare
Worker proxy (`riftcards-bot-proxy.alevagre7.workers.dev`) is gone
from both the riftcodex and events code paths.

### 1.4 Caching

`ICacheService` and `MemoryCacheService` are removed. All `CACHE_TTL_*`
env vars are removed from `.env.example`. The local riftapi round trip
is sub-millisecond; the cache added TTL footguns for no measurable gain.

### 1.5 Search and random

`/card` uses riftapi's `/cards/search?query=...` (server-side ranking).
`/random` uses a new `/cards/random` endpoint (server-side randomness;
the bot's command becomes a one-call flow).

### 1.6 Events

`EVENTS_LATITUDE`, `EVENTS_LONGITUDE`, `EVENTS_RADIUS_KM`,
`EVENTS_DAYS_AHEAD`, `EVENTS_API_URL` replace the hardcoded Seville
defaults. `EVENTS_API_URL` defaults to
`https://api.cloudflare.riftbound.uvsgames.com` (was the upstream;
now called directly, no proxy hop).

### 1.7 Mode

Both polling and webhook modes remain. `WEBHOOK_URL` selects webhook
mode; absence selects polling. The web server stays on port 8080
(for webhook).

### 1.8 Tests

Vitest tests for:
- The new `RiftapiAdapter` (mocked `fetch`)
- The card mapper (riftapi wire → bot domain)

No tests for events, commands, formatters, or inline queries in this
refactor (out of scope per the design).

---

## 2. PR 1 — riftapi: add `/cards/random`

Files changed:
- `internal/api/cards.go` — register route `GET /cards/random`
- `internal/api/cards_random.go` — new handler (small, ~30 lines)
- `internal/api/cards_random_test.go` — tests
- `internal/store/card_repo.go` — add `GetRandomCard(ctx) (*Card, error)`

The store method uses `ORDER BY RANDOM() LIMIT 1` (SQLite, ~ms on the
1.2k-row table). No caching, no pagination — the endpoint always
returns exactly one card.

The handler responds 200 with the card wrapped in the same
`{ items: [...], ... }` shape used elsewhere? **No** — this is a single
card, not a list. Returns the card directly, like `/cards/{id}`.

**Verification:**
- `go test -race -count=1 -timeout 90s ./...` — must pass
- Manual: `curl -s http://localhost:8080/cards/random | jq` returns a
  full card

**Commit & force-push:**
Single commit, force-push to rewrite the remote history (the user
asked for this earlier when removing riftcodex references; same
pattern).

---

## 3. PR 2 — riftcards-bot: the refactor

### 3.1 Working copy

Use `/home/xalevagre7/code/riftbot` as the working copy. The git
remote is changed to point to the new repo. The git history is
preserved (no force-push needed since this is a new repo).

Files deleted:
- `RIFTBOUND_PRICES_API.md` (prices disabled)
- `docs/products_singles_22.json` (stale, 191KB, untracked)
- `docs/price_guide_22.json` (stale, 249KB, untracked)

Files added:
- `LICENSE` (MIT)
- `CONTEXT.md` (lean, one screen)
- `docs/adr/0001-composite-key.md`
- `docs/adr/0002-drop-cache.md`
- `docs/adr/0003-drop-proxy.md`
- `docs/adr/0004-env-flagged-dual-adapter.md`
- `docs/adr/0005-cards-random-on-riftapi.md`
- `README.md` (public-friendly)
- `src/infrastructure/apis/riftapi.adapter.ts` (new)
- `src/infrastructure/apis/riftapi-mapper.ts` (new, the nested-to-flat mapper)
- `src/infrastructure/apis/__tests__/riftapi.adapter.test.ts`
- `src/infrastructure/apis/__tests__/riftapi-mapper.test.ts`

Files heavily modified:
- `src/core/entities/card.ts` — drop `tcgplayerId`, `flavorText`
- `src/core/ports/card-repository.ts` — interface stays the same shape
  but `id` is now the composite string
- `src/core/ports/cache-service.ts` — **deleted**
- `src/infrastructure/cache/memory-cache.service.ts` — **deleted**
- `src/infrastructure/apis/events.adapter.ts` — drop the
  `proxyBaseUrl` option; use `EVENTS_API_URL` directly
- `src/index.ts` — DI swap, env-flag selection, drop cache wiring
- `src/bot/commands/card.ts` — composite-key regex, multi-match buttons
- `src/bot/commands/random.ts` — one-call flow
- `src/bot/inline-query.ts` — composite-key callback data
- `src/bot/actions/callbacks.ts` — composite-key callback parsing
- `src/config.ts` — replace `RIFTCODEX_PROXY_URL` with `RIFTAPI_BASE_URL`
  and `CARD_SOURCE`; add events env vars
- `.env.example` — rewrite to match
- `package.json` — bump version
- `AGENTS.md` — redact project specifics
- `PRODUCT_DESCRIPTION.md` — redact project specifics

### 3.2 Implementation order (sub-tasks)

These can be done in parallel after the interface design is settled.
Each sub-task has a single owner and a single output.

| # | Sub-task | Output | Owner | Files |
|---|---|---|---|---|
| 1 | New `RiftapiAdapter` skeleton | Class with all `ICardRepository` methods throwing `not implemented` | fixer | `src/infrastructure/apis/riftapi.adapter.ts` |
| 2 | Card mapper | `mapCard(wire: RiftapiCard): Card` | fixer | `src/infrastructure/apis/riftapi-mapper.ts` |
| 3 | Wire sub-task 1's `searchCards` and `getCardById` | Uses mapper | fixer (depends on 1, 2) | `riftapi.adapter.ts` |
| 4 | Wire sub-task 1's `getCardByRiftboundId`, `getCardByTcgPlayerId` | composite-key aware | fixer (depends on 1, 2) | `riftapi.adapter.ts` |
| 5 | Wire sub-task 1's `getSets`, `getCardsBySet`, `getRandomCard` | endpoint mappings | fixer (depends on 1, 2) | `riftapi.adapter.ts` |
| 6 | Tests for the adapter | mocked `fetch` | fixer (depends on 1-5) | `__tests__/riftapi.adapter.test.ts` |
| 7 | Tests for the mapper | plain object fixtures | fixer (depends on 2) | `__tests__/riftapi-mapper.test.ts` |
| 8 | Drop the cache | delete `ICacheService`, `MemoryCacheService`, all `CACHE_TTL_*` | fixer | `core/ports/`, `infrastructure/cache/`, `index.ts`, `config.ts`, `.env.example` |
| 9 | Drop the prices adapter and doc | delete `riftbound-prices.adapter.ts.bak` and `RIFTBOUND_PRICES_API.md` | fixer | root + `infrastructure/apis/` |
| 10 | Drop the proxy | remove `RIFTCODEX_PROXY_URL` from all code paths | fixer | `config.ts`, `riftcodex.adapter.ts`, `events.adapter.ts` |
| 11 | Drop stale JSON files | delete both `docs/*.json` | fixer | `docs/` |
| 12 | Update `Card` entity | remove `tcgplayerId`, `flavorText` | fixer | `core/entities/card.ts` |
| 13 | Update commands | composite-key awareness in `/card`, `/random`, inline, callbacks | fixer | `bot/commands/`, `bot/inline-query.ts`, `bot/actions/` |
| 14 | Add `CARD_SOURCE` env flag | startup fail-fast, adapter selection | fixer | `index.ts`, `config.ts` |
| 15 | Add events env vars | lat/lon/radius/days/api-url | fixer | `events.adapter.ts`, `config.ts`, `.env.example` |
| 16 | `LICENSE` (MIT) | standard MIT text | fixer | `LICENSE` |
| 17 | `CONTEXT.md` | lean, one screen, domain terms | fixer | `CONTEXT.md` |
| 18 | ADRs (5 files) | settled design, one per decision | fixer | `docs/adr/0001-*.md` ... |
| 19 | Redact `AGENTS.md` | remove justrunmy.app, Alevagre7, Seville specifics, worker proxy URL | fixer | `AGENTS.md` |
| 20 | Redact `PRODUCT_DESCRIPTION.md` | same as 19 | fixer | `PRODUCT_DESCRIPTION.md` |
| 21 | `README.md` (public) | Quick start, Architecture, Env vars, Deployment, Contributing, License | fixer | `README.md` |
| 22 | `package.json` cleanup | bump version, drop unused deps if any | fixer | `package.json` |
| 23 | `npm run build` + `npm test` green | verify | fixer | — |

Sub-tasks 1-2 are foundational; the rest depend on them.
Sub-tasks 8-15 are independent of 1-7 in terms of file ownership
(no write conflicts).
Sub-tasks 16-22 are also independent.

### 3.3 Dependency edges

```
1, 2 → 3, 4, 5 → 6
2 → 7
8, 9, 10, 11, 12, 13, 14, 15 → 23
16, 17, 18, 19, 20, 21, 22 → 23
```

Within a wave, sub-tasks can run in parallel (different files). Between
waves, sub-tasks are sequential.

### 3.4 Verification

- `npm run build` — must succeed
- `npm test` — adapter + mapper tests must pass
- Manual smoke (the maintainer):
  - `npm run dev` (polling mode)
  - `/card Ahri` → image preview, multi-match buttons if needed
  - `/random` → one-card preview
  - `/events` → Seville events (or wherever lat/lon point)
  - `@RiftCardsBot Ahri` → inline results
  - Click a multi-match button → resolves to a card

### 3.5 New GitHub repo

Create `github.com/Alevagre7/riftcards-bot` (public). Add the
description "Telegram bot for Riftbound card data, backed by the
self-hosted riftapi." Add topics: `telegram-bot`, `riftbound`,
`tcg`, `telegraf`, `typescript`.

The working copy's git remote is changed to this new URL. The git
history is preserved.

---

## 4. ADRs to write

| # | File | Decision |
|---|---|---|
| 0001 | `0001-composite-key.md` | `Card.id` = `${riftbound_id}/${collector_number}` |
| 0002 | `0002-drop-cache.md` | `ICacheService` and `MemoryCacheService` removed |
| 0003 | `0003-drop-proxy.md` | Cloudflare Worker proxy dropped from all code paths |
| 0004 | `0004-env-flagged-dual-adapter.md` | `CARD_SOURCE` with no default, fail-fast on misconfig |
| 0005 | `0005-cards-random-on-riftapi.md` | New `/cards/random` endpoint on riftapi |

Each ADR captures: context, decision, consequences, alternatives
considered.

---

## 5. Rollback plan

If something goes wrong with PR 1 or PR 2, the bot's previous behavior
is preserved by setting `CARD_SOURCE=riftcodex` in `.env`. The
`RiftcodexAdapter` stays in the codebase, fully functional, behind
the env flag.
