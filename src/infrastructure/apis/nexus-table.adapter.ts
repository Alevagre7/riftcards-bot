import { z } from 'zod';
import {
  INexusTableRepository,
  GetNexusTableOptions,
} from '../../core/ports/nexus-table-repository.js';
import {
  NexusTable,
  NexusEvent,
  NexusStore,
  NexusRound,
  NexusOpponent,
  NexusStandings,
  NexusRecord,
  NexusStatus,
} from '../../core/entities/nexus-table.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';

// ---------------------------------------------------------------------------
// Zod schemas for the wire format
// ---------------------------------------------------------------------------

const NexusStoreSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    address: z.string(),
  })
  .passthrough();

const NexusOpponentSchema = z
  .object({
    name: z.string(),
    score: z.number().nullable().optional(),
  })
  .passthrough();

const NexusRoundSchema = z
  .object({
    number: z.number(),
    label: z.string(),
    status: z.enum(['pending', 'inProgress', 'completed']),
    result: z.enum(['win', 'loss', 'draw', 'bye']).nullable().optional(),
  })
  .passthrough();

const NexusStandingsSchema = z
  .object({
    rank: z.number(),
    points: z.number(),
    wins: z.number(),
    losses: z.number(),
    draws: z.number(),
  })
  .passthrough();

const NexusEventSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    store: NexusStoreSchema,
    startDate: z.string(),
    format: z.string(),
  })
  .passthrough();

const NexusTableSchema = z
  .object({
    event: NexusEventSchema.nullable().optional(),
    round: NexusRoundSchema.nullable().optional(),
    table: z
      .object({
        number: z.number().nullable().optional(),
        opponent: NexusOpponentSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    standings: NexusStandingsSchema.nullable().optional(),
    message: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Helpers: treat empty string as null
// ---------------------------------------------------------------------------

function emptyStrToNull(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return value;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapStore(raw: z.infer<typeof NexusStoreSchema>): NexusStore {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address,
  };
}

function mapEvent(raw: z.infer<typeof NexusEventSchema> | null): NexusEvent | null {
  if (!raw) return null;
  return {
    id: raw.id,
    name: raw.name,
    store: mapStore(raw.store),
    startDate: new Date(raw.startDate),
    format: raw.format,
  };
}

function mapRound(raw: z.infer<typeof NexusRoundSchema> | null): NexusRound | null {
  if (!raw) return null;
  return {
    number: raw.number,
    label: raw.label,
    status: raw.status,
    result: raw.result ?? null,
  };
}

function mapOpponent(raw: z.infer<typeof NexusOpponentSchema> | null): NexusOpponent | null {
  if (!raw) return null;
  return {
    name: raw.name,
    score: raw.score ?? null,
  };
}

function mapStandings(
  raw: z.infer<typeof NexusStandingsSchema> | null,
): NexusStandings | null {
  if (!raw) return null;
  return {
    rank: raw.rank,
    points: raw.points,
    wins: raw.wins,
    losses: raw.losses,
    draws: raw.draws,
  };
}

function mapRecord(raw: { wins: number; losses: number; draws: number } | null): NexusRecord {
  if (!raw) return { wins: 0, losses: 0, draws: 0 };
  return {
    wins: raw.wins,
    losses: raw.losses,
    draws: raw.draws,
  };
}

function mapStatus(round: { status: string } | null): NexusStatus {
  const active = round != null;
  const inProgress = round?.status === 'inProgress';
  return { active, inProgress };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

interface NexusTableAdapterOptions {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  retryAttempts: number;
}

export class NexusTableAdapter implements INexusTableRepository {
  constructor(private options: NexusTableAdapterOptions) {}

  async getTable(options: GetNexusTableOptions): Promise<NexusTable> {
    const params = new URLSearchParams();
    params.set('action', 'status');
    params.set('username', options.username);

    const data = await this.fetchJson(this.buildUrl(params));

    const parsed = NexusTableSchema.parse(data);

    const round = mapRound(parsed.round ?? null);
    const standings = mapStandings(parsed.standings ?? null);

    // The API returns table as an object: { number?: number, opponent?: {...} }
    const tableRaw = parsed.table ?? null;

    return {
      username: options.username,
      event: mapEvent(parsed.event ?? null),
      round,
      tableNumber: tableRaw?.number ?? null,
      opponent: tableRaw ? mapOpponent(tableRaw.opponent ?? null) : null,
      standings,
      record: mapRecord(standings),
      status: mapStatus(round),
      fetchedAt: new Date().toISOString(),
    };
  }

  private buildUrl(params: URLSearchParams): string {
    const url = new URL(this.options.baseUrl);
    url.search = params.toString();
    return url.toString();
  }

  private async fetchJson(url: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.options.token) {
      headers['Authorization'] = `Bearer ${this.options.token}`;
    }

    try {
      const response = await fetchWithRetry(url, {
        timeout: this.options.timeoutMs,
        retries: this.options.retryAttempts,
        headers,
      });

      if (response.status === 404) {
        throw new ApiResponseError('Nexus Table', 404);
      }

      if (response.status >= 500) {
        throw new ApiResponseError('Nexus Table', response.status);
      }

      if (!response.ok) {
        throw new ApiResponseError('Nexus Table', response.status);
      }

      return response.json();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ApiTimeoutError('Nexus Table');
    }
  }
}
