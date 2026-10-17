import { DomainError } from './base-error.js';

export class MytableLookupError extends DomainError {
  readonly code = 'MYTABLE_LOOKUP';
  readonly isUserFacing = true;

  constructor(message: string) {
    super(message);
  }
}
