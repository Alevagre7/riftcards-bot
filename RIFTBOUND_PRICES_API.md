# Riftbound Prices API Documentation

> **Note:** The price integration is currently disabled due to RapidAPI quota limits. The adapter is preserved at `src/infrastructure/apis/riftbound-prices.adapter.ts.bak`. The active adapter uses a minimal Zod schema validating only `id` and `name` — the full schemas documented below are reference-only and may not match the simplified runtime validation.

Real-time Riftbound TCG pricing API. Live Cardmarket (EU) prices, 30-day & 7-day averages, graded card valuations (PSA, BGS, CGC), historical price trends, and full card/expansion database for Riot Games' League of Legends Trading Card Game. 900+ cards, daily price updates.

- **Base URL**: `https://riftbound-prices-api.p.rapidapi.com/`
- **Website**: [riftbound-api.com](https://riftbound-api.com)

---

## Authentication

All requests require RapidAPI headers:

```bash
curl -H "X-RapidAPI-Key: YOUR_API_KEY" \
     -H "X-RapidAPI-Host: riftbound-prices-api.p.rapidapi.com" \
     "https://riftbound-prices-api.p.rapidapi.com/cards?search=jinx"
```

---

## Cards API

### List All Cards

`GET /cards`

Retrieves a paginated list of all cards. Results can be filtered by various parameters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search term to filter cards by name. |
| `ids` | string | Comma-separated list of card IDs (max 20). Example: `ids=33384,33385` |
| `cardmarket_ids` | string | Comma-separated Cardmarket IDs. Example: `cardmarket_ids=847503` |
| `card_number` | string | Filter by card number. Example: `card_number=OGN-301/298` |
| `episode_id` | integer | Filter cards by expansion ID. |
| `artist_id` | integer | Filter cards by artist ID. |
| `page` | integer | Page number for pagination. Defaults to 1. |
| `per_page` | integer | Results per page. Defaults to 20. |
| `sort` | string | Sort order. Options: `price_highest`, `price_lowest`, `card_number_highest`, `card_number_lowest` |

**Example Request**:

```bash
curl -X GET "https://riftbound-prices-api.p.rapidapi.com/cards?search=jinx&sort=price_highest" \
  -H "X-RapidAPI-Key: YOUR_API_KEY" \
  -H "X-RapidAPI-Host: riftbound-prices-api.p.rapidapi.com"
```

**Example Response**:

```json
{
  "data": [
    {
      "id": 33384,
      "name": "Jinx, Loose Cannon",
      "name_numbered": "Jinx, Loose Cannon OGN-301/298",
      "slug": "jinx-loose-cannon",
      "card_code_number": "OGN-301/298",
      "type": "singles",
      "card_number": "OGN-301/298",
      "version": "V.2 - Showcase",
      "cardmarket_id": 847503,
      "prices": {
        "cardmarket": {
          "currency": "EUR",
          "lowest_near_mint": 64.11,
          "lowest_near_mint_EU_only": 64.99,
          "30d_average": 57.57,
          "7d_average": 60.58,
          "graded": []
        }
      },
      "episode": {
        "id": 411,
        "name": "Origins Main Set",
        "slug": "origins-main-set",
        "released_at": "2025-10-31"
      },
      "artist": null,
      "image": "https://images.tcggo.com/tcggo/storage/33809/jinx-loose-cannon-ogn-301298-origins-main-set.jpg",
      "tcggo_url": "https://www.tcggo.com/riftbound/origins-main-set/jinx-loose-cannon",
      "links": {
        "cardmarket": "https://www.tcggo.com/external/cm/33384"
      }
    }
  ],
  "paging": {
    "current": 1,
    "per_page": 20,
    "total": 1
  },
  "results": 7
}
```

### Show a Single Card

`GET /cards/{id}`

Retrieves detailed information for a single card by its internal ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | **Required.** The ID of the card to retrieve. |

**Example Response**:

```json
{
  "data": {
    "id": 33384,
    "name": "Jinx, Loose Cannon",
    "name_numbered": "Jinx, Loose Cannon OGN-301/298",
    "slug": "jinx-loose-cannon",
    "type": "singles",
    "card_number": "OGN-301/298",
    "card_code_number": "OGN-301/298",
    "hp": null,
    "rarity": null,
    "version": "V.2 - Showcase",
    "supertype": null,
    "tcgid": null,
    "flavor_text": null,
    "abilities": null,
    "attacks": null,
    "prices": {
      "cardmarket": {
        "currency": "EUR",
        "lowest_near_mint": 64.11,
        "lowest_near_mint_EU_only": 64.99,
        "30d_average": 57.57,
        "7d_average": 60.58,
        "graded": []
      }
    },
    "episode": {
      "id": 411,
      "name": "Origins Main Set",
      "slug": "origins-main-set",
      "released_at": "2025-10-31",
      "logo": "https://images.tcggo.com/tcggo/storage/33955/origins.png",
      "code": null,
      "game": { "name": "Riftbound", "slug": "riftbound" },
      "series": null
    },
    "artist": null,
    "image": "https://images.tcggo.com/tcggo/storage/33809/jinx-loose-cannon-ogn-301298-origins-main-set.jpg",
    "tcggo_url": "https://www.tcggo.com/riftbound/origins-main-set/jinx-loose-cannon",
    "links": { "cardmarket": "https://www.tcggo.com/external/cm/33384" },
    "cardmarket_id": 847503,
    "tcgplayer_id": null
  }
}
```

> **Note:** Single-card responses include extra fields (`hp`, `rarity`, `supertype`, `tcgid`, `flavor_text`, `abilities`, `attacks`) that are **not present** in list views.

### Search for Cards

`GET /cards/search`

Dedicated search endpoint. Same response structure as **List All Cards**.

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | **Required.** Search term for card name. |
| `sort` | string | Sort order: `price_highest`, `price_lowest`, `card_number_highest`, `card_number_lowest` |

### List Cards by Episode

`GET /episodes/{episode_id}/cards`

Same response structure as **List All Cards**.

| Parameter | Type | Description |
|-----------|------|-------------|
| `episode_id` | integer | **Required.** The expansion ID. |
| `page` | integer | Page number. Defaults to 1. |
| `per_page` | integer | Results per page. Defaults to 20. |
| `sort` | string | Sort order. |

### List Cards by Artist

`GET /artists/{artist_id}/cards`

Same response structure as **List All Cards**.

| Parameter | Type | Description |
|-----------|------|-------------|
| `artist_id` | integer | **Required.** The artist ID. |
| `page` | integer | Page number. Defaults to 1. |
| `sort` | string | Sort order. |

---

## Products API

> **Not currently used by the bot.** Included for future sealed-product support.

### List All Products

`GET /products`

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search term. |
| `episode_id` | integer | Filter by expansion. |
| `page` | integer | Page number. Defaults to 1. |
| `per_page` | integer | Results per page. Defaults to 20. |
| `sort` | string | `price_highest`, `price_lowest` |

### Show a Single Product

`GET /products/{id}`

### List Products by Episode

`GET /episodes/{episode_id}/products`

---

## Episodes API

> **Not currently used by the bot.** The `/sets` command is backed by the Riftcodex API.

### List All Episodes

`GET /episodes`

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search term. |
| `page` | integer | Page number. |

### Show a Single Episode

`GET /episodes/{id}`

### Search for Episodes

`GET /episodes/search?search={query}`

---

## Artists API

> **Not currently used by the bot.**

### List All Artists

`GET /artists`

### Show a Single Artist

`GET /artists/{id}`

### Search for Artists

`GET /artists/search?search={query}`

---

## History Prices API

> **Not currently used by the bot.** Phase 2+ feature candidate.

### Get History Prices

`GET /riftbound/history-prices`

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | integer | Item ID (internal). |
| `cardmarket_id` | integer | Cardmarket ID. |
| `date_from` | string | Start date (`YYYY-MM-DD`). |
| `date_to` | string | End date (`YYYY-MM-DD`). |
| `page` | integer | Page number. |
| `sort` | string | `asc` or `desc`. Defaults to `desc`. |

---

## Inventory API

> **Not currently used by the bot.** Requires user authentication context.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/inventories` | GET | List inventories. |
| `/inventories/{id}` | GET | Inventory details. |
| `/inventories/{id}/items` | POST | Add items. |
| `/inventories/{id}/stats` | GET | Inventory statistics. |

---

## Response Formats

### List Endpoints

```json
{
  "data": [ ... ],
  "paging": {
    "current": 1,
    "per_page": 20,
    "total": 10
  },
  "results": 200
}
```

### Single Resource Endpoints

```json
{
  "data": { ... }
}
```

### Error Responses

```json
{
  "error": "Resource not found",
  "status": 404
}
```

---

## Rate Limits

| Plan | Requests/Day | Rate Limit |
|------|-------------|------------|
| Basic | 100 | 30/min |
| Pro | 2,500 | 300/min |
| Ultra | 15,000 | 300/min |
| Mega | 50,000 | 600/min |

---

## Adapter Zod Schema Reference

The bot's `RiftboundPricesAdapter` validates responses with the following Zod schemas (see `src/infrastructure/apis/riftbound-prices.adapter.ts`):

```typescript
const GradedPriceSchema = z.object({
  grading_company: z.string().optional(),
  grade: z.string().optional(),
  price: z.number().optional(),
  seller: z.string().optional(),
});

const CardmarketPriceSchema = z.object({
  currency: z.string().default('EUR'),
  lowest_near_mint: z.number().nullable().optional(),
  lowest_near_mint_EU_only: z.number().nullable().optional(),
  ['30d_average']: z.number().nullable().optional(),
  ['7d_average']: z.number().nullable().optional(),
  graded: z.array(GradedPriceSchema).optional().default([]),
});

const PricesSchema = z.object({
  cardmarket: CardmarketPriceSchema.optional().nullable(),
});

const LinksSchema = z.object({
  cardmarket: z.string().url().optional().nullable(),
  tcgplayer: z.string().url().optional().nullable(),
});

const EpisodeSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  released_at: z.string().optional().nullable(),
  logo: z.string().url().optional().nullable(),
  code: z.string().nullable().optional(),
  game: z.object({ name: z.string(), slug: z.string() }).optional().nullable(),
  series: z.string().nullable().optional(),
});

const RapidApiCardPriceSchema = z.object({
  id: z.number(),
  name: z.string(),
  name_numbered: z.string().nullable().optional(),
  slug: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  card_number: z.string().optional().nullable(),
  card_code_number: z.string().optional().nullable(),
  version: z.string().optional().nullable(),
  cardmarket_id: z.number().optional().nullable(),
  prices: PricesSchema.optional().nullable(),
  episode: EpisodeSchema.optional().nullable(),
  artist: z.string().nullable().optional(),
  image: z.string().url().optional().nullable(),
  tcggo_url: z.string().url().optional().nullable(),
  links: LinksSchema.optional().nullable(),
});

const PagingSchema = z.object({
  current: z.number(),
  per_page: z.number(),
  total: z.number(),
});

const RapidApiSearchResponseSchema = z.object({
  data: z.array(RapidApiCardPriceSchema),
  paging: PagingSchema.optional(),
  results: z.number().optional(),
});

const RapidApiSingleResponseSchema = z.object({
  data: RapidApiCardPriceSchema,
});
```
