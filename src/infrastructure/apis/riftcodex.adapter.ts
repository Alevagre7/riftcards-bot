import { z } from 'zod';
import { ICardRepository, SearchCardsOptions, SearchCardsResult } from '../../core/ports/card-repository.js';
import { Card } from '../../core/entities/card.js';
import { Set } from '../../core/entities/set.js';
import { ICacheService } from '../../core/ports/cache-service.js';
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

const RiftcodexIndexSchema = z.object({
  total: z.number().int().nonnegative(),
  type: z.string(),
  values: z.array(z.union([z.string(), z.number()])),
});

type RiftcodexCard = z.infer<typeof RiftcodexCardSchema>;
type RiftcodexSet = z.infer<typeof RiftcodexSetSchema>;

interface RiftcodexAdapterOptions {
  baseUrl: string;
  proxyBaseUrl?: string;
  cache: ICacheService;
  timeoutMs: number;
  retryAttempts: number;
  cacheTtlSeconds: {
    card: number;
    search: number;
    set: number;
  };
}

export class RiftcodexAdapter implements ICardRepository {
  constructor(private options: RiftcodexAdapterOptions) {}

  private buildUrl(path: string, queryParams?: URLSearchParams): string {
    const url = new URL(path, this.options.baseUrl);
    if (queryParams) url.search = queryParams.toString();

    if (this.options.proxyBaseUrl) {
      return `${this.options.proxyBaseUrl}?url=${encodeURIComponent(url.toString())}`;
    }
    return url.toString();
  }

  async searchCards(options: SearchCardsOptions): Promise<SearchCardsResult> {
    const cacheKey = this.searchCacheKey(options);
    const cached = await this.options.cache.get<SearchCardsResult>(cacheKey);
    if (cached) return cached;

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

    const result: SearchCardsResult = {
      cards: parsed.items.map((c) => this.mapToDomain(c)),
      total: parsed.total,
      page: parsed.page,
      hasMore: parsed.page < parsed.pages,
    };

    await this.options.cache.set(cacheKey, result, this.options.cacheTtlSeconds.search);
    return result;
  }

  async getCardById(id: string): Promise<Card | null> {
    const cacheKey = `card:${id}`;
    const cached = await this.options.cache.get<Card>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchJson(
      this.buildUrl(`/cards/${encodeURIComponent(id)}`),
    );
    if (!data) return null;

    const parsed = RiftcodexCardSchema.parse(data);
    const card = this.mapToDomain(parsed);

    await this.options.cache.set(cacheKey, card, this.options.cacheTtlSeconds.card);
    return card;
  }

  async getCardByRiftboundId(riftboundId: string): Promise<Card | null> {
    const cleanId = riftboundId.toLowerCase().trim();
    const cacheKey = `card:riftbound:${cleanId}`;
    const cached = await this.options.cache.get<Card>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchJson(
      this.buildUrl(`/cards/riftbound/${encodeURIComponent(cleanId)}`),
    );
    if (!data) return null;

    const parsed = z.array(RiftcodexCardSchema).safeParse(data);
    if (!parsed.success || !parsed.data?.[0]) return null;

    const card = this.mapToDomain(parsed.data[0]);

    await this.options.cache.set(cacheKey, card, this.options.cacheTtlSeconds.card);
    return card;
  }

  async getCardByName(name: string): Promise<Card | null> {
    const cleanName = name.toLowerCase().trim();
    const cacheKey = `card:name:${encodeURIComponent(cleanName)}`;
    const cached = await this.options.cache.get<Card>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('fuzzy', name);
    params.set('size', '1');

    const data = await this.fetchJson(this.buildUrl('/cards/name', params));
    if (!data) return null;

    const parsed = RiftcodexSearchResponseSchema.parse(data);
    if (parsed.items.length === 0) return null;

    const first = parsed.items[0];
    if (!first) return null;
    const card = this.mapToDomain(first);

    await this.options.cache.set(cacheKey, card, this.options.cacheTtlSeconds.card);
    return card;
  }

  async getCardByTcgPlayerId(productId: string): Promise<Card | null> {
    const cacheKey = `card:tcgplayer:${productId}`;
    const cached = await this.options.cache.get<Card>(cacheKey);
    if (cached) return cached;

    const data = await this.fetchJson(
      this.buildUrl(`/cards/tcgplayer/${encodeURIComponent(productId)}`),
    );
    if (!data) return null;

    const parsed = RiftcodexCardSchema.parse(data);
    const card = this.mapToDomain(parsed);

    await this.options.cache.set(cacheKey, card, this.options.cacheTtlSeconds.card);
    return card;
  }

  async getSets(): Promise<Set[]> {
    const cacheKey = 'set:list';
    const cached = await this.options.cache.get<Set[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('size', '100');

    const data = await this.fetchJson(this.buildUrl('/sets', params));
    if (!data) return [];

    const parsed = RiftcodexSetsResponseSchema.parse(data);

    const sets: Set[] = parsed.items.map((s) => this.mapSetToDomain(s));

    await this.options.cache.set(cacheKey, sets, this.options.cacheTtlSeconds.set);
    return sets;
  }

  async getCardsBySet(
    setCode: string,
    page?: number,
    limit?: number,
  ): Promise<SearchCardsResult> {
    const p = page ?? 1;
    const l = limit ?? 50;
    const cacheKey = `set:${setCode}:cards:${p}`;
    const cached = await this.options.cache.get<SearchCardsResult>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('set_id', setCode);
    params.set('page', String(p));
    params.set('size', String(l));

    const data = await this.fetchJson(this.buildUrl('/cards', params));
    if (!data) {
      return { cards: [], total: 0, page: p, hasMore: false };
    }

    const parsed = RiftcodexSearchResponseSchema.parse(data);

    const result: SearchCardsResult = {
      cards: parsed.items.map((c) => this.mapToDomain(c)),
      total: parsed.total,
      page: parsed.page,
      hasMore: parsed.page < parsed.pages,
    };

    await this.options.cache.set(cacheKey, result, this.options.cacheTtlSeconds.search);
    return result;
  }

  async getRandomCard(): Promise<Card | null> {
    const cacheKey = 'random';
    const cached = await this.options.cache.get<Card>(cacheKey);
    if (cached) return cached;

    try {
      const indexData = await this.fetchJson(
        this.buildUrl('/index/card-names'),
      );
      if (indexData) {
        const parsed = RiftcodexIndexSchema.parse(indexData);
        if (parsed.values.length > 0) {
          const randomIdx = Math.floor(Math.random() * parsed.values.length);
          const randomName = String(parsed.values[randomIdx]);
          const card = await this.getCardByName(randomName);
          if (card) {
            await this.options.cache.set(cacheKey, card, 60);
            return card;
          }
        }
      }
    } catch {
      // Fall through to fallback
    }

    const result = await this.searchCards({
      query: '',
      limit: 50,
      page: Math.floor(Math.random() * 50) + 1,
      sort: 'name',
    });

    if (result.cards.length === 0) return null;
    const idx = Math.floor(Math.random() * result.cards.length);
    return result.cards[idx] ?? null;
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

    return {
      id: api.id,
      name: api.name,
      setCode: api.set?.set_id ?? '',
      collectorNumber,
      rarity: api.classification?.rarity ?? '',
      type: api.classification?.type ?? '',
      keywords: api.tags ?? [],
      ...(api.set?.label != null ? { setName: api.set.label } : {}),
      ...(api.classification?.supertype != null
        ? { supertype: api.classification.supertype }
        : {}),
      ...(api.classification?.domain != null && api.classification.domain.length > 0
        ? { domain: api.classification.domain.join(', ') }
        : {}),
      ...(api.attributes?.energy != null ? { energy: api.attributes.energy } : {}),
      ...(api.attributes?.might != null ? { might: api.attributes.might } : {}),
      ...(api.attributes?.power != null ? { power: api.attributes.power } : {}),
      ...(api.text?.plain ? { text: api.text.plain } : {}),
      ...(api.text?.flavour != null ? { flavorText: api.text.flavour } : {}),
      ...(api.media?.artist != null ? { artist: api.media.artist } : {}),
      ...(api.media?.image_url != null ? { imageUrl: api.media.image_url } : {}),
      ...(api.riftbound_id != null ? { riftboundId: api.riftbound_id } : {}),
      ...(api.tcgplayer_id != null ? { tcgplayerId: api.tcgplayer_id } : {}),
    };
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

  private searchCacheKey(options: SearchCardsOptions): string {
    const parts: string[] = [];
    parts.push(`q=${encodeURIComponent(options.query)}`);
    if (options.setId) parts.push(`set=${encodeURIComponent(options.setId)}`);
    if (options.page) parts.push(`p=${options.page}`);
    if (options.limit) parts.push(`l=${options.limit}`);
    if (options.sort) parts.push(`sort=${options.sort}`);
    if (options.dir) parts.push(`dir=${options.dir}`);
    return `search:${parts.join('&')}`;
  }
}
