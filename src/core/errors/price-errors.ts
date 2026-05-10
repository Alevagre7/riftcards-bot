import { DomainError } from './base-error.js';

export class PriceUnavailableError extends DomainError {
  readonly code = 'PRICE_UNAVAILABLE';
  readonly isUserFacing = true;

  constructor(cardName: string) {
    super(`Price data for "${cardName}" is currently unavailable.`);
  }
}

export class ApiRateLimitError extends DomainError {
  readonly code = 'RATE_LIMITED';
  readonly isUserFacing = true;

  constructor() {
    super('The price service is temporarily unavailable due to high demand. Please try again later.');
  }
}
