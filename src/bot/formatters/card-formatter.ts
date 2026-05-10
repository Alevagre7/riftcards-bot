import { PriceData } from '../../core/entities/price.js';

export function formatPrice(price: PriceData): string {
  const hasPrices =
    price.lowestNearMintEuOnly !== null ||
    price.average30d !== null ||
    price.average7d !== null;

  if (!hasPrices) {
    return 'No prices available for this card.';
  }

  const parts: string[] = [];
  parts.push('<b>Prices</b>');

  if (price.lowestNearMintEuOnly !== null) {
    parts.push(`EU NM: \u20AC${price.lowestNearMintEuOnly.toFixed(2)}`);
  }

  if (price.average30d !== null) {
    parts.push(`30d avg: \u20AC${price.average30d.toFixed(2)}`);
  }

  if (price.average7d !== null) {
    parts.push(`7d avg: \u20AC${price.average7d.toFixed(2)}`);
  }

  if (price.cardmarketUrl) {
    parts.push('');
    parts.push(`<a href="${price.cardmarketUrl}">View on Cardmarket</a>`);
  }

  return parts.join('\n');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
