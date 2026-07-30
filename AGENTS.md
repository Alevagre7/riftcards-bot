# Repository Guidelines — Riftbound Card Tracker (`riftbot`)

## Project Overview

Telegram bot for Riftbound TCG card lookup, event listings, and inline queries. Built with Telegraf (Telegram Bot API framework), TypeScript, and SQLite. Part of the `riftbound-tcg` stack alongside a Go API server (`riftapi`), a one-shot scraper, and an Ofelia scheduler sidecar.

---

## Architecture & Data Flow

### Hexagonal (Ports & Adapters)

```
src/
├── core/               # Domain layer — ZERO dependencies
│   ├── entities/       # Card, Event, Set, EventRegistration (readonly interfaces)
│   ├── ports/          # ICardRepository, IEventRepository, IUserSettingsRepository
│   └── errors/         # DomainError, ApiTimeoutError, ApiResponseError
├── bot/                # Presentation layer — depends ONLY on core/
│   ├── commands/       # /card, /random, /events, /new
│   ├── actions/        # Callback query handlers (card, event, new)
│   ├── handlers/       # Generic message handlers (location pickup)
│   ├── middleware/      # error-handler, logging middleware
│   ├── state/          # In-memory SetupFlow (TTL-based, not persistent)
│   ├── formatters/     # Pure rendering functions (card-label, event-list, event-detail)
│   ├── inline-query.ts # @BotName <query> flow
│   └── utils/          # strip-command, send-card-preview
├── infrastructure/     # Adapter layer — implements ports
│   ├── apis/           # RiftapiAdapter, RiftcodexAdapter, EventsAdapter, riftapi-mapper
│   └── persistence/    # SqliteUserSettingsRepository, openDatabase, migrations/
├── utils/              # Shared: fetchWithRetry, levenshtein, kmToMiles
├── config.ts           # Zod-validated env config
└── index.ts            # Entry point — DI wiring, middleware, commands, launch
```

### Dependency Direction

```
Bot → Core (ports/entities only)
Infrastructure → Core (ports only)
Core → Nothing (no imports outside own layer)
```

**Rule**: `src/bot/` never imports from `src/infrastructure/`. `src/core/` never imports from `src/bot/`, `src/infrastructure/`, or any external package.

### Data Flow (typical request)

```
Telegram user → /card Ahri
  → bot.command('card') handler
    → ICardRepository.searchCards({ query: 'Ahri' })
      → RiftapiAdapter fetch GET .../cards/search?q=Ahri
        → HTTP API → parse → Zod validate → map to Card[]
    → formatVersionLabel(card) + sortByVersion(cards)
    → ctx.replyWithPhoto + caption
```

---

## Key Directories

| Path | Purpose |
|---|---|
| `src/core/` | Domain entities, port interfaces, error types — pure TS, zero dependencies |
| `src/bot/commands/` | Each bot command as a factory function |
| `src/bot/actions/` | Inline keyboard callback handlers |
| `src/bot/formatters/` | Pure functions: entity → Telegram message (HTML + buttons) |
| `src/bot/middleware/` | Error boundary, logging |
| `src/bot/state/` | Transient in-memory flow state (setup-flow singleton) |
| `src/bot/utils/` | Shared bot utilities (strip-command, send-card-preview) |
| `src/infrastructure/apis/` | HTTP adapters implementing ports |
| `src/infrastructure/persistence/` | SQLite via better-sqlite3, migrations |
| `src/utils/` | Framework-agnostic utilities (fetchWithRetry, Levenshtein, unit conversion) |
| `migrations/` (under persistence) | Raw SQL migration files, applied on startup |

---

## Development Commands

```bash
npm run dev       # tsx watch src/index.ts — hot-reload dev server
npm run build     # tsc + scripts/copy-migrations.mjs — compile to dist/
npm run start     # node dist/index.js — run compiled output
npm run lint      # tsc --noEmit — type-check only (no ESLint/Prettier)
npm test          # vitest — auto-discovers **/*.test.ts
```

### Docker Compose (full stack, from parent dir)

```bash
cd /home/avalenzuela/code/riftbound-tcg
docker compose build riftbot          # Build just the bot image
docker compose up -d riftbot          # Recreate bot container
docker compose up -d                  # Start full stack (riftapi, riftbot, ofelia)
docker compose logs -f riftbot        # Tail bot logs
```

---

## Code Conventions & Common Patterns

### Naming

- **Files**: kebab-case (`card-repository.ts`, `event-list-formatter.ts`)
- **Interfaces**: PascalCase + `I` prefix (`ICardRepository`, `IUserSettingsRepository`)
- **Classes**: PascalCase (`RiftapiAdapter`, `SqliteUserSettingsRepository`)
- **Functions**: camelCase (`searchCards`, `formatVersionLabel`)
- **Test files**: `{source}.test.ts` — co-located with source, NOT in `__tests__/`

### Imports

ESM: always use `.js` extension in relative imports (tsc outputs `.js` files).

```typescript
import { Card } from '../../core/entities/card.js';  // ✅
import { Card } from '../../core/entities/card';     // ❌
```

Order: external → core → bot → infrastructure → utils.

### TypeScript

Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Target ES2022, module NodeNext.

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

- Domain entity properties are `readonly`.
- Use `?.` optional chaining and `??` nullish coalescing — no non-null assertions on entity fields.
- Indexing arrays needs `!` or a guard: `results[0]!` or `const first = results[0]; if (first) { ... }`.

### Dependency Injection (Manual)

No DI framework. `src/index.ts` wires everything manually:

```typescript
// Pattern: factory function returning port implementation
function buildCardRepository(config: Config): ICardRepository {
  const common = { timeoutMs: config.apiTimeoutMs, retryAttempts: config.apiRetryAttempts };
  switch (config.cardSource) {
    case 'riftapi':
      return new RiftapiAdapter({ baseUrl: config.riftapiBaseUrl!, ...common });
    case 'riftcodex':
      return new RiftcodexAdapter({ baseUrl: config.riftcodexBaseUrl!, ...common });
  }
}

// Pattern: command receives deps object
bot.command('card', createCardCommand({ cardRepository }));
bot.command('events', createEventsCommand({ eventRepository, userSettingsRepository, defaultLocation, daysAhead }));
```

### Error Handling

Domain errors are class-based with an `isUserFacing` flag:

```typescript
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly isUserFacing: boolean;
}

export class ApiTimeoutError extends DomainError {
  readonly code = 'API_TIMEOUT';
  readonly isUserFacing = true;
}
```

Error boundary middleware catches all downstream errors:

```typescript
export function errorHandler() {
  return async (ctx: Context, next: () => Promise<void>) => {
    try {
      await next();
    } catch (error) {
      console.error(`[ERROR] ...`, error);
      if (error instanceof DomainError && error.isUserFacing) {
        await ctx.reply(`⚠️ ${error.message}`);
      } else {
        await ctx.reply('⚠️ Something went wrong. Please try again later.');
      }
    }
  };
}
```

- HTTP 404 in API adapters returns `null` (not an error).
- HTTP 5xx / network errors throw `ApiResponseError` or `ApiTimeoutError`.
- Errors are logged with user info, never leaked to users unless `isUserFacing`.

### Command Handlers

Each command is a factory function returning `(ctx: Context) => Promise<void>`.

```typescript
// Pattern: factory + deps object
export function createCardCommand(deps: { cardRepository: ICardRepository }) {
  return async (ctx: Context) => {
    try {
      const text = stripCommand(ctx.message?.text ?? '', 'card');
      // ... send response
    } catch (error) {
      // Error propagates to errorHandler middleware via ctx.reply
    }
  };
}
```

### Formatters

Pure functions: entity → `{ body: string, buttons: InlineKeyboardButton[][] }` or HTML string.

```typescript
export function formatEventList(
  events: Event[],
  daysAhead: number,
  options?: { timezone?: string }
): { body: string; buttons: InlineKeyboardButton[][] } {
  // Pure transformation, no side effects, no ctx access
}
```

### State Management

In-memory, TTL-based, non-persistent. Only one flow kind: `events-set-location`.

```typescript
// setup-flow.ts — singleton, Map<telegramId, FlowEntry> with 5-min TTL
export const setupFlow = new SetupFlow();  // start(), consume(), cancel()
```

Bot restart abandons pending flows (acceptable — user retries).

### API Adapter Pattern

```typescript
export class RiftapiAdapter implements ICardRepository {
  constructor(private options: { baseUrl: string; timeoutMs: number; retryAttempts: number }) {}

  async searchCards(options: SearchCardsOptions): Promise<SearchCardsResult> {
    const url = this.buildUrl('/cards/search', new URLSearchParams({ q: options.query }));
    const response = await fetchWithRetry(url, { timeout: this.options.timeoutMs, retries: this.options.retryAttempts });

    if (!response.ok) {
      if (response.status === 404) return { cards: [], total: 0, page: 1, hasMore: false };
      throw new ApiResponseError('Riftapi', response.status);
    }

    const data = RIFTAPI_CARDS_RESPONSE.parse(await response.json());  // Zod validation
    return { cards: data.results.map(mapRiftapiCardToCard), total: data.count, page: data.page, hasMore: !!data.next };
  }
}
```

All external API responses are Zod-validated before use. Mappers are pure functions.

### fetchWithRetry

Shared utility: AbortController-based timeout + exponential backoff. Default 10s timeout, 3 retries.

```typescript
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = 10000, retries = 3, ...fetchOptions } = options;
  for (let attempt = 1; attempt <= retries; attempt++) { ... }
}
```

### Configuration

Zod schema in `src/config.ts`. All env vars validated at startup. Conditional required vars per adapter.

```typescript
const configSchema = z.object({
  cardSource: z.enum(['riftapi', 'riftcodex']),
  riftapiBaseUrl: z.string().url().optional(),
  riftcodexBaseUrl: z.string().url().optional(),
  eventsRadiusKm: z.coerce.number().default(80),
  eventsDaysAhead: z.coerce.number().default(7),
  // ...
});
```

### Unit Conversion

Bot config is in kilometers (km), upstream events API expects miles. Use `src/utils/units.ts`:

```typescript
export const KM_PER_MILE = 0.621371;
export function kmToMiles(km: number): number { return km * KM_PER_MILE; }
```

---

## Important Files

| File | Purpose |
|---|---|
| `src/index.ts` | Entry point, DI wiring, command registration, bot launch |
| `src/config.ts` | Zod-validated env config, `loadConfig()` |
| `src/core/ports/card-repository.ts` | `ICardRepository`, `SearchCardsOptions`, `SearchCardsResult` |
| `src/core/ports/event-repository.ts` | `IEventRepository`, `EventLocation` |
| `src/core/ports/user-settings-repository.ts` | `IUserSettingsRepository`, `UserLocation` |
| `src/core/entities/card.ts` | `Card` interface (all fields readonly, optional flags) |
| `src/core/errors/base-error.ts` | `DomainError` abstract class |
| `src/utils/api-client.ts` | `fetchWithRetry` (timeout + retry) |
| `src/infrastructure/apis/riftapi.adapter.ts` | Primary card data adapter |
| `src/infrastructure/apis/events.adapter.ts` | Events API adapter (note: num_miles uses `Math.round`) |
| `src/infrastructure/persistence/open-database.ts` | SQLite init, WAL, migrations |

---

## Runtime/Tooling

- **Runtime**: Node.js 22+ (Alpine in prod, any OS for dev)
- **Package manager**: npm (used consistently; `npm ci` in Docker builds)
- **Module system**: ESM (`"type": "module"` in package.json)
- **TypeScript**: `tsc` for compilation (no SWC/esbuild), `tsx` for dev/watch mode
- **Linting**: `tsc --noEmit` only — no ESLint, no Prettier
- **Testing**: Vitest (zero-config, no setup files)
- **Database**: SQLite via `better-sqlite3` (synchronous driver wrapped in async interface)

---

## Testing & QA

### Running Tests

```bash
npm test              # All tests
npx vitest run        # Same, explicit runner
npx vitest run -t "formatEventList"  # Filter by test name
```

### Test Patterns

Three distinct patterns used across 10 test files (~98 test cases):

**1. Pure function tests** (majority — formatters, utilities, mappers)

```typescript
describe('formatVersionLabel', () => {
  it('returns the base label for a card without alternate art', () => {
    const card = baseCard({ riftboundId: 'ven-21', isAlternateArt: false });
    expect(formatVersionLabel(card)).toBe('VEN-21');
  });
});
```

- No mocks, no setup. Import function, call with test data, assert on output.
- Fixtures are factory functions (`baseCard(over: Partial<Card>)`) or inline object literals.

**2. API adapter tests** (fetch mocking)

```typescript
describe('RiftapiAdapter.searchCards', () => {
  let adapter: RiftapiAdapter;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    adapter = new RiftapiAdapter({ baseUrl: 'https://test.api', timeoutMs: 5000, retryAttempts: 1 });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('constructs the correct URL', async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(mockResponse), { status: 200 }));
    await adapter.searchCards({ query: 'Ahri' });
    expect(fetchSpy.mock.calls[0]![0]).toContain('/cards/search?q=Ahri');
  });
});
```

- Always `vi.stubGlobal('fetch', spy)` in `beforeEach`, `vi.unstubAllGlobals()` in `afterEach`.
- No `vi.mock()`, no `vi.spyOn()`, no MSW.

**3. Database integration tests** (in-memory SQLite)

```typescript
describe('SqliteUserSettingsRepository (in-memory)', () => {
  let db: Database.Database;
  let repo: SqliteUserSettingsRepository;

  beforeEach(() => {
    db = openDatabase(':memory:');  // Triggers real migrations
    repo = new SqliteUserSettingsRepository(db);
  });

  afterEach(() => { db.close(); });
  // ... CRUD tests
});
```

- Fresh in-memory DB per test (no shared state).
- File-backed tests use `os.tmpdir()` with explicit `mkdirSync`/`rmSync` cleanup.

### What Not to Do

- No `vi.mock()` (module-level mocking) — use `vi.stubGlobal` for globals.
- No `__mocks__/` directories.
- No setup files — Vitest works zero-config with the project's tsconfig.
- No coverage plugin installed.
- Tests must pass the strictest TS config (same tsconfig as source).

---

## Deployment

Docker compose stack from the parent `docker-compose.yml`. Key env vars:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From shared `.env` |
| `CARD_SOURCE` | Yes | — | `riftapi` or `riftcodex` |
| `RIFTAPI_BASE_URL` | Conditional | — | Required when `CARD_SOURCE=riftapi` |
| `NODE_ENV` | No | `development` | `development`=polling, `production`=webhook |
| `USER_SETTINGS_DB_PATH` | No | `/data/riftbot.db` | SQLite path (inside `/data` volume) |
| `EVENTS_LATITUDE` / `LONGITUDE` | No | Seville, Spain | Default event location |
| `EVENTS_RADIUS_KM` | No | 80 | Converted to miles internally |

Secrets are split: per-service `.env` files for service-specific vars, shared `.env` for tokens (bot token, rapidapi key).

## Deploy workflow

Every plan or task is verified, committed, and deployed on a feature branch before merging to main. The Mini PC tracks whatever branch is checked out; `scripts/deploy.sh <branch>` is the single entry point.

Post-task steps the agent runs:

1. Verify in `riftbot/`: `npm run build` (no errors), `npx vitest run` (all green). If either fails, stop.
2. Branch: `git -C riftbot checkout -b feat/<plan-slug>` where `<plan-slug>` is a kebab-case short name (e.g., `events-help-deploy`).
3. Commit: `git -C riftbot add -A && git -C riftbot commit -m "<message>"`. Multiple commits per plan are fine; group by phase.
4. Push: `git -C riftbot push -u origin feat/<plan-slug>`.
5. Deploy the branch for the user to verify: `scripts/deploy.sh feat/<plan-slug>`. Echoes the deployed SHA; relay that to the user so they know what to test.
6. Stop. Ask the user via `ask`: "Did you test the deployed branch? Does it work?" Do not merge until they confirm. If they request changes, stay on the branch — repeat steps 3–5 for the iteration, then re-ask.

On user confirmation, the agent closes the loop immediately — do not wait for a separate request:

7. `git -C riftbot checkout main && git -C riftbot pull --ff-only`.
8. `git -C riftbot merge --no-ff feat/<plan-slug> -m "Merge feat/<plan-slug>"`.
9. `git -C riftbot push origin main`.
10. `scripts/deploy.sh` (no branch arg — uses the now-current main).
11. Clean up: `git -C riftbot branch -d feat/<plan-slug> && git -C riftbot push origin --delete feat/<plan-slug>`.

If the user asks for an iteration on the same plan before merge: edit, commit on the same branch, push, run `scripts/deploy.sh feat/<plan-slug>` again. Repeat until approval.

If `git push` requires interactive auth (no SSH key on this host), the agent surfaces the exact `git push` line for the user to run, then resumes from step 5.
