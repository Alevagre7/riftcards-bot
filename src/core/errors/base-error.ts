export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly isUserFacing: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
