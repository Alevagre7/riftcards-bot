// RiftcodexAdapter is the env-flagged fallback for the bot, kept
// behind CARD_SOURCE=riftcodex. The new primary adapter is
// RiftapiAdapter (../riftapi.adapter.ts), which talks to the
// self-hosted riftapi. This adapter still talks to the third-party
// Riftcodex public API, but the interface and Card shape are kept
// in sync with the new primary adapter: composite ids, no
// flavorText, no tcgplayerId, no cache, no proxy.

import { z } from 'zod';
import { ICardRepository, SearchCardsOptions, SearchCardsResult } from '../../core/ports/card-repository.js';
import { Card } from '../../core/entities/card.js';
import { Set } from '../../core/entities/set.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';

const RiftcodexAttributesSchema = z.object({
  energy: z.number().optional().nullable(),
  might: z.number().optional().nullable(),
  power: z.number().optional().nullable(),
});

const RiftcodexClassificationSchema = z.object({
  type: z.string(),
  supertype: z.string().optional().nullable(),
  rarity: z.string(),
  domain: z.array(z.string()).optional().default([]),
});

const RiftcodexTextSchema = z.object({
  rich: z.string().optional().default(''),
  plain: z.string().optional().default(''),
  flavour: z.string().optional().nullable(),
});

const RiftcodexSetInfoSchema = z.object({
  set_id: z.string(),
  label: z.string(),
});

const RiftcodexMediaSchema = z.object({
  image_url: z.string().optional().nullable(),
  artist: z.string().optional().nullable(),
  accessibility_text: z.string().optional().nullable(),
});

const RiftcodexMetadataSchema = z.object({
  clean_name: z.string(),
  updated_on: z.string().optional().nullable(),
  alternate_art: z.boolean().optional(),
  overnumbered: z.boolean().optional(),
  signature: z.boolean().optional(),
});

const RiftcodexCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  riftbound_id: z.string().optional().nullable(),
  tcgplayer_id: z.string().optional().nullable(),
  collector_number: z.union([z.number(), z.string()]),
  attributes: RiftcodexAttributesSchema.optional().nullable(),
  classification: RiftcodexClassificationSchema.optional().nullable(),
  text: RiftcodexTextSchema.optional().nullable(),
  set: RiftcodexSetInfoSchema.optional().nullable(),
  media: RiftcodexMediaSchema.optional().nullable(),
  tags: z.array(z.string()).optional().nullable(),
  orientation: z.string().optional().nullable(),
  metadata: RiftcodexMetadataSchema.optional().nullable(),
});

const RiftcodexSearchResponseSchema = z.object({
  items: z.array(RiftcodexCardSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
});

const RiftcodexSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  set_id: z.string(),
  card_count: z.number().int().nonnegative().optional().nullable(),
  tcgplayer_id: z.string().optional().nullable(),
  cardmarket_id: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  published_on: z.string().optional().nullable(),
});

const RiftcodexSetsResponseSchema = z.object({
  items: z.array(RiftcodexSetSchema),
});

type RiftcodexCard = z.infer<typeof RiftcodexCardSchema>;
type RiftcodexSet = z.infer<typeof RiftcodexSetSchema>;

interface RiftcodexAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
}

export class RiftcodexAdapter implements ICardRepository {
  constructor(private options: RiftcodexAdapterOptions) {}

  private buildUrl(path: string, queryParams?: URLSearchParams): string {
    const url = new URL(path, this.options.baseUrl);
    if (queryParams) url.search = queryParams.toString();
    return url.toString();
  }

  async searchCards(options: SearchCardsOptions): Promise<SearchCardsResult> {
    const params = new URLSearchParams();
    params.set('fuzzy', options.query);
    if (options.setId) params.set('set_id', options.setId);
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('size', String(options.limit));
    if (options.sort) params.set('sort', options.sort);
    if (options.dir) params.set('dir', options.dir);

    const data = await this.fetchJson(this.buildUrl('/cards/name', params));
    if (!data) {
      return { cards: [], total: 0, page: options.page ?? 1, hasMore: false };
    }

    const parsed = RiftcodexSearchResponseSchema.parse(data);

    return {
      cards: parsed.items.map((c) => this.mapToDomain(c)),
      total: parsed.total,
      page: parsed.page,
      hasMore: parsed.page < parsed.pages,
    };
  }

  async getCardById(id: string): Promise<Card | null> {
    // Composite id parsing — same convention as RiftapiAdapter. If
    // the input is a bare riftbound id (no slash), the whole string
    // is used.
    const slash = id.indexOf('/');
    const riftboundId = slash < 0 ? id : id.slice(0, slash);
    return this.getCardByRiftboundId(riftboundId);
  }

  async getCardByRiftboundId(riftboundId: string): Promise<Card | null> {
    const cleanId = riftboundId.toLowerCase().trim();
    const data = await this.fetchJson(
      this.buildUrl(`/cards/riftbound/${encodeURIComponent(cleanId)}`),
    );
    if (!data) return null;

    const parsed = z.array(RiftcodexCardSchema).safeParse(data);
    if (!parsed.success || !parsed.data?.[0]) return null;
    return this.mapToDomain(parsed.data[0]);
  }

  async getCardByName(name: string): Promise<Card | null> {
    const params = new URLSearchParams();
    params.set('fuzzy', name);
    params.set('size', '1');

    const data = await this.fetchJson(this.buildUrl('/cards/name', params));
    if (!data) return null;

    const parsed = RiftcodexSearchResponseSchema.parse(data);
    if (parsed.items.length === 0) return null;

    const first = parsed.items[0];
    if (!first) return null;
    return this.mapToDomain(first);
  }

  async getCardByTcgPlayerId(productId: string): Promise<Card | null> {
    const data = await this.fetchJson(
      this.buildUrl(`/cards/tcgplayer/${encodeURIComponent(productId)}`),
    );
    if (!data) return null;

    const parsed = RiftcodexCardSchema.parse(data);
    return this.mapToDomain(parsed);
  }

  async getSets(): Promise<Set[]> {
    const params = new URLSearchParams();
    params.set('size', '100');

    const data = await this.fetchJson(this.buildUrl('/sets', params));
    if (!data) return [];

    const parsed = RiftcodexSetsResponseSchema.parse(data);
    return parsed.items.map((s) => this.mapSetToDomain(s));
  }

  async getCardsBySet(
    setCode: string,
    page?: number,
    limit?: number,
  ): Promise<SearchCardsResult> {
    const p = page ?? 1;
    const l = limit ?? 50;
    const params = new URLSearchParams();
    params.set('set_id', setCode);
    params.set('page', String(p));
    params.set('size', String(l));

    const data = await this.fetchJson(this.buildUrl('/cards', params));
    if (!data) {
      return { cards: [], total: 0, page: p, hasMore: false };
    }

    const parsed = RiftcodexSearchResponseSchema.parse(data);

    return {
      cards: parsed.items.map((c) => this.mapToDomain(c)),
      total: parsed.total,
      page: parsed.page,
      hasMore: parsed.page < parsed.pages,
    };
  }

  async getRandomCard(): Promise<Card | null> {
    // The third-party Riftcodex API does not have a /cards/random
    // endpoint. Fall back to picking from the names index.
    const indexData = await this.fetchJson(this.buildUrl('/index/card-names'));
    if (indexData) {
      const parsed = z.object({
        values: z.array(z.union([z.string(), z.number()])),
      }).safeParse(indexData);
      if (parsed.success && parsed.data.values.length > 0) {
        const idx = Math.floor(Math.random() * parsed.data.values.length);
        const name = String(parsed.data.values[idx]);
        if (name) return this.getCardByName(name);
      }
    }
    return null;
  }

  private async fetchJson(url: string): Promise<unknown> {
    try {
      const response = await fetchWithRetry(url, {
        timeout: this.options.timeoutMs,
        retries: this.options.retryAttempts,
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        return null;
      }

      if (response.status >= 500) {
        throw new ApiResponseError('Riftcodex', response.status);
      }

      if (!response.ok) {
        throw new ApiResponseError('Riftcodex', response.status);
      }

      return response.json();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ApiTimeoutError('Riftcodex');
    }
  }

  private mapToDomain(api: RiftcodexCard): Card {
    const collectorNumber = typeof api.collector_number === 'number'
      ? String(api.collector_number)
      : api.collector_number;
    // Composite id: riftboundId/collectorNumber. Same convention as
    // RiftapiAdapter and the bot's Card entity (see ADR-0001).
    const riftboundId = (api.riftbound_id ?? '').toLowerCase();
    const id = riftboundId ? `${riftboundId}/${collectorNumber}` : api.id;

    const result: Card = {
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

  private mapSetToDomain(api: RiftcodexSet): Set {
    return {
      id: api.id,
      code: api.set_id,
      name: api.name,
      ...(api.published_on != null ? { releaseDate: api.published_on } : {}),
      ...(api.card_count != null ? { cardCount: api.card_count } : {}),
    };
  }
}
