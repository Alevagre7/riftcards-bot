/** Provider-aware identifiers used by the events domain. */
export type EventId = number | `riot:${string}`;

/** A tournament round can be identified by its ordinal or stable provider ID. */
export type RoundId = number | string;
