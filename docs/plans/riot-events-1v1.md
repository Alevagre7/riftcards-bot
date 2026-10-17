# Riot events: 1v1 migration

The initial implementation uses the public endpoint consumed by Riot's own event website. It covers event search, details, participants, rounds, pairings, standings, Watch, and store-based `/mytable`. The implementation does not use a community events API.

## Deliberate scope

The user approved 1v1 as the initial scope. Events with team formats remain listed, but the bot disables player tracking for unsupported teams. Future 2v2 work needs team membership, team results, a roster selection flow, and real fixtures. Do not flatten a two-player team into a single player.

The public response does not establish explicit cancellation, conflicting reports, or intentional versus unintentional draws. Preserve unknown values. In particular, a plain `TIE` is not proof of an intentional draw. BoundRift's extra label does not change Riot's observed contract.

## Compatibility and operations

- New listings and live results come directly from Riot. Historical numeric UVS references retain their old provider. A Riot failure does not trigger UVS or third-party fallback.
- Event IDs remain exact text with a provider prefix. Watch player identities are UUIDs. Legacy numeric identities remain readable.
- Round references include the event, stage, section, and round. Callback round references resolve against the current event bundle.
- SQLite migrations preserve existing watches and add a separate store preference for `/mytable`.
- Existing `NEXUS_WATCHER_ENABLED` and `NEXUS_WATCHER_INTERVAL_MS` configuration names remain supported.
- Riot's public organizer response does not consistently expose a timezone. The bot estimates an IANA zone locally from Riot's store coordinates using [tz-lookup](https://github.com/photostructure/tz-lookup). This does not call an external events service. Geographic boundaries are approximate. `/mytable store <official-event-url> Europe/Madrid` overrides the estimate explicitly.
- A list response can omit the end time. The bot retains these events within its bounded lookback instead of inventing an end time.

## Acceptance checks

Run the build and full test suite. Exercise exact event IDs, UUID selection, callbacks under 64 bytes, legacy database upgrades, restart persistence, round transitions, final results before watch completion, missing events, and failed GraphQL queries. Read-only live checks must use Riot directly without a player session.

After deployment, test `/events`, an official event URL, roster selection, `/watching`, standings, round navigation, store setup, and `/mytable` in Telegram. A recorded live response or a simulated notification does not replace that user test.

## Follow-up work

- Validate 2v2 after a dedicated team flow is implemented.
- Expand fixtures for complex multi-phase tournaments.
- Establish explicit cancellation and report-conflict signals if Riot exposes them publicly.
- Establish draw subtype without inferring intentionality from `TIE`.
- Monitor persisted-query changes and update schemas when Riot changes the response contract.

Read-only live checks on 17 October 2026 passed against Riot directly, without login:

- A search around Seville returned 31 events for 16–24 October with exact provider-aware text IDs.
- Event `117095965990633192` returned 22 players, five rounds, eight current pairings (including a bye), and 22 standings. Its settled results were read despite match status `IN_PROGRESS`.
- Store/day/player lookup for that event on 16 October resolved round five, a table, opponent, loss, and record 3–2–0. The output used `Europe/Madrid`. No player names are recorded here.
- An integration test selects a Riot player through a callback, persists the watch, closes and reopens SQLite, polls a pairing, and delivers the final result before completion. Notification delivery is simulated in that test.

A read-only stale-hash check also passed against Riot: an intentionally invalid search hash triggered discovery from official website bundles, then returned 13 events. The check used 40 official requests, including 37 chunks. Concurrent recovery for the same operation is coalesced, and recognized manifest IDs are reused across operations.

Final validation: `npm run build` passed. `npx vitest run` passed with 41 files and 405 tests. The runtime SQLite database was backed up before deployment. The deployment script prints the exact deployed SHA for the Telegram acceptance check. The branch remains separate from main until the user confirms that check.

Remaining limitations include explicit cancellation, report conflicts, draw subtype, 2v2 tracking, and broader multi-phase acceptance fixtures. Round callbacks preserve phase identity, although their current labels show only the round number. Physical-store coordinates are required for the detail and store lookup path.
