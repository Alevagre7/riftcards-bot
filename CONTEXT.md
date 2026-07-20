# RiftCards Bot Glossary

## Domain

**Riftbound**:
The trading card game published by Riot Games. All data served by the bot
refers to Riftbound cards and events. *Avoid*: "TCG" (too generic), "Riot
cards" (Riot publishes several games).

## Entities

**Card**:
The bot's flat view of a Riftbound card. Defined at
`src/core/entities/card.ts`. The shape is designed for direct use by the
bot layer (commands, formatters, inline queries) and is distinct from the
upstream's nested wire shape; the translation lives in
`src/infrastructure/apis/riftapi-mapper.ts`. Optional metadata fields
`isAlternateArt`, `isOvernumbered`, `isSignature`, and `updatedOn`
distinguish prints and surface change timestamps; see **Signature** and
**Spoiler**. *Avoid*: "API card" (the domain entity has no knowledge
of the wire format).

**Set**:
A group of Cards released together as a single product. Defined at
`src/core/entities/set.ts`. Identified by `set_id` (e.g. `OGN`, `UNL`,
`SFD`, `VEN`). *Avoid*: "Expansion", "Release".

**Event**:
An upcoming Riftbound tournament at a physical store. Defined at
`src/core/entities/event.ts`. Fetched from the upstream events API via
`EventsAdapter`; the bot's `/events` command renders a temporal window.

**Signature**:
A Card whose `cardType.superType` includes the `signature` supertype id
on the upstream wire. A card-level *type* (like "Champion" or "Unit"),
not a print-level *variant*: the same Card is a Signature whether or not
it has an alternate art or overnumbered print. Mapped to
`Card.isSignature` from `metadata.signature`. *Avoid*: "Signature
version" (it isn't a version of a card; it is what the card *is*).

**Spoiler**:
A Card whose upstream `metadata.updated_on` falls within the current UTC
calendar day. This is the bot's best-effort approximation of "spoiled
today" given that the wire format carries no dedicated spoiler flag.
Mapped to `Card.updatedOn` from `metadata.updated_on`. Used by the
`/new` command. *Avoid*: "new card" (a new Card is a Card whose
`riftbound_id` has not been seen before — different concept).

**TelegramUser**:
The person interacting with the bot. Identified by the stable numeric
Telegram `id` from `ctx.from.id`; `username` is a mutable display
string and is not used as a storage key. *Avoid*: "user" (overloaded),
"Telegram ID" (that is the same as `id`, not a separate concept).

**User location**:
A per-TelegramUser setting of `{ latitude, longitude, radiusKm? }` that
drives the `/events` command. Persisted in the `user_locations` table
(see ADR-0006). When unset, falls back to the global
`EVENTS_LATITUDE` / `EVENTS_LONGITUDE` / `EVENTS_RADIUS_KM` env vars.
The `radiusKm?` is optional: `null` means "use the global radius". The
location is captured from a Telegram `RequestLocation` button or a
direct `message.location` pin, not from free-text input.

## Identifiers

**Riftbound ID**:
A Card's print id without the collector number (e.g. `ogn-011`). Shared
across all prints of the same card (base, alternate art, overnumbered).
Matches the `riftbound_id` field on the upstream gallery object. Mapped to
`Card.riftboundId`. *Avoid*: "Card ID" (too generic — every system has its
own IDs), "Print code".

**Composite key**:
`${riftboundId}/${collectorNumber}` (e.g. `ogn-011/298`). This is what
`Card.id` is — the unique identifier for a single print. Base prints,
alternate arts, and overnumbered variants of the same card all have
different composite keys even though they share a Riftbound ID. See
ADR-0001. *Avoid*: "Card ID" (ambiguous with Riftbound ID).

## Architecture

**Repository (port)**:
`ICardRepository` at `src/core/ports/card-repository.ts`. The interface
that the bot layer (commands, formatters, inline queries, actions) depends
on. The domain knows only this port; it has no import of any adapter.
*Avoid*: "DAO", "service" (the project consistently uses "repository").

**Adapter**:
An implementation of `ICardRepository`. Two exist:

- **RiftapiAdapter** (primary): talks to the self-hosted riftapi on the
  same Docker network. Cache-free; single round trip per call.
- **RiftcodexAdapter** (env-flagged fallback): talks to the third-party
  Riftcodex public API. The fallback is kept for environments that cannot
  run the riftapi.

Selected by `CARD_SOURCE` at startup. There is no default: a misconfigured
deployment fails fast with an error. See ADR-0004.

## Bot Layer

**Command**:
A Telegraf slash handler. Three commands exist, registered in
`src/index.ts`:
- `/card <name or ID>` — look up a card and send a preview.
- `/random` — send a random card preview.
- `/events` — list upcoming events near the configured location.

Each command factory takes its repository dependencies (constructor
injection); wiring happens in `src/index.ts`. *Avoid*: "Handler" (a
command is one kind of handler; inline queries and callbacks are others).

**Inline query**:
The `@RiftCardsBot <query>` flow. Defined at `src/bot/inline-query.ts`.
Returns up to 20 article results rendered as inline results; selecting one
sends `/card <name>` to the chat. *Avoid*: "Inline mode" (Telegraf's term
is "inline query").

**Callback**:
The `card:{id}` button action. Defined at `src/bot/actions/callbacks.ts`.
Triggered when a user taps an inline keyboard button whose data starts
with `card:`; the handler parses the composite id and sends the card
preview. *Avoid*: "Action" (Telegraf uses "callback query"; the file is
named `callbacks.ts`).

## Configuration

**Card source**:
The value of `CARD_SOURCE` — either `riftapi` or `riftcodex`. Determines
which `ICardRepository` implementation is wired at startup. No default;
the bot fails with a clear error if the variable is unset or unrecognised.
See ADR-0004.
