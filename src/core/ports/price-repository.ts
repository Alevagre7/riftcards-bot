import { PriceData } from '../entities/price.js';

export interface IPriceRepository {
  getPrice(
    cardIdentifier: string,
    options?: { setCode?: string; collectorNumber?: string },
  ): Promise<PriceData | null>;
}
