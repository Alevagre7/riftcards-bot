# Riftbound Card Tracker - Telegram Bot

## Project Overview
Telegram bot for looking up Riftbound TCG cards and discovering local events. Users search for cards by name, browse them inline, get random cards, and find upcoming tournament events near Seville.

Hexagonal architecture (Ports & Adapters) ensures API providers can be swapped without touching core logic.

---

## Technical Stack
- **Language**: TypeScript 5.x (Strict mode)
- **Runtime**: Node.js 22+
- **Framework**: Telegraf v4.16
- **HTTP Client**: Native `fetch` with custom retry/timeout wrapper
- **Validation**: Zod v4.4 for env vars and API responses
- **Hosting**: justrunmy.app (free tier: 0.15 vCPU, 256 MB RAM, 0.3 GB disk, auto HTTPS)
- **Dev runner**: `tsx watch` for hot reload

---

## Architecture

### Hexagonal (Ports & Adapters)

```
┌─────────────────────────────────────────────────────────────┐
│                      Telegram Layer                          │
│  (Commands, Inline Queries, Formatters, Middleware)          │
│                    ↓ Depends on Ports                        │
├─────────────────────────────────────────────────────────────┤
│                      Core (Domain)                           │
│  (Entities: Card, Event, Set, PriceData)                     │
│  (Ports: ICardRepository, IEventRepository, ICacheService)   │
│                    ↓ Implemented by Adapters                 │
├─────────────────────────────────────────────────────────────┤
│                    Infrastructure                            │
│  (RiftcodexAdapter, EventsAdapter, MemoryCacheService)      │
└─────────────────────────────────────────────────────────────┘
```

**Rule**: Telegram and Core layers NEVER import from `src/infrastructure/`. All communication goes through ports defined in `src/core/ports/`.

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/card <name>` | Look up a card by name or ID (e.g. `ogn-011`). Shows image + name. If multiple results, shows clickable buttons. |
| `/random` | Get a random card image + name. |
| `/events` | List upcoming Riftbound events near Seville (next 7 days, 25 mile radius). Shows name, store, date/time, format. |

### Inline Mode
Type `@RiftCardsBot <card name>` in any chat to search cards inline. Tapping a result sends `/card <name>` to the chat.

### Callback Buttons
- `card:{id}` — Card result buttons (from `/card` search results). Opens the full card preview.

---

## APIs

### 1. Card Data — Riftcodex
- **Base URL**: `https://api.riftcodex.com`
- **Auth**: None (read-only)
- **Adapter**: `src/infrastructure/apis/riftcodex.adapter.ts`
- **Port**: `ICardRepository`

**Used endpoints:**
| Endpoint | Use |
|----------|-----|
| `GET /cards/name?fuzzy=` | Search cards by fuzzy name |
| `GET /cards/{id}` | Get card by Riftcodex UUID |
| `GET /cards/riftbound/{id}` | Get card by Riftbound ID (e.g. `ogn-011`) |
| `GET /index/card-names` | Get all card names (random card) |

### 2. Events — Spicerack API
- **Base URL**: `https://api.cloudflare.riftbound.uvsgames.com`
- **Auth**: None (public)
- **Adapter**: `src/infrastructure/apis/events.adapter.ts`
- **Port**: `IEventRepository`

**Used endpoint:**
| Endpoint | Use |
|----------|-----|
| `GET /hydraproxy/api/v2/events/` | Search events by location, date range, game |

**Parameters**: `start_date_after`, `start_date_before` (next 7 days), `game_slug=riftbound`, `latitude=37.389`, `longitude=-5.984` (Seville), `num_miles=25`, `display_statuses=upcoming,inProgress`.

### 3. Card Prices — Riftbound Prices (Disabled)
Prices API is disabled due to RapidAPI quota constraints. The price adapter is preserved at `src/infrastructure/apis/riftbound-prices.adapter.ts.bak` for future re-enablement. Port and entities remain in core.

---

## Caching Strategy

| Data Type | Cache TTL | Rationale |
|-----------|-----------|-----------|
| Card search results | 24 hours | Card metadata rarely changes |
| Individual card details | 7 days | Static card information |
| Set/expansion list | 7 days | Nearly static |
| Random card | 60 seconds | Short-lived to ensure variety |

**Implementation**: `MemoryCacheService` backed by a `Map` with TTL timestamps. Cache keys are deterministic hashes of query parameters.

---

## Project Structure

```
.
├── .env.example
├── .gitignore
├── PRODUCT_DESCRIPTION.md
├── AGENTS.md
├── RIFTCODEX_API.md
├── RIFTBOUND_PRICES_API.md
├── package.json
├── tsconfig.json
├── Dockerfile
├── src/
│   ├── index.ts                    # Entry point, DI composition root
│   ├── config.ts                   # Zod-validated environment variables
│   ├── core/
│   │   ├── entities/
│   │   │   ├── card.ts
│   │   │   ├── event.ts
│   │   │   ├── price.ts
│   │   │   └── set.ts
│   │   ├── ports/
│   │   │   ├── card-repository.ts
│   │   │   ├── event-repository.ts
│   │   │   ├── price-repository.ts
│   │   │   └── cache-service.ts
│   │   └── errors/
│   │       ├── base-error.ts
│   │       ├── api-errors.ts
│   │       ├── price-errors.ts
│   │       └── index.ts
│   ├── bot/
│   │   ├── commands/
│   │   │   ├── card.ts
│   │   │   ├── random.ts
│   │   │   └── events.ts
│   │   ├── actions/
│   │   │   └── callbacks.ts
│   │   ├── formatters/
│   │   │   ├── card-formatter.ts
│   │   │   └── event-formatter.ts
│   │   ├── utils/
│   │   │   └── send-card-preview.ts
│   │   ├── middleware/
│   │   │   └── error-handler.ts
│   │   └── inline-query.ts
│   ├── infrastructure/
│   │   ├── apis/
│   │   │   ├── riftcodex.adapter.ts
│   │   │   └── events.adapter.ts
│   │   └── cache/
│   │       └── memory-cache.service.ts
│   └── utils/
│       └── api-client.ts
```

---

## Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Optional
RAPIDAPI_KEY=                           # Only needed if prices re-enabled
NODE_ENV=development                    # 'development' or 'production'
PORT=8080                               # Server port (webhook mode)
WEBHOOK_URL=https://your-app.example.com # Required in production
CACHE_TTL_CARD_HOURS=168                # 7 days
CACHE_TTL_SEARCH_HOURS=24               # 24 hours
CACHE_TTL_SET_HOURS=168                 # 7 days
API_TIMEOUT_MS=10000                    # 10 seconds
API_RETRY_ATTEMPTS=3                    # Exponential backoff retries
```

---

## Dependencies

```json
{
  "dependencies": {
    "telegraf": "^4.16.3",
    "dotenv": "^17.4.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "vitest": "^1.6.0"
  }
}
```

- `telegraf` — Telegram bot framework
- `dotenv` — Environment variable loading
- `zod` — Runtime schema validation
- `tsx` — TypeScript execution with hot reload

**No Axios**: Native `fetch` (Node.js 18+) minimizes dependencies.

---

## Deployment — justrunmy.app

Free tier: 0.15 vCPU, 0.25 GB RAM, 0.3 GB disk, auto HTTPS, always-on.

### Steps

1. **Create account** at https://justrunmy.app
2. **Push code** via Git (Dockerfile included in repo):
   ```bash
   git push https://<username>:<password>@justrunmy.app/git/<repo> HEAD:deploy
   ```
3. **Configure** in their dashboard or via MCP tools:
   - Set env vars: `TELEGRAM_BOT_TOKEN`, `NODE_ENV=production`, `WEBHOOK_URL=https://<app>.b.jrnm.app`, `PORT=8080`
   - Map port 8080 to HTTPS with a subdomain (e.g., `riftbot`)
4. **Set Telegram webhook**:
   ```bash
   curl -F "url=https://riftbot.b.jrnm.app" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
   ```

Dockerfile is required for Git push deployments. The platform auto-detects Node.js for Zip Upload deployments (no Dockerfile needed).

---

## Error Handling

- **API failures**: Retry with exponential backoff (configurable attempts). Show user-friendly message on final failure.
- **Card not found**: Clear message with suggestions.
- **Events unavailable**: Generic "no events found" or error message.
- **Unexpected errors**: Log full stack trace to console. Show generic message to user.

---

## Local Development

```bash
npm install
npm run dev          # Polling mode, hot reload
```

Bot connects via polling (no webhook needed). Requires `.env` with `TELEGRAM_BOT_TOKEN`.

---

## Testing Checklist

- [ ] `/card Flameblade` — single match shows image + name
- [ ] `/card ahri` — multiple matches show buttons
- [ ] `/card ogn-011` — ID lookup shows image + name
- [ ] `/card nonexistent` — shows "No card found"
- [ ] `/random` — returns a valid card
- [ ] `/events` — shows upcoming events near Seville
- [ ] Inline mode (`@RiftCardsBot ahri`) — shows list with thumbnails
- [ ] Tapping inline result sends `/card <name>` to chat
- [ ] Card search result buttons work
- [ ] Error messages display on API failures

---

## Future Enhancements

- [ ] Price data re-enablement (when API quota is available)
- [ ] User location configuration for events
- [ ] Collection / wishlist tracking
- [ ] Price alerts
- [ ] Admin commands

*(End of document)*
