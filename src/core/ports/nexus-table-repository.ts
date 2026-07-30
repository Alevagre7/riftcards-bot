import { NexusTable } from '../entities/nexus-table.js';

export interface GetNexusTableOptions {
  readonly username: string;
}

export interface INexusTableRepository {
  getTable(options: GetNexusTableOptions): Promise<NexusTable>;
}
