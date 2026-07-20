export interface EventRegistration {
  readonly name: string;   // best_identifier from upstream
  readonly status: string; // registration_status, e.g. "COMPLETE", displayed as-is
}
