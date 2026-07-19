// RiftapiCard → Card mapper.
//
// The riftapi wire format is nested:
//
//   { id, name, riftbound_id, collector_number,
//     classification: { type, supertype, rarity, domain[] },
//     attributes:     { energy, might, power },
//     text:           { rich, plain, flavour },
//     set:            { set_id, label },
//     media:          { image_url, artist, accessibility_text },
//     tags:           string[],
//     metadata:       { clean_name, alternate_art, ... },
//     ... }
//
// The bot's Card entity is flat (see ../core/entities/card.ts):
//
//   { id, name, setCode, setName, collectorNumber, rarity, type,
//     supertype, domain, energy, might, power, text, keywords,
//     artist, imageUrl, riftboundId, ... }
//
// This module owns the translation. The mapper is pure: it takes
// a wire object and returns a Card. It does not throw; missing
// fields are simply absent from the result. The RiftapiCard type
// matches the actual upstream JSON; no zod validation happens
// here (the adapter validates the search-response envelope, then
// delegates per-item conversion to this module).

export interface RiftapiCard {
  id?: string;
  name: string;
  riftbound_id?: string | null;
  tcgplayer_id?: string | null;
  collector_number: number | string;
  attributes?: {
    energy?: number | null;
    might?: number | null;
    power?: number | null;
  } | null;
  classification?: {
    type?: string;
    supertype?: string | null;
    rarity?: string;
    domain?: string[];
  } | null;
  text?: {
    rich?: string;
    plain?: string;
    flavour?: string | null;
  } | null;
  set?: {
    set_id?: string;
    label?: string;
  } | null;
  media?: {
    image_url?: string | null;
    artist?: string | null;
    accessibility_text?: string | null;
  } | null;
  tags?: string[] | null;
  orientation?: string;
  metadata?: {
    clean_name?: string;
    updated_on?: string | null;
    alternate_art?: boolean;
    overnumbered?: boolean;
    signature?: boolean;
  } | null;
}

export function mapRiftapiCardToCard(api: RiftapiCard): import('../../core/entities/card.js').Card {
  const collectorNumber = String(api.collector_number);
  // The composite id is riftbound_id (if present) joined with the
  // collector number. Riftapi's id field is the riftbound_id, so
  // when riftbound_id is present we use it; when it isn't, we fall
  // back to api.id (which should be the same value).
  const riftboundId = (api.riftbound_id ?? api.id ?? '').toLowerCase();
  const id = riftboundId ? `${riftboundId}/${collectorNumber}` : collectorNumber;

  const result: import('../../core/entities/card.js').Card = {
    id,
    name: api.name,
    setCode: (api.set?.set_id ?? '').toLowerCase(),
    collectorNumber,
    rarity: api.classification?.rarity ?? '',
    type: api.classification?.type ?? '',
    keywords: api.tags ?? [],
  };

  if (api.set?.label != null) {
    (result as { setName?: string }).setName = api.set.label;
  }
  if (api.classification?.supertype != null) {
    (result as { supertype?: string }).supertype = api.classification.supertype;
  }
  if (api.classification?.domain != null && api.classification.domain.length > 0) {
    (result as { domain?: string }).domain = api.classification.domain.join(', ');
  }
  if (api.attributes?.energy != null) {
    (result as { energy?: number }).energy = api.attributes.energy;
  }
  if (api.attributes?.might != null) {
    (result as { might?: number }).might = api.attributes.might;
  }
  if (api.attributes?.power != null) {
    (result as { power?: number }).power = api.attributes.power;
  }
  if (api.text?.plain) {
    (result as { text?: string }).text = api.text.plain;
  }
  if (api.media?.artist != null) {
    (result as { artist?: string }).artist = api.media.artist;
  }
  if (api.media?.image_url != null) {
    (result as { imageUrl?: string }).imageUrl = api.media.image_url;
  }
  if (riftboundId) {
    (result as { riftboundId?: string }).riftboundId = riftboundId;
  }

  return result;
}
