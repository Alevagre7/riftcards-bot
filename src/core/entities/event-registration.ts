export interface EventRegistration {
  readonly name: string;   // best_identifier from upstream
  readonly status: string; // Normalized: "Registered", "Pending", "Cancelled", "Waitlist", or raw value
}
