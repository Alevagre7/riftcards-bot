// Nexus domain entities — mirror the Android app's models exactly.
// All fields are readonly. Sub-types only exist to type the single
// NexusTable blob consumed by the bot.

export interface NexusStore {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

export interface NexusOpponent {
  readonly name: string;
  readonly score: number | null;
}

export interface NexusRound {
  readonly number: number;
  readonly label: string;
  readonly status: 'pending' | 'inProgress' | 'completed';
  readonly result: 'win' | 'loss' | 'draw' | 'bye' | null;
}

export interface NexusStandings {
  readonly rank: number;
  readonly points: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface NexusRecord {
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface NexusEvent {
  readonly id: string;
  readonly name: string;
  readonly store: NexusStore;
  readonly startDate: Date;
  readonly format: string;
}

export interface NexusStatus {
  readonly active: boolean;
  readonly inProgress: boolean;
}

export interface NexusTable {
  readonly username: string;
  readonly event: NexusEvent | null;
  readonly round: NexusRound | null;
  readonly tableNumber: number | null;
  readonly opponent: NexusOpponent | null;
  readonly standings: NexusStandings | null;
  readonly record: NexusRecord;
  readonly status: NexusStatus;
  readonly fetchedAt: string;
}
