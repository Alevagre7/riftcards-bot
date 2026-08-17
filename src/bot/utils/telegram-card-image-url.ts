const RIOT_SANITY_HOST = 'cmsassets.rgpub.io';
const SANITY_IMAGES_PATH = '/sanity/images/';
const TELEGRAM_MEDIA_REVISION = 'jpeg-v2';

/**
 * Returns the URL used when Telegram receives a card photo.
 *
 * Card.imageUrl intentionally remains the original upstream URL. This helper
 * is a Telegram presentation concern: Sanity-hosted media is pinned to JPEG
 * quality 90 because InlineQueryResultPhoto.photo_url requires JPEG.
 */
export function toTelegramCardImageUrl(imageUrl: string): string {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return imageUrl;
  }

  const hasNonDefaultPort = url.port !== '' && url.port !== '443';
  if (
    url.protocol !== 'https:' ||
    url.hostname !== RIOT_SANITY_HOST ||
    !url.pathname.startsWith(SANITY_IMAGES_PATH) ||
    url.username !== '' ||
    url.password !== '' ||
    hasNonDefaultPort
  ) {
    return imageUrl;
  }

  url.searchParams.set('fm', 'jpg');
  url.searchParams.set('q', '90');
  url.searchParams.set('tg_media', TELEGRAM_MEDIA_REVISION);
  return url.toString();
}
