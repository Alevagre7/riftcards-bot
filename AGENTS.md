# AGENTS.md — Riftbound Card Tracker

**Purpose**: Instructions for AI coding agents working on the Riftbound Card Tracker Telegram bot. Defines architecture, contracts, workflows, and deployment.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Layer Rules](#layer-rules)
3. [Interface Contracts](#interface-contracts)
4. [Dependency Injection](#dependency-injection)
5. [Error Handling Taxonomy](#error-handling-taxonomy)
6. [API Adapter Guidelines](#api-adapter-guidelines)
7. [Environment Variables](#environment-variables)
8. [Development Workflow](#development-workflow)
9. [Deployment](#deployment)
10. [Code Style](#code-style)

---

## Architecture Overview

Hexagonal Architecture (Ports & Adapters) with three layers:

### 1. Core (Domain)
- **Location**: `src/core/`
- **Rule**: ZERO external dependencies. No `fetch`, no `telegraf`, no filesystem.
- **Contents**: Pure TypeScript entities (interfaces) and ports (abstract interfaces).

### 2. Bot (Application)
- **Location**: `src/bot/`
- **Rule**: Depends ONLY on `src/core/ports/`. Never imports from `src/infrastructure/`.
- **Contents**: Telegraf command handlers, middleware, formatters, inline query handlers, callbacks.

### 3. Infrastructure
- **Location**: `src/infrastructure/`
- **Rule**: Implements ports from `src/core/ports/`. Can use external libraries.
- **Contents**: API adapters (Riftapi, Riftcodex, Events).

### Dependency Direction
```
Bot → Core (ports)
Infrastructure → Core (ports)
Core → Nothing
```

**Violation (FORBIDDEN)**:
```typescript
// src/bot/commands/card.ts
import { RiftcodexAdapter } from '../../infrastructure/apis/riftcodex.adapter'; // ❌
```

**Correct**:
```typescript
// src/bot/commands/card.ts
import { ICardRepository } from '../../core/ports/card-repository'; // ✅
```

---

## Layer Rules

### Core Layer
1. No side effects: pure functions only.
2. Entities immutable: `readonly` properties.
3. No framework code: no `telegraf`, no `zod`.
4. Ports are interfaces, not classes.

### Bot Layer
1. Import only from `src/core/ports/` and `src/core/entities/`.
2. Handlers orchestrate repository calls. Logic goes in utilities.
3. Formatters are pure: take entities, return strings.
4. Error boundaries: every handler wrapped in try/catch.

### Infrastructure Layer
1. Implement ports exactly — no signature changes.
2. Map external API responses to domain entities before returning.
3. Handle failures: catch HTTP errors, timeouts. Throw domain errors or return `null`.
4. Zod validation on all API responses.

---

## Interface Contracts

All in `src/core/ports/`.

### ICardRepository
```typescript
// src/core/ports/card-repository.ts

export interface SearchCardsOptions {
  query: string;
  setId?: string;
  page?: number;
  limit?: number;
  sort?: 'name' | 'collector_number' | 'set_id';
  dir?: 'asc' | 'desc';
}

export interface SearchCardsResult {
  cards: Card[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface ICardRepository {
  searchCards(options: SearchCardsOptions): Promise<SearchCardsResult>;
  getCardById(id: string): Promise<Card | null>;
  getCardByRiftboundId(riftboundId: string): Promise<Card | null>;
  getCardByName(name: string): Promise<Card | null>;
  getCardByTcgPlayerId(productId: string): Promise<Card | null>;
  getSets(): Promise<Set[]>;
  getCardsBySet(setCode: string, page?: number, limit?: number): Promise<SearchCardsResult>;
  getRandomCard(): Promise<Card | null>;
}
```

### IEventRepository
```typescript
// src/core/ports/event-repository.ts

import { Event } from '../entities/event';

export interface IEventRepository {
  getEvents(startAfter: Date, startBefore: Date): Promise<Event[]>;
}
```

### Domain Entities

```typescript
// src/core/entities/card.ts
export interface Card {
  readonly id: string;
  readonly name: string;
  readonly setCode: string;
  readonly setName?: string;
  readonly collectorNumber: string;
  readonly rarity: string;
  readonly type: string;
  readonly supertype?: string;
  readonly domain?: string;
  readonly energy?: number;
  readonly might?: number;
  readonly power?: number;
  readonly text?: string;
  readonly flavorText?: string;
  readonly keywords: readonly string[];
  readonly artist?: string;
  readonly imageUrl?: string;
  readonly riftboundId?: string;
  readonly tcgplayerId?: string;
}

// src/core/entities/event.ts
export interface Event {
  readonly name: string;
  readonly storeName: string;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly format: string;
}

// src/core/entities/set.ts
export interface Set {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly releaseDate?: string;
  readonly cardCount?: number;
}
```

---

## Dependency Injection

Manual composition in `src/index.ts`. No DI framework.

### Pattern
```typescript
function buildCardRepository(config: Config): ICardRepository {
  const common = {
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
  };
  switch (config.cardSource) {
    case 'riftapi':
      return new RiftapiAdapter({ baseUrl: config.riftapiBaseUrl!, ...common });
    case 'riftcodex':
      return new RiftcodexAdapter({ baseUrl: config.riftcodexBaseUrl!, ...common });
  }
}

async function main() {
  const config = loadConfig();

  const cardRepository = buildCardRepository(config);

  const eventRepository = new EventsAdapter({
    baseUrl: config.eventsApiUrl,
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
    latitude: config.eventsLatitude,
    longitude: config.eventsLongitude,
    numMiles: config.eventsRadiusKm * 0.621371,
  });

  const bot = new Telegraf(config.telegramBotToken);

  bot.command('card', createCardCommand({ cardRepository }));
  bot.command('random', createRandomCommand({ cardRepository }));
  bot.command('events', createEventsCommand({ eventRepository }));
  bot.on('inline_query', createInlineQueryHandler({ cardRepository }));
  bot.action(/^card:(.+)$/, createCardActionHandler({ cardRepository }));

  if (config.nodeEnv === 'production') {
    await bot.launch({ webhook: { domain: config.webhookUrl!, port: config.port } });
  } else {
    await bot.launch();
  }
}
```

### Swapping Providers
Change the `CARD_SOURCE` env var or add a new `case` in `buildCardRepository` — zero changes to commands or formatters:

```typescript
// The env var selects the active adapter at startup (see ADR-0004).
// CARD_SOURCE=riftapi   → RiftapiAdapter (primary)
// CARD_SOURCE=riftcodex → RiftcodexAdapter (fallback)
```

---

## Error Handling Taxonomy

All errors in `src/core/errors/`.

### Error Classes
```typescript
// src/core/errors/base-error.ts
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly isUserFacing: boolean;
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// src/core/errors/api-errors.ts
export class ApiTimeoutError extends DomainError {
  readonly code = 'API_TIMEOUT';
  readonly isUserFacing = true;
  constructor(service: string) {
    super(`The ${service} service is taking too long to respond. Please try again.`);
  }
}

export class ApiResponseError extends DomainError {
  readonly code = 'API_ERROR';
  readonly isUserFacing = false;
  constructor(service: string, statusCode: number) {
    super(`${service} API returned status ${statusCode}`);
  }
}
```

### Error Mapping
| External Error | Domain Error |
|---------------|--------------|
| HTTP 404 | Return `null` (not an error) |
| HTTP 5xx | `ApiResponseError` |
| Fetch timeout | `ApiTimeoutError` |
| Invalid JSON / parse failure | `ApiResponseError` |

### Error Middleware
```typescript
// src/bot/middleware/error-handler.ts
export function errorHandler() {
  return async (ctx: Context, next: () => Promise<void>) => {
    try {
      await next();
    } catch (error) {
      const user = ctx.from?.username ?? ctx.from?.id ?? 'unknown';
      console.error(`[ERROR] user=${user}`, error);

      if (error instanceof DomainError && error.isUserFacing) {
        await ctx.reply(`⚠️ ${error.message}`);
      } else {
        await ctx.reply('⚠️ Something went wrong. Please try again later.');
      }
    }
  };
}
```

---

## API Adapter Guidelines

When creating a new adapter:
1. Create file in `src/infrastructure/apis/`
2. Implement the port interface
3. Define Zod schemas for API responses
4. Map responses to domain entities before returning
5. Handle errors by mapping to domain errors
6. Wire in `src/index.ts`

See existing adapters for reference: `riftapi.adapter.ts`, `riftcodex.adapter.ts`, `events.adapter.ts`.

---

## Environment Variables

Validated at startup with Zod. The `CARD_SOURCE` variable selects the active card data adapter — there is no default so a misconfigured deployment fails fast with a clear error.

```typescript
// src/config.ts
const cardSourceSchema = z.enum(['riftapi', 'riftcodex']);

const configSchema = z.object({
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // Adapter selection
  cardSource: cardSourceSchema,
  riftapiBaseUrl: z.string().url().optional(),
  riftcodexBaseUrl: z.string().url().optional(),

  nodeEnv: z.enum(['development', 'production']).default('development'),
  port: z.coerce.number().default(8080),
  webhookUrl: z.string().url().optional(),

  apiTimeoutMs: z.coerce.number().default(10000),
  apiRetryAttempts: z.coerce.number().default(3),

  // Events adapter
  eventsApiUrl: z.string().url().default('https://api.cloudflare.riftbound.uvsgames.com'),
  eventsLatitude: z.coerce.number().default(37.39),
  eventsLongitude: z.coerce.number().default(-5.99),
  eventsRadiusKm: z.coerce.number().default(80),
  eventsDaysAhead: z.coerce.number().default(7),
});

export function loadConfig(): Config {
  // CARD_SOURCE validated before schema parse for a clear error message
  const cardSource = process.env['CARD_SOURCE'];
  if (cardSource !== 'riftapi' && cardSource !== 'riftcodex') {
    throw new Error(
      `CARD_SOURCE must be set to "riftapi" or "riftcodex" (got ${JSON.stringify(cardSource)})`,
    );
  }

  const raw = configSchema.parse({ ... });

  // The chosen adapter's base URL is required
  if (raw.cardSource === 'riftapi' && !raw.riftapiBaseUrl) {
    throw new Error('RIFTAPI_BASE_URL is required when CARD_SOURCE=riftapi');
  }
  if (raw.cardSource === 'riftcodex' && !raw.riftcodexBaseUrl) {
    throw new Error('RIFTCODEX_BASE_URL is required when CARD_SOURCE=riftcodex');
  }

  if (raw.nodeEnv === 'production' && !raw.webhookUrl) {
    throw new Error('WEBHOOK_URL is required when NODE_ENV=production');
  }

  return raw;
}
```

| Variable | Required | Default |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | — |
| `CARD_SOURCE` | Yes | — |
| `RIFTAPI_BASE_URL` | Conditional | — |
| `RIFTCODEX_BASE_URL` | Conditional | — |
| `NODE_ENV` | No | `development` |
| `PORT` | No | `8080` |
| `WEBHOOK_URL` | Yes in prod | — |
| `API_TIMEOUT_MS` | No | `10000` |
| `API_RETRY_ATTEMPTS` | No | `3` |
| `EVENTS_API_URL` | No | upstream URL |
| `EVENTS_LATITUDE` | No | `37.39` |
| `EVENTS_LONGITUDE` | No | `-5.99` |
| `EVENTS_RADIUS_KM` | No | `80` |
| `EVENTS_DAYS_AHEAD` | No | `7` |

---

## Development Workflow

### Prerequisites
- Node.js 22+
- Telegram bot token from @BotFather

### Setup
```bash
npm install
cp .env.example .env
# Edit .env with TELEGRAM_BOT_TOKEN
npm run dev
```

### Scripts
```json
{
  "dev": "tsx watch src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "lint": "tsc --noEmit",
  "test": "vitest"
}
```

### Local Development
- Polling mode (no webhook needed)
- Hot reload via `tsx watch`
- Verbose logging enabled in middleware

### Testing Commands
| Command | Expected |
|---------|----------|
| `/card Flameblade` | Single match → image + name |
| `/card ahri` | Multiple matches → buttons |
| `/card ogn-011` | ID lookup → image + name |
| `/random` | Random card |
| `/events` | Upcoming events near the configured location |
| `@RiftCardsBot ahri` | Inline list with thumbnails |

---

## Deployment

### Docker-based Host

The bot ships with a Dockerfile. Deploy via any Docker host with the following:

1. Build or pull the image:
   ```bash
   docker build -t riftcards-bot .
   ```
2. Run with the required env vars:
   ```bash
   docker run -d --name riftcards-bot \
     -e TELEGRAM_BOT_TOKEN=... \
     -e CARD_SOURCE=riftapi \
     -e RIFTAPI_BASE_URL=http://riftapi:8080 \
     -e NODE_ENV=production \
     -e WEBHOOK_URL=https://your-app.example.com \
     -p 8080:8080 \
     riftcards-bot
   ```
3. Set Telegram webhook:
   ```bash
   curl -F "url=https://your-app.example.com" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
   ```

The bot talks to upstream APIs directly — no proxy layer required. Ensure the card data source (riftapi or riftcodex) and the events API are reachable from the container's network.

---

## Code Style

### TypeScript Config
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Naming
- **Files**: kebab-case (`card-repository.ts`)
- **Interfaces**: PascalCase + `I` prefix (`ICardRepository`)
- **Classes**: PascalCase (`RiftcodexAdapter`)
- **Functions**: camelCase (`searchCards`)

### Import Order
1. External (`telegraf`, `zod`)
2. Core domain (`../../core/...`)
3. Bot layer (`../../bot/...`)
4. Infrastructure (`../../infrastructure/...`)
5. Utilities (`../../utils/...`)

---

## Checklist

Before submitting code:

- [ ] No layer violations (bot → infrastructure)
- [ ] Ports implemented exactly
- [ ] API responses Zod-validated
- [ ] New env vars in `.env.example`, `config.ts`, and this doc
- [ ] No `any` in core or bot layers
- [ ] Immutable domain entities (`readonly`)
- [ ] Errors logged, never leaked to users

*(End of AGENTS.md)*
