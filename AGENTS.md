# AGENTS.md — Riftbound Card Tracker

**Purpose**: Instructions for AI coding agents working on the Riftbound Card Tracker Telegram bot. Defines architecture, contracts, workflows, and deployment.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Layer Rules](#layer-rules)
3. [Interface Contracts](#interface-contracts)
4. [Dependency Injection](#dependency-injection)
5. [Error Handling Taxonomy](#error-handling-taxonomy)
6. [Caching Strategy](#caching-strategy)
7. [API Adapter Guidelines](#api-adapter-guidelines)
8. [Environment Variables](#environment-variables)
9. [Development Workflow](#development-workflow)
10. [Deployment](#deployment)
11. [Code Style](#code-style)

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
- **Contents**: API adapters (Riftcodex, Events), cache implementations.

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

### IPriceRepository (Disabled)
```typescript
// src/core/ports/price-repository.ts

import { PriceData } from '../entities/price';

export interface IPriceRepository {
  getPrice(
    cardIdentifier: string,
    options?: { setCode?: string; collectorNumber?: string },
  ): Promise<PriceData | null>;
}
```

### ICacheService
```typescript
// src/core/ports/cache-service.ts

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
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

// src/core/entities/price.ts
export interface PriceData {
  readonly cardId: string;
  readonly cardName: string;
  readonly currency: string;
  readonly lowestNearMint: number | null;
  readonly lowestNearMintEuOnly: number | null;
  readonly average30d: number | null;
  readonly average7d: number | null;
  readonly gradedPrices?: readonly GradedPrice[];
  readonly lastUpdated?: Date;
  readonly cardmarketUrl?: string;
}

export interface GradedPrice {
  readonly gradingCompany: 'PSA' | 'BGS' | 'CGC' | string;
  readonly grade: string;
  readonly price: number;
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
async function main() {
  const config = loadConfig();
  const cache = new MemoryCacheService();

  const cardRepository = new RiftcodexAdapter({
    baseUrl: 'https://api.riftcodex.com',
    cache,
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
    cacheTtlSeconds: {
      card: config.cacheTtlCardHours * 3600,
      search: config.cacheTtlSearchHours * 3600,
      set: config.cacheTtlSetHours * 3600,
    },
  });

  const eventRepository = new EventsAdapter({
    baseUrl: 'https://api.cloudflare.riftbound.uvsgames.com',
    timeoutMs: config.apiTimeoutMs,
    retryAttempts: config.apiRetryAttempts,
    latitude: 37.389092399999996,
    longitude: -5.9844589,
    numMiles: 25,
  });

  const bot = new Telegraf(config.telegramBotToken);

  bot.command('card', createCardCommand({ cardRepository }));
  bot.command('random', createRandomCommand({ cardRepository }));
  bot.command('events', createEventsCommand({ eventRepository }));
  bot.on('inline_query', createInlineQueryHandler({ cardRepository }));
  bot.action(/^card:(.+)$/, createCardActionHandler({ cardRepository }));

  // Price action disabled — RapidAPI quota exhausted
  // bot.action(/^price:(.+)$/, createPriceActionHandler({ cardRepository, priceRepository }));

  if (config.nodeEnv === 'production') {
    await bot.launch({ webhook: { domain: config.webhookUrl!, port: config.port } });
  } else {
    await bot.launch();
  }
}
```

### Swapping Providers
Change one line in `main()` — zero changes to commands or formatters:

```typescript
// Before
const cardRepository = new RiftcodexAdapter({ ... });
// After
const cardRepository = new NewCardProviderAdapter({ ... });
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

// src/core/errors/price-errors.ts
export class PriceUnavailableError extends DomainError {
  readonly code = 'PRICE_UNAVAILABLE';
  readonly isUserFacing = true;
  constructor(cardName: string) {
    super(`Price data for "${cardName}" is currently unavailable.`);
  }
}

export class ApiRateLimitError extends DomainError {
  readonly code = 'RATE_LIMITED';
  readonly isUserFacing = true;
  constructor() {
    super('The price service is temporarily unavailable due to high demand. Please try again later.');
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
| HTTP 429 (RapidAPI) | `ApiRateLimitError` |
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

## Caching Strategy

### Cache Keys
```
card:{id}              → Card details
card:riftbound:{id}    → Card by Riftbound ID
card:name:{hash}       → Card by name
card:tcgplayer:{id}    → Card by TCGPlayer ID
search:{hash}          → Search results
set:list               → All sets
set:{code}:cards:{page} → Cards in set
price:{cardId}         → Price data
random                 → Random card (60s TTL)
```

### TTL Configuration
```typescript
// src/config.ts
cacheTtlCardHours: z.coerce.number().default(168),    // 7 days
cacheTtlSearchHours: z.coerce.number().default(24),   // 24 hours
cacheTtlSetHours: z.coerce.number().default(168),     // 7 days
```

TTLs are wired into `RiftcodexAdapter` via `cacheTtlSeconds` option (converted to seconds on instantiation).

### MemoryCacheService
```typescript
// src/infrastructure/cache/memory-cache.service.ts
export class MemoryCacheService implements ICacheService { ... }
```

Implements `ICacheService`. `Map`-based with TTL timestamps.

---

## API Adapter Guidelines

When creating a new adapter:
1. Create file in `src/infrastructure/apis/`
2. Implement the port interface
3. Define Zod schemas for API responses
4. Map responses to domain entities before returning
5. Handle errors by mapping to domain errors
6. Wire in `src/index.ts`

See existing adapters for reference: `riftcodex.adapter.ts`, `events.adapter.ts`.

---

## Environment Variables

Validated at startup with Zod.

```typescript
// src/config.ts
const configSchema = z.object({
  telegramBotToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  rapidApiKey: z.string().optional(),

  nodeEnv: z.enum(['development', 'production']).default('development'),
  port: z.coerce.number().default(8080),
  webhookUrl: z.string().url().optional(),

  cacheTtlCardHours: z.coerce.number().default(168),
  cacheTtlSearchHours: z.coerce.number().default(24),
  cacheTtlSetHours: z.coerce.number().default(168),

  apiTimeoutMs: z.coerce.number().default(10000),
  apiRetryAttempts: z.coerce.number().default(3),
});

export function loadConfig(): Config {
  const raw = configSchema.parse({ ... });

  // Enforce webhook URL in production
  if (raw.nodeEnv === 'production' && !raw.webhookUrl) {
    throw new Error('WEBHOOK_URL is required when NODE_ENV=production');
  }

  return raw;
}
```

| Variable | Required | Default |
|----------|----------|---------|
| `TELEGRAM_BOT_TOKEN` | Yes | — |
| `RAPIDAPI_KEY` | No | — |
| `NODE_ENV` | No | `development` |
| `PORT` | No | `8080` |
| `WEBHOOK_URL` | Yes in prod | — |
| `CACHE_TTL_CARD_HOURS` | No | `168` |
| `CACHE_TTL_SEARCH_HOURS` | No | `24` |
| `CACHE_TTL_SET_HOURS` | No | `168` |
| `API_TIMEOUT_MS` | No | `10000` |
| `API_RETRY_ATTEMPTS` | No | `3` |

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
- In-memory cache only
- Verbose logging enabled in middleware

### Testing Commands
| Command | Expected |
|---------|----------|
| `/card Flameblade` | Single match → image + name |
| `/card ahri` | Multiple matches → buttons |
| `/card ogn-011` | ID lookup → image + name |
| `/random` | Random card |
| `/events` | Upcoming events near Seville |
| `@RiftCardsBot ahri` | Inline list with thumbnails |

---

## Deployment

### justrunmy.app
Free tier: 0.15 vCPU, 0.25 GB RAM, 0.3 GB disk, auto HTTPS.

1. Push code via Git (Dockerfile included in repo):
   ```bash
   git push https://<user>:<pass>@justrunmy.app/git/<repo> HEAD:deploy
   ```
2. Configure via dashboard or MCP tools:
   - Env vars: `TELEGRAM_BOT_TOKEN`, `NODE_ENV=production`, `WEBHOOK_URL`, `PORT=8080`
   - Port: map 8080 to HTTPS with a subdomain
3. Set Telegram webhook:
   ```bash
   curl -F "url=https://<app>.b.jrnm.app" \
     https://api.telegram.org/bot<TOKEN>/setWebhook
   ```

Zip Upload also supported (no Dockerfile required — platform auto-detects Node.js).

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
- [ ] Cache checked before API calls
- [ ] New env vars in `.env.example`, `config.ts`, and this doc
- [ ] No `any` in core or bot layers
- [ ] Immutable domain entities (`readonly`)
- [ ] Errors logged, never leaked to users

*(End of AGENTS.md)*
