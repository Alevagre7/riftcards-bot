# 6. Introduce SQLite persistence for per-user settings

Date: 2026-07-20

## Status

Accepted.

## Context

The bot is currently fully stateless: every interaction is a fresh
lookup, with no database, in-memory store, or per-user state cache
(`src/infrastructure/cache/` is empty per ADR-0002). The `/events`
command's location is hard-coded to a Seville default via env vars
(`EVENTS_LATITUDE`, `EVENTS_LONGITUDE`, `EVENTS_RADIUS_KM`); all users
share the same location and the same radius.

The next feature set makes location user-configurable. To support
that, the bot must persist per-TelegramUser settings across restarts.
This is the first time the bot holds state between requests. The
question is where and how.

## Decision

The bot introduces a single SQLite database file accessed via
`better-sqlite3`, mounted as a Docker volume, with one table for now
and a port interface in front of it:

**Storage**
- File: `/data/riftbot.db` inside the container, backed by a Docker
  volume so the data survives restarts and image rebuilds.
- Driver: `better-sqlite3`. Synchronous, no native build gymnastics
  beyond a prebuilt binary, well-suited to one-off writes inside
  Telegraf's async/await handler model.
- Migrations: a single `001_init.sql` migration at
  `src/infrastructure/persistence/migrations/001_init.sql`, applied
  idempotently at startup. No migration framework; one file is enough
  for the current surface.

**Schema (v1)**

```sql
CREATE TABLE IF NOT EXISTS user_locations (
  telegram_id  INTEGER PRIMARY KEY,
  latitude     REAL    NOT NULL,
  longitude    REAL    NOT NULL,
  radius_km    REAL,             -- NULL = use global EVENTS_RADIUS_KM
  updated_at   TEXT    NOT NULL  -- ISO-8601
);
```

**Port** — `IUserSettingsRepository` at
`src/core/ports/user-settings-repository.ts`:

```typescript
export interface UserLocation {
  readonly telegramId: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusKm: number | null;
  readonly updatedAt: string;
}

export interface IUserSettingsRepository {
  getLocation(telegramId: number): Promise<UserLocation | null>;
  setLocation(
    telegramId: number,
    location: { latitude: number; longitude: number; radiusKm?: number | null },
  ): Promise<void>;
  clearLocation(telegramId: number): Promise<void>;
}
```

**Adapter** — `SqliteUserSettingsRepository` at
`src/infrastructure/persistence/sqlite-user-settings-repository.ts`,
constructed once in `src/index.ts` and injected into the new
`/events set` and `/events clear` command factories.

**Location capture** — when the user runs `/events set`, the bot
sends a message with a single inline `RequestLocation` keyboard
button. On `message.location` receipt, the bot stores
`{ latitude, longitude }` and confirms. No geocoding, no third-party
API, no free-text address parsing.

**Radius** — global by default (`EVENTS_RADIUS_KM`). Per-user override
is supported via the `radius_km` column but is not exposed in the v1
`/events set` flow (a future `/events radius <km>` command can write
it). The v1 setup flow only captures the pin.

**Test surface** — the adapter has unit tests against an in-memory
`:memory:` SQLite database (no file I/O, no fixtures). The port has
no tests; the contract is the test.

## Consequences

- Easier: per-user location. Future per-user features (favourites,
  history, /new filters) reuse the same `SqliteUserSettingsRepository`
  pattern with new tables and port methods.
- Easier: the chosen adapter (`better-sqlite3`) is a small npm
  dependency with prebuilt binaries for the bot's deploy targets; no
  infra beyond a Docker volume mount.
- Harder: the bot is no longer restart-safe by definition. A
  misconfigured volume (or an image rebuild without `-v`) loses user
  settings. The deploy story (Dockerfile + compose) must be updated
  to mount a named volume; this is the first piece of stateful
  config the bot has, and `AGENTS.md`'s "stateless" mental model
  needs a one-line note in the deployment section.
- Harder: the bot now has a schema. Future schema changes need
  migrations, even if simple. We accept that complexity now to keep
  the door open.
- Harder: the adapter is sync (`better-sqlite3` is sync) but the port
  returns `Promise`. The adapter wraps calls in
  `Promise.resolve(...)` for symmetry with the rest of the codebase;
  the synchronous nature is an implementation detail of the chosen
  driver and a future async driver (libsql, postgres) is a
  drop-in if the table grows.
- Given up: full statelessness. This is the explicit point of the
  ADR — the project is choosing user settings over pure
  restart-safety.
- **Deferred**: backup. The SQLite file is a single point of failure.
  A future ADR (or a follow-up to this one) should add a periodic
  `tar` of the `.db` file to a backup volume, mirroring the
  riftapi backup path. For now, the volume is the backup.

## Alternatives considered

- **In-memory `Map<telegramId, settings>`** — zero infra, but lost
  on restart. Rejected: defeats the purpose of "user-configurable".
- **JSON file per user** — no transactions, race conditions on
  concurrent writes, ugly to inspect. Rejected.
- **Supabase Postgres** (the user has the Supabase MCP available) —
  the rest of the bot doesn't need a network DB, and the table is
  tiny (one row per active Telegram user, hundreds not millions).
  Rejected as overkill; the door is not closed if future needs
  push that way.
