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
