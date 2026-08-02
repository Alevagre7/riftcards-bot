export type EventMode = 'Skirmish' | 'Nexus Night' | 'Pre-Rift' | 'Other';

export function normalizeEventMode(value: string): EventMode {
  const normalized = value.toLowerCase();
  if (normalized.includes('skirmish')) return 'Skirmish';
  if (normalized.includes('nexus night')) return 'Nexus Night';
  if (normalized.includes('pre-rift')) return 'Pre-Rift';
  return 'Other';
}

export interface EventListing {
  readonly id: number;
  readonly name: string;
  readonly startDatetime: string;
  readonly endDatetime: string;
  readonly mode: EventMode;
  readonly storeName: string;
  readonly registeredCount: number;
  readonly capacity: number;
}
