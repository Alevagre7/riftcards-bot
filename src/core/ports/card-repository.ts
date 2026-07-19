import { Card } from '../entities/card.js';
import { Set } from '../entities/set.js';

export interface SearchCardsOptions {
  query: string;
  setId?: string;
  page?: number;
  limit?: number;
  sort?: 'name' | 'collector_number' | 'set_id';
  dir?: 'asc' | 'desc';
}

export interface SearchCardsResult {
  cards: Card[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ICardRepository is the port the bot layer (commands, formatters,
// inline queries) depends on for card data. The implementation lives
// in src/infrastructure/apis/ and is wired up in src/index.ts.
//
// The `id` field on Card and on getCardById's argument is a
// composite of the riftbound id and the collector number, formatted
// as `${riftboundId}/${collectorNumber}` (e.g. `ogn-011/298`). This
// makes each Card unique across the gallery — base prints,
// alternate arts, and overnumbered variants all have distinct ids
// even though they share a riftboundId. See ADR-0001.
export interface ICardRepository {
  searchCards(options: SearchCardsOptions): Promise<SearchCardsResult>;
  getCardById(id: string): Promise<Card | null>;
  getCardByRiftboundId(riftboundId: string): Promise<Card | null>;
  getCardByName(name: string): Promise<Card | null>;
  getCardByTcgPlayerId(productId: string): Promise<Card | null>;
  getSets(): Promise<Set[]>;
  getCardsBySet(setCode: string, page?: number, limit?: number): Promise<SearchCardsResult>;
  getRandomCard(): Promise<Card | null>;
}
