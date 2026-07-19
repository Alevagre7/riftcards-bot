# 3. Drop the Cloudflare Worker proxy hop

Date: 2026-07-19

## Status

Accepted.

## Context

The bot originally routed all API calls through a Cloudflare Worker
proxy (`riftcards-bot-proxy.alevagre7.workers.dev`) which was
configured via a single env var `RIFTCODEX_PROXY_URL`. The proxy
existed to work around CORS restrictions and network reachability
issues on the previous free-tier host, which could not connect
directly to the Riftcodex public API or the Riot events API.

The current deployment runs the bot on the same host as the riftapi
container, inside a private Docker network with no CORS requirement.
The Riftcodex public API and the Riot events API are reachable from
this host directly (no proxy needed). The proxy introduces an extra
HTTP hop, latency, and a deployment dependency on Cloudflare Workers
that is unrelated to the core application.

## Decision

Remove the Cloudflare Worker proxy hop:

- Delete the `RIFTCODEX_PROXY_URL` env var from config, Docker
  Compose, and all adapter code paths.
- The events adapter now calls the upstream events API directly at
  `https://api.cloudflare.riftbound.uvsgames.com` (default in config).
- The riftcodex adapter (env-flagged fallback) calls the upstream
  Riftcodex API directly at `RIFTCODEX_BASE_URL`.
- The riftapi adapter always talks to the self-hosted riftapi at
  `RIFTAPI_BASE_URL`, which is on the same Docker network.

## Consequences

- Easier: one fewer network hop per request. No dependency on a
  Cloudflare Worker deployment for the bot to function. The codebase
  loses one env var and the associated conditional logic.
- Harder: the events adapter's `baseUrl` default is now baked into
  config and must be changed via `EVENTS_API_URL` on deployment. This
  was previously configurable through the proxy URL as well, but the
  direct URL is more transparent.
- Given up: the ability to swap the upstream endpoint by changing a
  single proxy URL. Each adapter now has its own `*_BASE_URL` env var,
  which is more explicit and easier to debug.
