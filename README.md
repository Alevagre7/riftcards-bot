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
- `/events` — upcoming Riftbound events near a configurable location.
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
| `NODE_ENV` | no | `development` | `development` (polling) or `production` (webhook) |
| `PORT` | no | `8080` | HTTP port in webhook mode |
| `WEBHOOK_URL` | conditional | — | Required when `NODE_ENV=production` |
| `API_TIMEOUT_MS` | no | `10000` | HTTP request timeout to the card source |
| `API_RETRY_ATTEMPTS` | no | `3` | Retry count with exponential backoff |
| `EVENTS_API_URL` | no | upstream URL | Base URL for event data |
| `EVENTS_LATITUDE` | no | `37.39` | Latitude for event search (Seville) |
| `EVENTS_LONGITUDE` | no | `-5.99` | Longitude for event search (Seville) |
| `EVENTS_RADIUS_KM` | no | `80` | Search radius in kilometres |
| `EVENTS_DAYS_AHEAD` | no | `7` | Look-ahead window for events |

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

The riftapi (or riftcodex) instance must be reachable from the bot
container — ensure your network policy allows the connection. The
following `docker-compose.yml` is a starting point; fill in the
missing values:

```yaml
services:
  bot:
    build: .
    ports:
      - "8080:8080"
    environment:
      - TELEGRAM_BOT_TOKEN=your_token
      - CARD_SOURCE=riftapi
      - RIFTAPI_BASE_URL=http://riftapi:8080
      - NODE_ENV=production
      - WEBHOOK_URL=https://bot.example.com
```

---

## Architecture

The project follows a **hexagonal (ports & adapters)** pattern. The
Telegram and core layers depend only on interfaces defined in
`src/core/ports/`. Concrete adapters in `src/infrastructure/apis/`
implement those interfaces and are wired in at startup.

Two card-source adapters are available: **RiftapiAdapter** (primary)
and **RiftcodexAdapter** (fallback), selected by the `CARD_SOURCE` env
var. An **EventsAdapter** handles the `/events` command.

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

Test coverage is intentionally minimal — only the riftapi adapter and
its mapper have tests. See the scope note in
`IMPLEMENTATION_PLAN.md` and ADR-0002 for the rationale.

---

## License

MIT. See [LICENSE](LICENSE).
