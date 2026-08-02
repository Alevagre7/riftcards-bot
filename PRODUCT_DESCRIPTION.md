# Riftbound Card Tracker - Telegram Bot

## Project Overview
Telegram bot for looking up Riftbound TCG cards and discovering local events. Users search for cards by name, browse them inline, get random cards, and find upcoming tournament events near the configured location.

Hexagonal architecture (Ports & Adapters) ensures API providers can be swapped without touching core logic.

---

## Technical Stack
- **Language**: TypeScript 5.x (Strict mode)
- **Runtime**: Node.js 22+
- **Framework**: Telegraf v4.16
- **HTTP Client**: Native `fetch` with custom retry/timeout wrapper
- **Validation**: Zod v4.4 for env vars and API responses
- **Hosting**: Docker-based host (minimum: 0.15 vCPU, 256 MB RAM, 0.3 GB disk, auto HTTPS)
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
│  (Entities: Card, Event, Set)                                 │
│  (Ports: ICardRepository, IEventRepository)                    │
│                    ↓ Implemented by Adapters                 │
├─────────────────────────────────────────────────────────────┤
│                    Infrastructure                            │
│  (RiftapiAdapter, RiftboundV2Adapter, RiftfoundEventsAdapter) │
└─────────────────────────────────────────────────────────────┘
```

**Rule**: Telegram and Core layers NEVER import from `src/infrastructure/`. All communication goes through ports defined in `src/core/ports/`.

---

## Bot Commands

| Command | Description |
|---------|-------------|
| `/card <name or ID>` | Look up a card by name or ID (e.g. `ogn-011` or `ogn-011/298`). Shows image + name; ambiguous names show clickable print choices. |
| `/random` | Get a random card image + name. |
| `/events` | List upcoming Riftbound events near the configured location (next 7 days, configurable radius), with detail, standings, rounds, and watch flows. |
| `/mytable` | Look up and save a Nexus pairing username. |
| `/new` | Show cards updated during the current UTC day. |
| `/admin` | List and stop active event watches for configured admins. |

### Inline Mode
Type `@RiftCardsBot <card name>` in any chat to search cards inline. Selecting a result sends that exact print directly; cards without an image fall back to `/card <composite-id>`.

### Callback Buttons
- `card:{id}` — Card result buttons (from `/card` search results). Opens the full card preview.

---

## APIs

### 1. Card Data — Self-hosted RiftAPI (primary) / Riftcodex (fallback)
- **Primary**: Self-hosted RiftAPI (`src/infrastructure/apis/riftapi.adapter.ts`) — the default source.
- **Fallback**: Third-party Riftcodex public API (`src/infrastructure/apis/riftcodex.adapter.ts`) — activated by setting `CARD_SOURCE=riftcodex` in `.env`.
- **Port**: `ICardRepository`

**Used endpoints (RiftAPI):**
| Endpoint | Use |
|----------|-----|
| `GET /cards/search?query=` | Search cards by fuzzy name |
| `GET /cards/riftbound/{id}` | Get all prints for a Riftbound ID (e.g. `ogn-011`) |
| `GET /cards/random` | Get a random card |

**Fallback endpoints (Riftcodex):**
| Endpoint | Use |
|----------|-----|
| `GET /cards/name?fuzzy=` | Search cards by fuzzy name |
| `GET /cards/riftbound/{id}` | Get card by Riftbound ID (e.g. `ogn-011`) |
| `GET /cards/tcgplayer/{id}` | Get card by TCGplayer product ID |
| `GET /index/card-names` | Get all card names (random card) |

### 2. Events — Riftfound + official V2 APIs
- **List primary**: `https://www.riftfound.com/api`
- **Detail/live fallback and source of truth**: `https://api.riftbound.uvsgames.com/api/v2`
- **Auth**: None (public)
- **Adapters**: `riftfound-events.adapter.ts` and `riftbound-v2.adapter.ts`
- **Ports**: `IEventListingRepository` and `IEventRepository`

**Used endpoint:**
| Endpoint | Use |
|----------|-----|
| `GET /api/v2/events/` | Search official events by location, date range, and game |

**Parameters**: The V2 listing uses `start_date_after`, `start_date_before`,
`game_slug=riftbound`, `latitude`/`longitude`, and `num_miles`. Riftfound
uses its calendar endpoint and radius in kilometres.

---

## Project Structure

```
.
├── .env.example
├── .gitignore
├── PRODUCT_DESCRIPTION.md
├── AGENTS.md
├── RIFTCODEX_API.md
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
│   │   │   └── set.ts
│   │   ├── ports/
│   │   │   ├── card-repository.ts
│   │   │   └── event-repository.ts
│   │   └── errors/
│   │       ├── base-error.ts
│   │       ├── api-errors.ts
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
│   │   │   ├── riftapi.adapter.ts
│   │   │   ├── riftapi-mapper.ts
│   │   │   ├── riftcodex.adapter.ts
│   │   │   ├── riftbound-v2.adapter.ts
│   │   │   └── riftfound-events.adapter.ts
│   └── utils/
│       └── api-client.ts
```

---

## Environment Variables

```env
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_here
CARD_SOURCE=riftapi                     # 'riftapi' or 'riftcodex'
RIFTAPI_BASE_URL=                       # Base URL of self-hosted RiftAPI

# Optional
RIFTCODEX_BASE_URL=                     # Only required when CARD_SOURCE=riftcodex
NODE_ENV=development                    # 'development' or 'production'
PORT=8080                               # Server port (webhook mode)
WEBHOOK_URL=https://your-app.example.com # Required in production
API_TIMEOUT_MS=10000                    # 10 seconds
API_RETRY_ATTEMPTS=3                    # Exponential backoff retries

# Events (defaults shown)
# RIFTBOUND_V2_BASE_URL=https://api.riftbound.uvsgames.com/api/v2
# RIFTFOUND_BASE_URL=https://www.riftfound.com/api
# EVENTS_LATITUDE=37.39
# EVENTS_LONGITUDE=-5.99
# EVENTS_RADIUS_KM=80
# EVENTS_DAYS_AHEAD=7
# NEXUS_TABLE_API_URL=https://riftboundtoolkit.netlify.app/.netlify/functions/nexus-table
# NEXUS_WATCHER_ENABLED=true
# NEXUS_WATCHER_INTERVAL_MS=30000
# USER_SETTINGS_DB_PATH=/data/riftbot.db
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

## Deployment — Docker-based host

Minimum specs: 0.15 vCPU, 256 MB RAM, 0.3 GB disk, auto HTTPS, always-on.

### Steps

1. **Build the Docker image** (Dockerfile included in repo):
   ```bash
   docker build -t riftcards-bot .
   ```
2. **Run the container**:
   ```bash
   docker run -d \
     -p 8080:8080 \
     -e TELEGRAM_BOT_TOKEN=your_token \
     -e CARD_SOURCE=riftapi \
     -e RIFTAPI_BASE_URL=http://riftapi:8080 \
     -e NODE_ENV=production \
     -e WEBHOOK_URL=https://your-app.example.com \
     riftcards-bot
   ```
3. **Set Telegram webhook**:
   ```bash
   curl -F "url=https://your-app.example.com" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
   ```

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
- [ ] `/events` — shows upcoming events near the configured location
- [ ] Inline mode (`@RiftCardsBot ahri`) — shows list with thumbnails
- [ ] Tapping inline result sends the selected print to chat
- [ ] Card search result buttons work
- [ ] Error messages display on API failures

---

## Future Enhancements

- [ ] Collection / wishlist tracking
- [ ] Price alerts

*(End of document)*
