export interface Card {
  readonly id: string;
  readonly name: string;
  readonly setCode: string;
  readonly setName?: string;
  readonly collectorNumber: string;
  readonly rarity: string;
  readonly type: string;
  readonly supertype?: string;
  readonly domain?: string;
  readonly energy?: number;
  readonly might?: number;
  readonly power?: number;
  readonly text?: string;
  readonly flavorText?: string;
  readonly keywords: readonly string[];
  readonly artist?: string;
  readonly imageUrl?: string;
  readonly riftboundId?: string;
  readonly tcgplayerId?: string;
}
