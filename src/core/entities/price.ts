export interface PriceData {
  readonly cardId: string;
  readonly cardName: string;
  readonly currency: string;
  readonly lowestNearMint: number | null;
  readonly lowestNearMintEuOnly: number | null;
  readonly average30d: number | null;
  readonly average7d: number | null;
  readonly gradedPrices?: readonly GradedPrice[];
  readonly lastUpdated?: Date;
  readonly cardmarketUrl?: string;
}

export interface GradedPrice {
  readonly gradingCompany: 'PSA' | 'BGS' | 'CGC' | string;
  readonly grade: string;
  readonly price: number;
}
