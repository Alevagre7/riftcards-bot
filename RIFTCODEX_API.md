# Riftcodex API Documentation

The Riftcodex API provides card data, set information, and indexed lookups for the Riftbound TCG. No authentication required for read operations.

- **Base URL**: `https://api.riftcodex.com`
- **Content-Type**: All responses are JSON.

---

## Cards API

### List All Cards

`GET /cards`

Returns a paginated list of all cards with optional filtering and sorting.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sort` | `CardSortCategories` | — | Field to sort by: `name`, `collector_number`, `set_id`, `type`, `supertype`, `rarity`, `domain`, `artist`, `set_label`, `energy`, `might`, `power` |
| `dir` | integer (default: `1`) | — | Sort direction. `1` = ascending, `-1` = descending. |
| `set_id` | string | — | Filter by Riftbound set ID (e.g. `sfd`, `ogn`). Case insensitive. |
| `page` | integer (default: `1`, min: `1`) | — | Page number. |
| `size` | integer (default: `50`, min: `1`, max: `100`) | — | Page size. |

**Example Request**:

```bash
curl "https://api.riftcodex.com/cards?size=10&set_id=ogn&sort=collector_number"
```

### Search Cards

`GET /cards/search`

> **Not currently used by the bot.** WIP endpoint — full-text search on card text (not name).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | **Yes** | Full-text search query. |
| `sort` | `CardSortCategories` | — | Sort field. |
| `dir` | integer (default: `1`) | — | Sort direction. |
| `set_id` | string | — | Filter by set ID. |
| `page` | integer (default: `1`) | — | Page number. |
| `size` | integer (default: `50`) | — | Page size. |

**Example Request**:

```bash
curl "https://api.riftcodex.com/cards/search?query=play+a+gold+token"
```

### Get Cards By Name

`GET /cards/name`

The bot uses the `fuzzy` parameter. The `exact` parameter is also available for exact name matches.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `exact` | string | — | Exact name match (case insensitive). |
| `fuzzy` | string | — | Fuzzy name match (case insensitive). |
| `sort` | `CardSortCategories` | — | Sort field. |
| `dir` | integer (default: `1`) | — | Sort direction. |
| `set_id` | string | — | Filter by set ID. |
| `page` | integer (default: `1`) | — | Page number. |
| `size` | integer (default: `50`) | — | Page size. |

**Example Request**:

```bash
curl "https://api.riftcodex.com/cards/name?exact=master+yi+honed"
```

### Get Card By Id

`GET /cards/{id}`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (path) | **Yes** | The Riftcodex ID of the card. |

**Example Request**:

```bash
curl "https://api.riftcodex.com/cards/69a6336b829d03360413d515"
```

### Get Cards By Riftbound Id

`GET /cards/riftbound/{id}`

Returns an **array** of cards (supports alternate arts). Case insensitive and partial matching included.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (path) | **Yes** | The Riftbound ID (e.g. `ogn-011` or `ogn-011-298`). |

**Example Request**:

```bash
curl "https://api.riftcodex.com/cards/riftbound/ogn-011"
```

### Get Card By Tcgplayer Id

`GET /cards/tcgplayer/{tcgplayer_id}`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tcgplayer_id` | string (path) | **Yes** | The TCGPlayer product ID. |

**Example Request**:

```bash
curl "https://api.riftcodex.com/cards/tcgplayer/652782"
```

---

## Sets API

### Get Sets

`GET /sets`

Returns a paginated list of all sets. Used by the `/sets` bot command.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | integer (default: `1`) | — | Page number. |
| `size` | integer (default: `50`) | — | Page size. |

**Example Request**:

```bash
curl "https://api.riftcodex.com/sets"
```

### Get Set By Set Id

`GET /sets/set-id/{set_id}`

> **Not currently used by the bot.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `set_id` | string (path) | **Yes** | The Riftbound set ID (e.g. `ogn`, `sfd`). |

### Get Set By Tcgplayer Id

`GET /sets/tcgplayer/{tcgplayer_id}`

> **Not currently used by the bot.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tcgplayer_id` | string (path) | **Yes** | The TCGPlayer group ID. |

### Get Set By Cardmarket Id

`GET /sets/cardmarket/{cardmarket_id}`

> **Not currently used by the bot.** Some sets have multiple Cardmarket IDs; either ID can be used.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cardmarket_id` | string (path) | **Yes** | The Cardmarket ID. |

### Get Set By Id

`GET /sets/{id}`

> **Not currently used by the bot.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string (path) | **Yes** | The Riftcodex set ID. |

**Example Response** (all single-set endpoints):

```json
{
  "card_count": 95,
  "cardmarket_id": ["6322", "6483"],
  "id": "69a7184cbddee0883890186a",
  "name": "Riftbound Organized Play Promotional Cards",
  "published_on": "2025-10-31T00:00:00",
  "set_id": "OPP",
  "tcgplayer_id": "24343"
}
```

---

## Indexes API

All index endpoints return the same structure. Only `/index/card-names` is used by the bot (for `/random`).

### Get Keywords

`GET /index/keywords`

> **Not currently used by the bot.**

### Get Card Names

`GET /index/card-names`

Used by the `/random` command to pick a random card name.

### Get Card Types

`GET /index/card-types`

> **Not currently used by the bot.**

### Get Card Supertypes

`GET /index/card-supertypes`

> **Not currently used by the bot.**

### Get Domains

`GET /index/domains`

> **Not currently used by the bot.**

### Get Rarities

`GET /index/rarities`

> **Not currently used by the bot.**

### Get Artists

`GET /index/artists`

> **Not currently used by the bot.**

### Get Energy

`GET /index/energy`

> **Not currently used by the bot.**

### Get Might

`GET /index/might`

> **Not currently used by the bot.**

### Get Power

`GET /index/power`

> **Not currently used by the bot.**

### Get Tags

`GET /index/tags`

> **Not currently used by the bot.**

**Index Response Format**:

```json
{
  "total": 312,
  "type": "card-names",
  "values": ["Magma Wurm", "Jinx, Loose Cannon", "..."]
}
```

---

## Schema Reference

### Card

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | Unique Riftcodex identifier. |
| `name` | string | **Yes** | Card name. |
| `riftbound_id` | string | **Yes** | Riftbound ID. |
| `tcgplayer_id` | string | **Yes** | TCGPlayer product ID. |
| `collector_number` | integer | **Yes** | Collector number within its set. |
| `attributes` | Attributes | **Yes** | Energy, might, power. |
| `classification` | Classification | **Yes** | Type, supertype, rarity, domain. |
| `text` | Text | **Yes** | Rich text, plain text, flavour text. |
| `set` | CardSet | **Yes** | Set ID and label. |
| `media` | Media | **Yes** | Image URL, artist, accessibility text. |
| `tags` | string[] | **Yes** | Tags (e.g. `Freljord`, `Noxus`). |
| `orientation` | string | **Yes** | `portrait` or `landscape`. |
| `metadata` | Metadata | **Yes** | Clean name, updated_on, flags. |

### Attributes

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `energy` | integer | — | Energy cost. |
| `might` | integer | — | Might value. |
| `power` | integer | — | Power value. |

### Classification

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | **Yes** | Card type (e.g. `Unit`, `Spell`). |
| `supertype` | string | — | Supertype (e.g. `Champion`, `Token`). |
| `rarity` | string | **Yes** | Rarity (e.g. `Common`, `Rare`). |
| `domain` | string[] | **Yes** | Domains (e.g. `Fury`, `Chaos`). |

### Text

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `rich` | string | **Yes** | Rich-formatted card text. |
| `plain` | string | **Yes** | Plain card text. |
| `flavour` | string | — | Flavour text. |

### CardSet

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `set_id` | string | **Yes** | Set identifier (e.g. `OGN`, `OGS`). |
| `label` | string | **Yes** | Set label (e.g. `Origins`, `Spiritforged`). |

### Media

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image_url` | string | **Yes** | Card image URL. |
| `artist` | string | **Yes** | Artist name. |
| `accessibility_text` | string | **Yes** | Accessibility text. |

### Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clean_name` | string | **Yes** | Name without special characters. |
| `updated_on` | string | **Yes** | Last update timestamp (ISO 8601). |
| `alternate_art` | boolean | **Yes** | Has alternate art. |
| `overnumbered` | boolean | **Yes** | Is overnumbered. |
| `signature` | boolean | **Yes** | Is a signature card. |

### Set

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **Yes** | Unique Riftcodex identifier. |
| `name` | string | **Yes** | Set name. |
| `set_id` | string | **Yes** | Riftbound set ID. |
| `card_count` | integer | **Yes** | Number of cards in the set. |
| `tcgplayer_id` | string | — | TCGPlayer group ID. |
| `cardmarket_id` | string \| string[] | — | Cardmarket ID(s). |
| `published_on` | string | **Yes** | Publication date (ISO 8601). |

### Index

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `total` | integer | **Yes** | Total unique values. |
| `type` | string | **Yes** | Index type (e.g. `keywords`, `sets`). |
| `values` | (string \| integer)[] | **Yes** | List of unique values. |

---

## Adapter Zod Schema Reference

The bot's `RiftcodexAdapter` validates responses with the following Zod schemas (see `src/infrastructure/apis/riftcodex.adapter.ts`):

```typescript
const RiftcodexAttributesSchema = z.object({
  energy: z.number().optional().nullable(),
  might: z.number().optional().nullable(),
  power: z.number().optional().nullable(),
});

const RiftcodexClassificationSchema = z.object({
  type: z.string(),
  supertype: z.string().optional().nullable(),
  rarity: z.string(),
  domain: z.array(z.string()).optional().default([]),
});

const RiftcodexTextSchema = z.object({
  rich: z.string().optional().default(''),
  plain: z.string().optional().default(''),
  flavour: z.string().optional().nullable(),
});

const RiftcodexSetInfoSchema = z.object({
  set_id: z.string(),
  label: z.string(),
});

const RiftcodexMediaSchema = z.object({
  image_url: z.string().optional().nullable(),
  artist: z.string().optional().nullable(),
  accessibility_text: z.string().optional().nullable(),
});

const RiftcodexMetadataSchema = z.object({
  clean_name: z.string(),
  updated_on: z.string().optional().nullable(),
  alternate_art: z.boolean().optional(),
  overnumbered: z.boolean().optional(),
  signature: z.boolean().optional(),
});

const RiftcodexCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  riftbound_id: z.string().optional().nullable(),
  tcgplayer_id: z.string().optional().nullable(),
  collector_number: z.union([z.number(), z.string()]),
  attributes: RiftcodexAttributesSchema.optional().nullable(),
  classification: RiftcodexClassificationSchema.optional().nullable(),
  text: RiftcodexTextSchema.optional().nullable(),
  set: RiftcodexSetInfoSchema.optional().nullable(),
  media: RiftcodexMediaSchema.optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  orientation: z.string().optional().nullable(),
  metadata: RiftcodexMetadataSchema.optional().nullable(),
});

const RiftcodexSearchResponseSchema = z.object({
  items: z.array(RiftcodexCardSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
});

const RiftcodexSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  set_id: z.string(),
  card_count: z.number().int().nonnegative().optional().nullable(),
  tcgplayer_id: z.string().optional().nullable(),
  cardmarket_id: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  published_on: z.string().optional().nullable(),
});

const RiftcodexSetsResponseSchema = z.object({
  items: z.array(RiftcodexSetSchema),
});

const RiftcodexIndexSchema = z.object({
  total: z.number().int().nonnegative(),
  type: z.string(),
  values: z.array(z.union([z.string(), z.number()])),
});
```
