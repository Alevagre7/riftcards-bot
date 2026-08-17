# 8. Normalize Riot card media to JPEG at Telegram emission boundaries

Date: 2026-08-17

## Status

Accepted

## Context

Earlier observations for VEN-137 (Shady Spectacles) and UNL-067 (Ruined
Rex) found that Telegram iOS rendered only a top strip when the bot sent
the original Riot/Sanity PNG URL. The same source bytes were valid
744x1039 RGBA PNGs. A fresh `fm=png` URL rendered fully, and a JPEG
transform also rendered fully. Those observations remain useful evidence
about stale or poisoned Telegram media renditions keyed by the original
URL; they do not establish a general PNG encoding failure.

The cropped VEN-174 (Irelia, Fervent) screenshot was captured before the
2026-08-17 PNG-normalization deployment. It therefore does not prove that
the deployed PNG workaround failed for VEN-174. Independently of that
result, Telegram's inline-photo contract requires JPEG, so the bot
standardizes eligible card media on a deterministic JPEG transform.

`Card.imageUrl` remains the untouched upstream source URL. Transformation
is a Telegram presentation concern only.

## Decision

For an eligible URL, the bot uses the URL API to set `fm=jpg` and then
`q=90`. Eligibility is limited to credential-free HTTPS URLs on the
default port whose host is `cmsassets.rgpub.io` and whose path starts with
`/sanity/images/`. Malformed, non-HTTPS, non-Sanity, credentialed, and
non-default-port URLs are returned byte-for-byte unchanged.

The URL API preserves unrelated query parameters and fragments. Setting
the two parameters collapses duplicate `fm` and `q` values, overrides
values such as `auto=format`, and produces a deterministic, idempotent
URL. The bot does not fetch, decode, proxy, resize, upload, or otherwise
process image bytes.

The transformed URL is used at every Telegram card-media emission
boundary: inline `photo_url` and `thumbnail_url`, `sendCardPreview` for
`/card`, `/random`, and card callbacks, and `/new`/“Show all” media
groups. The inline thumbnail reuses the same full transformed URL; no
dimensions are invented because `Card` carries no image metadata.

## Compatibility risk and rollback

Telegram's Bot API documents `InlineQueryResultPhoto.photo_url` as
JPEG-only and limits inline photos to 5 MB. The selected Sanity transform
returns a 744x1039 JPEG for VEN-174 at 222,066 bytes, well below that
limit. The source rendition is a 1,239,389-byte RGBA PNG, so the JPEG
policy recompresses pixels and flattens its small transparent corners.

The pre-deployment CDN probe must return HTTP 200, `content-type:
image/jpeg`, and a positive content length below 5 MB. A failed probe
blocks deployment; do not lower quality or add a proxy implicitly. After
deployment, a client crop, rejection, or visible JPEG corruption leaves
the feature branch deployed for diagnosis with the affected client
version and screenshot; any rollback or format change requires an
explicit reviewed decision. Existing messages using original URLs are
not rewritten.

## Consequences

- All eligible Telegram card media shares one standards-compliant JPEG
  quality-90 URL policy.
- Telegram inline results and direct/album previews use the same
  deterministic transform.
- Sanity source assets, `Card.imageUrl`, and domain entities remain
  untouched.
- Unknown or unsupported URL hosts retain their original media URLs.
- VEN-174 uses substantially fewer bytes, at the cost of JPEG
  recompression and flattened transparent corners.
