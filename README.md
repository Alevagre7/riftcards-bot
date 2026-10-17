# riftcards-bot

A Telegram bot that serves Riftbound card data — name, type, rarity,
rules text, stats, artwork, and set information — via the self-hosted
riftapi. The bot is an open-source, deployment-agnostic project that
anyone can run. Riftbound is a trading card game by Riot Games; this
project is not part of the official Riot developer ecosystem.

---

## Features

- `/card <name|id>` — fuzzy card lookup; multi-match inline buttons
  appear when the query is ambiguous.
- `/random` — one-shot random card with preview.
- `/events` — upcoming Riftbound events near a configurable location,
  with detail, standings, table, and private-chat watch flows.
- `/watching` — inspect, refresh, change, or stop your active event watch.
- `/mytable` — look up a Riot pairing at your selected store and save your player name.
- `/new` — show cards updated during the current UTC day.
- `@RiftCardsBot <query>` — inline search with thumbnails (works in
  any chat).

---

## Quick start

```bash
git clone <repo-url>
cd riftcards-bot
cp .env.example .env
npm install
```

Edit `.env` and set at minimum `TELEGRAM_BOT_TOKEN` (from
[BotFather](https://t.me/BotFather)) and `CARD_SOURCE` with the
base URL of your riftapi instance (or riftcodex fallback).

Build and start:

```bash
npm run build && npm start
```

For development with hot reload (polling mode, no webhook needed):

```bash
npm run dev
```

---

## Configuration

All environment variables are read from `.env` (gitignored) or the
process environment. The bot fails fast at startup on missing required
values.

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | — | Bot token from BotFather |
| `CARD_SOURCE` | yes | — | `riftapi` or `riftcodex` (see ADR-0004) |
| `RIFTAPI_BASE_URL` | conditional | — | Required when `CARD_SOURCE=riftapi` |
| `RIFTCODEX_BASE_URL` | conditional | — | Required when `CARD_SOURCE=riftcodex` |
| `NODE_ENV` | no | `development` | `development` (polling) or `production` (webhook; requires `WEBHOOK_URL`) |
| `PORT` | no | `8080` | HTTP port in webhook mode |
| `WEBHOOK_URL` | conditional | — | Required when `NODE_ENV=production` |
| `API_TIMEOUT_MS` | no | `10000` | HTTP request timeout to the card source |
| `API_RETRY_ATTEMPTS` | no | `3` | Retry count with exponential backoff |
| `PLAYRIFTBOUND_BASE_URL` | no | `https://events.playriftbound.com` | Official Riot events origin (only this value is accepted) |
| `RIFTBOUND_V2_BASE_URL` | no | official V2 URL | Legacy UVS references and existing watches only |
| `EVENTS_LATITUDE` | no | `37.39` | Latitude for event search (Seville) |
| `EVENTS_LONGITUDE` | no | `-5.99` | Longitude for event search (Seville) |
| `EVENTS_RADIUS_KM` | no | `80` | Search radius in kilometres |
| `EVENTS_DAYS_AHEAD` | no | `7` | Look-ahead window for events |
| `NEXUS_WATCHER_ENABLED` | no | `true` | Enable background event-watch polling |
| `NEXUS_WATCHER_INTERVAL_MS` | no | `30000` | Watcher polling interval |
| `ADMIN_TELEGRAM_IDS` | no | — | Comma-separated Telegram IDs allowed to use `/admin` |
| `USER_SETTINGS_DB_PATH` | no | `/data/riftbot.db` | SQLite path for user settings and watches |

---

## Riot events and player tracking

Use `/events` to choose a time window near your saved location. Use `/events set`
to change the location. You can also open an official event URL with
`/events https://events.playriftbound.com/en-US/events/<id>`.
The supported search radius is at most 100 miles (about 161 km).

In a private chat, open an event, tap Watch, and select a player. Use `/watching`
to refresh or stop the watch. Player tracking currently supports 1v1 events.
The bot reads public data. It does not require a Riot login or report results.

For `/mytable`, first select a store using one of its official event URLs:

```text
/mytable store https://events.playriftbound.com/en-US/events/<id> Europe/Madrid
/mytable set PlayerName#TAG
/mytable
```

The bot estimates the store timezone locally from Riot's coordinates. The
optional IANA timezone overrides that estimate and defines the store's calendar day. `/mytable <username>` performs a
one-off lookup. `/mytable clear` forgets your saved player name. The store
preference and player name are separate from the player selected for Watch.

Riot's website API has no developer stability guarantee. The client uses
persisted query IDs and updates them from official website bundles when needed.
Unknown cancellation, result conflicts, and intentional-draw status remain
unknown. A missing event and an API failure are handled separately.
See [migration scope and follow-up work](docs/plans/riot-events-1v1.md).

---

## Deployment

The project ships a **Dockerfile** and runs on any platform that
supports Node.js 22. The image exposes port 8080.

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### Running with Docker Compose

The bot and riftapi can run side by side via docker compose:

```yaml
services:
  api:
    build: ../riftapi
    ports:
      - "18080:8080"
    environment:
      - RIFTAPI_DATABASE_PATH=/data/riftapi.db
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/health"]
      interval: 10s
      timeout: 3s
      retries: 5

  bot:
    build: .
    environment:
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      CARD_SOURCE: riftapi
      RIFTAPI_BASE_URL: http://api:8080
      NODE_ENV: development
    depends_on:
      api:
        condition: service_healthy
```

The `.env` file (with the real `TELEGRAM_BOT_TOKEN`) is gitignored
and must **never** be committed. Create it from `.env.example` and
keep it out of version control.

### Polling mode (default)

The bot uses polling mode by default — no `WEBHOOK_URL` is needed.
This is the simplest setup: the bot connects to Telegram's servers
and pulls updates. Set `NODE_ENV=development` (or omit it) for
polling; the `WEBHOOK_URL` variable is only required when running
in production webhook mode behind a public-facing HTTPS endpoint.

### Card name search

The `/card` command's fuzzy name search hits the
`/cards/search` endpoint on the riftapi, which runs a
case-insensitive substring match against card text and names.

---

## Architecture

The project follows a **hexagonal (ports & adapters)** pattern. The
Telegram and core layers depend only on interfaces defined in
`src/core/ports/`. Concrete adapters in `src/infrastructure/apis/`
implement those interfaces and are wired in at startup.

Two card-source adapters are available: **RiftapiAdapter** (primary)
and **RiftcodexAdapter** (fallback), selected by the `CARD_SOURCE` env
var. New event lists, details, results, and `/mytable` use Riot directly through
its public persisted GraphQL queries. Numeric legacy references use the UVS
adapter. A failed Riot request never falls back to an unrelated UVS event.
The old Riftfound and Nexus adapters are not wired into the bot.

```typescript
import { ICardRepository } from '../../core/ports/card-repository.js';

interface RandomCommandDeps {
  cardRepository: ICardRepository;
}

export function createRandomCommand(deps: RandomCommandDeps) {
  return async (ctx: Context) => {
    await ctx.sendChatAction('typing');
    const card = await deps.cardRepository.getRandomCard();
    if (!card) {
      await ctx.reply('Could not get a random card. Please try again.');
      return;
    }
    await sendCardPreview(ctx, card);
  };
}
```

For the domain glossary see `CONTEXT.md`. Design decisions are logged
in `docs/adr/`.

---

## Development

| Command | Description |
|---|---|
| `npm run dev` | Start in polling mode with `tsx watch` (hot reload) |
| `npm test` | Run vitest (adapter and mapper tests) |
| `npm run build` | Compile with `tsc` to `dist/` |
| `npm run lint` | Type-check without emitting (`tsc --noEmit`) |

The test suite covers bot flows, formatters, API adapters, watcher
diffing, and SQLite repositories. Run `npm test -- --run` for a
non-watch test run.

---

## License

MIT. See [LICENSE](LICENSE).
