import { DomainError } from './base-error.js';

export class ApiTimeoutError extends DomainError {
  readonly code = 'API_TIMEOUT';
  readonly isUserFacing = true;

  constructor(service: string) {
    super(`The ${service} service is taking too long to respond. Please try again.`);
  }
}

export class ApiResponseError extends DomainError {
  readonly code = 'API_ERROR';
  readonly isUserFacing = false;

  constructor(service: string, statusCode: number) {
    super(`${service} API returned status ${statusCode}`);
  }
}
