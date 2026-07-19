# 2. Drop the in-memory cache layer

Date: 2026-07-19

## Status

Accepted.

## Context

The bot originally included an in-memory cache layer (`ICacheService`
interface, `MemoryCacheService` implementation) with per-resource TTLs
exposed as env vars (`CACHE_TTL_CARD_HOURS`, `CACHE_TTL_SEARCH_HOURS`,
`CACHE_TTL_SET_HOURS`). The cache existed to reduce round trips to
the upstream API when the bot was deployed on a free-tier host with
higher-latency external calls.

The current deployment puts the bot and the riftapi container on the
same Docker network. A single HTTP round trip completes in under a
millisecond. The database is a local SQLite file on the same pod. The
cache added complexity — TTL footguns (stale cards served during a bot
sync window, non-obvious invalidation semantics) — for no measurable
latency gain. The cache was also a third-party dependency
(`@node-ts/cache`) that had to be kept in sync.

## Decision

Remove the entire cache layer:

- Delete the `ICacheService` interface and all its references from
  the port layer.
- Delete the `MemoryCacheService` implementation and its factory.
- Delete the `CACHE_TTL_*` env vars from config, `.env.example`, and
  the Docker Compose file.
- The adapters call their upstream endpoints directly on every
  request with no intermediate caching.

## Consequences

- Easier: no TTL bugs, no cache invalidation, no stale-data window
  during sync. The codebase shrinks by several files and one
  dependency. Tests no longer need to mock or assert cache behaviour.
- Harder: every card lookup hits the riftapi SQLite store. This is
  acceptable because the store is local, the table is ~1.2k rows, and
  SQLite queries are sub-millisecond for indexed lookups.
- Given up: the ability to survive a brief upstream outage. The bot
  now degrades immediately if riftapi is unavailable, displaying an
  error message instead of serving stale data. This is preferred
  behaviour for a real-time card lookup tool.
