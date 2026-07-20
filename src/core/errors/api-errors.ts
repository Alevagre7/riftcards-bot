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
  readonly body: string | undefined;

  constructor(service: string, statusCode: number, body?: string) {
    super(`${service} API returned status ${statusCode}${body ? `: ${body}` : ''}`);
    this.body = body;
  }
}
