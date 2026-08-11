# 8. Pin Riot card media to PNG at Telegram emission boundaries

Date: 2026-08-11

## Status

Accepted

## Context

VEN-137 (Shady Spectacles) and UNL-067 (Ruined Rex) rendered as only a
top strip on Telegram iOS when the bot used the original Riot/Sanity PNG
URL. The same source bytes were valid 744x1039 RGBA PNGs. A URL with the
same source and a fresh `fm=png` query parameter rendered fully, and the
`fm=png` response was byte-identical to the original. A JPEG transform also
rendered fully. This identifies the production failure as a stale or poisoned
Telegram media rendition keyed by the original URL, not PNG encoding damage.

The product decision is to preserve the lossless PNG quality and transparency
for every card-photo interaction path. The bot therefore pins eligible Riot
asset URLs to `fm=png` at the Telegram presentation boundary. `Card.imageUrl`
and adapter data remain the original upstream values.

## Decision

The bot transforms only HTTPS URLs hosted at `cmsassets.rgpub.io` whose path
starts with `/sanity/images/`. It uses the URL API to set `fm=png`, preserving
unrelated query parameters and fragments and replacing duplicate `fm` values.
The resulting URL is deterministic and idempotent. No per-message cache
buster or additional version marker is used: the supported Sanity `fm=png`
parameter already creates the fresh URL identity needed by Telegram and is a
non-mutating image transformation.

The transformed URL is used by `/card`, `/random`, card callbacks, inline
`photo_url` and `thumbnail_url`, and `/new`/“Show all” media groups. Unknown,
malformed, non-HTTPS, non-Sanity, credentialed, or non-default-port URLs are
left unchanged.

## Compatibility risk and rollback

Telegram's Bot API documents `InlineQueryResultPhoto.photo_url` as JPEG-only
and limited to 5 MB. Current production behavior and the controlled probe
accept PNG, so this decision deliberately relies on observed compatibility
while retaining PNG consistency. Eligible assets are smoke-tested as PNG and
kept below 5 MB.

Before deployment, a CDN smoke failure (non-200, non-PNG response, changed
bytes, wrong dimensions, or size over the limit) blocks release. After
deployment, any Telegram rejection of inline PNG results, a new rendering
failure for VEN-137 or UNL-067 on iOS or Android, or a transparency/quality
regression triggers rollback to the previous known-good deployment. There is
no silent JPEG fallback; changing formats requires an explicit reviewed
decision. Existing messages using the original URL are not rewritten.

## Consequences

- All eligible delivery paths share one lossless, stable PNG URL policy.
- Sanity source assets and domain entities remain untouched.
- Black/transparent-corner behavior is preserved because no JPEG background
  flattening occurs.
- Inline rendering depends on Telegram continuing its observed PNG behavior
  despite the documented JPEG-only contract.
