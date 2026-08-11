const RIOT_SANITY_HOST = 'cmsassets.rgpub.io';
const SANITY_IMAGES_PATH = '/sanity/images/';

/**
 * Returns the stable Riot/Sanity URL used when Telegram receives a card photo.
 *
 * Card.imageUrl intentionally remains the original upstream URL. This helper
 * is a Telegram presentation concern and only rewrites the known Riot asset
 * CDN URLs to pin their response format to PNG.
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

  url.searchParams.set('fm', 'png');
  return url.toString();
}
