// RiftapiAdapter implements ICardRepository against the self-hosted
// riftapi. The wire shape is the local card-data format (nested
// classification / text / media / set / metadata / attributes);
// the translation to the bot's flat Card lives in riftapi-mapper.ts.
//
// The adapter is cache-free: the riftapi is on the same Docker
// network as the bot and a single round trip is sub-millisecond,
// so the ICacheService layer is removed. There is no proxy hop —
// the adapter talks to RIFTAPI_BASE_URL directly.

import { z } from 'zod';
import { ICardRepository, SearchCardsOptions, SearchCardsResult } from '../../core/ports/card-repository.js';
import { Card } from '../../core/entities/card.js';
import { Set } from '../../core/entities/set.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';
import { mapRiftapiCardToCard, RiftapiCard } from './riftapi-mapper.js';

const RiftapiSearchResponseSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});

const RiftapiSetsResponseSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  size: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});

const RiftapiSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  set_id: z.string(),
  card_count: z.number().int().nonnegative().optional().nullable(),
  tcgplayer_id: z.string().optional().nullable(),
  cardmarket_id: z.string().optional().nullable(),
  published_on: z.string().optional().nullable(),
});

interface RiftapiAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
}

export class RiftapiAdapter implements ICardRepository {
  constructor(private options: RiftapiAdapterOptions) {}

  // searchCards: GET /cards/search?query=...&set_id=...&page=...&size=...
  // Server-side ranking; the bot's /card command hits this endpoint
  // when the user types anything that doesn't match the riftbound-id
  // regex.
  async searchCards(options: SearchCardsOptions): Promise<SearchCardsResult> {
    const params = new URLSearchParams();
    params.set('query', options.query);
    if (options.setId) params.set('set_id', options.setId);
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('size', String(options.limit));
    if (options.sort) params.set('sort', options.sort);
    if (options.dir) params.set('dir', String(options.dir));

    const data = await this.fetchJson(this.buildUrl('/cards/search', params));
    if (!data) {
      return { cards: [], total: 0, page: options.page ?? 1, hasMore: false };
    }

    const parsed = RiftapiSearchResponseSchema.parse(data);
    const items = parsed.items as RiftapiCard[];
    return {
      cards: items.map((c) => mapRiftapiCardToCard(c)),
      total: parsed.total,
      page: parsed.page,
      hasMore: parsed.page < parsed.pages,
    };
  }

  // getCardById: parses the composite key (riftboundId/collectorNumber),
  // then calls GET /cards/{riftboundId}. Riftapi's primary key is the
  // riftboundId, so a single id resolves to a single print. If the
  // input is a bare riftbound id (no slash), the whole string is used.
  async getCardById(id: string): Promise<Card | null> {
    const slash = id.indexOf('/');
    const riftboundId = slash < 0 ? id : id.slice(0, slash);
    return this.getCardByRiftboundId(riftboundId);
  }

  // getCardByRiftboundId: GET /cards/riftbound/{id} (returns an
  // array). Returns the first match, or null.
  async getCardByRiftboundId(riftboundId: string): Promise<Card | null> {
    const cleanId = riftboundId.toLowerCase().trim();
    const data = await this.fetchJson(
      this.buildUrl(`/cards/riftbound/${encodeURIComponent(cleanId)}`),
    );
    if (!data) return null;

    const parsed = z.array(z.unknown()).safeParse(data);
    if (!parsed.success || !parsed.data?.[0]) return null;
    return mapRiftapiCardToCard(parsed.data[0] as RiftapiCard);
  }

  // getCardByName: GET /cards/name?exact={name}. Returns the
  // single matching card, or null. The ?fuzzy variant is also
  // available on riftapi; the bot uses exact for /card's
  // name-resolution flow and fuzzy via searchCards.
  async getCardByName(name: string): Promise<Card | null> {
    const params = new URLSearchParams();
    params.set('exact', name);
    const data = await this.fetchJson(this.buildUrl('/cards/name', params));
    if (!data) return null;

    const parsed = RiftapiSearchResponseSchema.parse(data);
    if (parsed.items.length === 0) return null;
    return mapRiftapiCardToCard(parsed.items[0] as RiftapiCard);
  }

  // getCardByTcgPlayerId: always returns null. The riftapi does
  // not carry tcgplayer_id (the upstream gallery doesn't expose it);
  // the /cards/tcgplayer/{id} endpoint always 404s. The interface
  // method stays so the bot's existing call sites compile.
  async getCardByTcgPlayerId(_productId: string): Promise<Card | null> {
    return null;
  }

  // getSets: GET /sets?size=100. Returns all sets; the local store
  // has at most a handful of sets, so a single page is enough.
  async getSets(): Promise<Set[]> {
    const params = new URLSearchParams();
    params.set('size', '100');
    const data = await this.fetchJson(this.buildUrl('/sets', params));
    if (!data) return [];

    const parsed = RiftapiSetsResponseSchema.parse(data);
    return (parsed.items as unknown[]).map((raw) => {
      const s = RiftapiSetSchema.parse(raw);
      return this.mapSetToDomain(s);
    });
  }

  // getCardsBySet: GET /cards?set_id={code}&page={page}&size={limit}.
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

    const parsed = RiftapiSearchResponseSchema.parse(data);
    const items = parsed.items as RiftapiCard[];
    return {
      cards: items.map((c) => mapRiftapiCardToCard(c)),
      total: parsed.total,
      page: parsed.page,
      hasMore: parsed.page < parsed.pages,
    };
  }

  // getRandomCard: GET /cards/random. One round trip. The store
  // uses ORDER BY RANDOM() LIMIT 1 server-side.
  async getRandomCard(): Promise<Card | null> {
    const data = await this.fetchJson(this.buildUrl('/cards/random'));
    if (!data) return null;
    return mapRiftapiCardToCard(data as RiftapiCard);
  }

  private buildUrl(path: string, queryParams?: URLSearchParams): string {
    const url = new URL(path, this.options.baseUrl);
    if (queryParams) url.search = queryParams.toString();
    return url.toString();
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
        throw new ApiResponseError('Riftapi', response.status);
      }

      if (!response.ok) {
        throw new ApiResponseError('Riftapi', response.status);
      }

      return response.json();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ApiTimeoutError('Riftapi');
    }
  }

  private mapSetToDomain(api: z.infer<typeof RiftapiSetSchema>): Set {
    return {
      id: api.id,
      code: api.set_id,
      name: api.name,
      ...(api.published_on != null ? { releaseDate: api.published_on } : {}),
      ...(api.card_count != null ? { cardCount: api.card_count } : {}),
    };
  }
}
