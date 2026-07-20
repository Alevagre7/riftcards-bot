# 7. Events list view with inline buttons + in-place detail

Date: 2026-07-21

## Status

Accepted.

## Context

The /events command rendered the upstream event list as a single plain-text
message with no interaction. Users had no way to dig into a single event.
The Event entity carried only five fields, and the IEventRepository port
had a single method.

## Decision

The bot expands the Event entity with id, storeAddress, storeWebsite,
storeEmail, category, meetingType, capacity, isFree, costAmount,
costCurrency, and locatorUrl (a derived field). IEventRepository gains
getEventById and getEventRegistrations. Players live at a separate upstream
endpoint (/events/{id}/registrations) and are not stored on the Event.

The /events list view renders events as a text body with up to 8 inline
buttons; >8 events adds a "Show all" button that re-renders the full list
as multiple text messages. Tapping an event button edits the message in
place to a detail view; tapping "Back to list" re-renders the list. The
detail view fetches the event and its registrations in parallel; a failed
registrations call falls back to "Players: unavailable" without failing the
whole detail view.

## Considered

- **t.me deep links per row** (open private chat with the bot) — would fit
  >8 events in one message and sets up a future "subscribe to this event"
  flow nicely, but breaks in-place detail UX in the group chat. Deferred to
  a future ADR when a subscription feature is in scope.
- **Single-endpoint design (no detail endpoint)** — the upstream exposes
  GET /events/{id}, so the detail view calls it directly instead of
  refetching the list. Cheaper, decoupled, and survives upstream pagination
  changes.
- **Re-fetch on Back to list** vs **cache the last list** — re-fetch chosen.
  The HTTP call is cheap and re-fetching keeps the data honest.

## Deferred

- Per-user event subscription, push notifications on round updates,
  leaderboards, and any "private chat with the bot about this event" flow.
  The event: callback prefix is intentionally namespaced (event:<id>,
  event:list, event:list:show-all) to leave room for event:watch:<id> etc.
  without a contract change.
- Per-user default timeframe (a /events window <N> set-and-forget). The
  /events <N> per-call arg is enough for v1.
