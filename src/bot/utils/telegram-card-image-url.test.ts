import { describe, expect, it } from 'vitest';
import { toTelegramCardImageUrl } from './telegram-card-image-url.js';

const VEN_137_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e49461109a4116c22af9206719f53fb73aee36d0-744x1039.png?accountingTag=RB';
const UNL_067_URL =
  'https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/05fc9613bd3a3c3c5002ff1d7d665b37fd18dcb7-744x1039.png?accountingTag=RB';

describe('toTelegramCardImageUrl', () => {
  it('pins the VEN-137 source to PNG while preserving the source query', () => {
    expect(toTelegramCardImageUrl(VEN_137_URL)).toBe(`${VEN_137_URL}&fm=png`);
  });

  it('pins the UNL-067 source to PNG', () => {
    expect(toTelegramCardImageUrl(UNL_067_URL)).toBe(`${UNL_067_URL}&fm=png`);
  });

  it('preserves unrelated parameters and fragments', () => {
    const source = `${VEN_137_URL}&auto=format&w=744#card-image`;

    expect(toTelegramCardImageUrl(source)).toBe(
      `${VEN_137_URL}&auto=format&w=744&fm=png#card-image`,
    );
  });

  it('replaces duplicate fm parameters without disturbing other parameters', () => {
    const source =
      'https://cmsassets.rgpub.io/sanity/images/project/dataset/asset.png?fm=jpg&accountingTag=RB&fm=webp';
    const transformed = new URL(toTelegramCardImageUrl(source));

    expect(transformed.searchParams.getAll('fm')).toEqual(['png']);
    expect(transformed.searchParams.get('accountingTag')).toBe('RB');
  });

  it('is idempotent', () => {
    const transformed = toTelegramCardImageUrl(VEN_137_URL);

    expect(toTelegramCardImageUrl(transformed)).toBe(transformed);
  });

  it.each([
    '',
    'not-a-url',
    '/sanity/images/project/dataset/asset.png',
    'http://cmsassets.rgpub.io/sanity/images/project/dataset/asset.png',
    'https://example.test/sanity/images/project/dataset/asset.png',
    'https://cdn.sanity.io/images/project/dataset/asset.png',
    'https://cmsassets.rgpub.io/not-sanity/images/project/dataset/asset.png',
    'https://user:secret@cmsassets.rgpub.io/sanity/images/project/dataset/asset.png',
    'https://cmsassets.rgpub.io:8443/sanity/images/project/dataset/asset.png',
  ])('leaves an ineligible URL unchanged: %s', (source) => {
    expect(toTelegramCardImageUrl(source)).toBe(source);
  });
});
