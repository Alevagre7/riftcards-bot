import { describe, expect, it } from 'vitest';
import { mapRiftapiCardToCard, RiftapiCard } from './riftapi-mapper.js';

// A representative riftapi card wire object, as returned by
// /cards/{id} and /cards/random. The fields cover all branches of
// the mapper: classification, attributes, text, set, media, tags.
const sampleWire: RiftapiCard = {
  id: 'ogn-011',
  name: 'Magma Wurm',
  riftbound_id: 'ogn-011',
  tcgplayer_id: null,
  collector_number: 11,
  attributes: { energy: 8, might: 8, power: 1 },
  classification: {
    type: 'Unit',
    supertype: null,
    rarity: 'Common',
    domain: ['Fury'],
  },
  text: {
    rich: '<p>Other friendly units enter ready.</p>',
    plain: 'Other friendly units enter ready.',
    flavour: null,
  },
  set: { set_id: 'OGN', label: 'Origins' },
  media: {
    image_url: 'https://example.test/magma-wurm.png',
    artist: 'Envar Studio',
    accessibility_text: 'Riftbound Unit: Magma Wurm.',
  },
  tags: ['Freljord'],
  orientation: 'portrait',
  metadata: {
    clean_name: 'magma wurm',
    updated_on: null,
    alternate_art: false,
    overnumbered: false,
    signature: false,
  },
};

describe('mapRiftapiCardToCard', () => {
  it('produces a composite id of riftboundId/collectorNumber', () => {
    const card = mapRiftapiCardToCard(sampleWire);
    expect(card.id).toBe('ogn-011/11');
  });

  it('copies the required fields', () => {
    const card = mapRiftapiCardToCard(sampleWire);
    expect(card.name).toBe('Magma Wurm');
    expect(card.setCode).toBe('ogn');
    expect(card.collectorNumber).toBe('11');
    expect(card.rarity).toBe('Common');
    expect(card.type).toBe('Unit');
  });

  it('lowercases the set code', () => {
    const card = mapRiftapiCardToCard({ ...sampleWire, set: { set_id: 'UNL', label: 'Unleashed' } });
    expect(card.setCode).toBe('unl');
  });

  it('joins multiple domains with comma+space', () => {
    const card = mapRiftapiCardToCard({
      ...sampleWire,
      classification: { ...sampleWire.classification!, domain: ['Fury', 'Mind'] },
    });
    expect(card.domain).toBe('Fury, Mind');
  });

  it('omits the domain field when the upstream array is empty', () => {
    const card = mapRiftapiCardToCard({
      ...sampleWire,
      classification: { ...sampleWire.classification!, domain: [] },
    });
    expect((card as { domain?: string }).domain).toBeUndefined();
  });

  it('keeps attributes only when present and non-null', () => {
    const full = mapRiftapiCardToCard(sampleWire);
    expect(full.energy).toBe(8);
    expect(full.might).toBe(8);
    expect(full.power).toBe(1);

    const none = mapRiftapiCardToCard({ ...sampleWire, attributes: null });
    expect((none as { energy?: number }).energy).toBeUndefined();
    expect((none as { might?: number }).might).toBeUndefined();
    expect((none as { power?: number }).power).toBeUndefined();
  });

  it('strips text.flavour (dropped from the domain)', () => {
    const card = mapRiftapiCardToCard({
      ...sampleWire,
      text: { ...sampleWire.text!, flavour: 'should not appear' },
    });
    expect((card as { flavorText?: string }).flavorText).toBeUndefined();
    expect(card.text).toBe('Other friendly units enter ready.');
  });

  it('drops tcgplayer_id (not in the domain)', () => {
    const card = mapRiftapiCardToCard({ ...sampleWire, tcgplayer_id: '12345' });
    expect((card as { tcgplayerId?: string }).tcgplayerId).toBeUndefined();
  });

  it('maps tags to keywords', () => {
    const card = mapRiftapiCardToCard({
      ...sampleWire,
      tags: ['Freljord', 'Noxus'],
    });
    expect(card.keywords).toEqual(['Freljord', 'Noxus']);
  });

  it('defaults keywords to [] when tags is null or missing', () => {
    expect(mapRiftapiCardToCard({ ...sampleWire, tags: null }).keywords).toEqual([]);
    const { tags: _t, ...without } = sampleWire;
    expect(mapRiftapiCardToCard(without).keywords).toEqual([]);
  });

  it('falls back to api.id when riftbound_id is missing', () => {
    const card = mapRiftapiCardToCard({ ...sampleWire, riftbound_id: null });
    expect(card.id).toBe('ogn-011/11');
    expect(card.riftboundId).toBe('ogn-011');
  });

  it('handles collector_number as a string (upstream sometimes serialises as string)', () => {
    const card = mapRiftapiCardToCard({ ...sampleWire, collector_number: '11' });
    expect(card.id).toBe('ogn-011/11');
    expect(card.collectorNumber).toBe('11');
  });
});
