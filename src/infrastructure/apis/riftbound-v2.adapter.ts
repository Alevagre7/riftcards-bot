// RiftboundV2Adapter — the single upstream adapter for the events
// subsystem, talking to the official Riftbound V2 API
// (https://api.riftbound.uvsgames.com/api/v2, public, no auth).
//
// Implements IEventRepository (list / detail / registrations) plus
// getEventDetail, the live per-event bundle that replaced the locator
// HTML scraping: event + registrations in parallel, then the current
// round's pairings and standings.
//
// Wire format: snake_case JSON, page-based pagination via
// `next_page_number` (a bare page number, not a URL). All responses
// are Zod-validated before mapping.

import { z } from 'zod';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { Event, EventPhaseSummary, EventRoundSummary } from '../../core/entities/event.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { EventDetail, EventPairing, EventStanding } from '../../core/entities/event-detail.js';
import { ApiTimeoutError, ApiResponseError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { fetchWithRetry } from '../../utils/api-client.js';

// ---------------------------------------------------------------------------
// Zod schemas (V2 wire format)
// ---------------------------------------------------------------------------

const StoreSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_address: z.string().nullable().transform((v) => v ?? ''),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string().nullable().default(null),
  country: z.string().nullable().default(null),
  administrative_area_level_1_short: z.string().nullable().default(null),
});

const GameplayFormatSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const RoundSummarySchema = z.object({
  id: z.number(),
  round_number: z.number(),
  status: z.string(),
  pairings_status: z.string().nullable().default(null),
  standings_status: z.string().nullable().default(null),
});

const PhaseSchema = z.object({
  id: z.number(),
  status: z.string(),
  order_in_phases: z.number(),
  phase_name: z.string(),
  rounds: z.array(RoundSummarySchema),
});

const EventListItemSchema = z.object({
  id: z.number(),
  name: z.string(),
  // Unknown future statuses degrade to 'upcoming' instead of breaking
  // the whole list (the upstream has shipped new values before).
  display_status: z.enum(['upcoming', 'inProgress', 'complete']).catch('upcoming'),
  // The upstream emits nulls for several string fields on real events
  // (verified: event_format null in 77/132 US events, timezone null in
  // 4/132); the entity models them as non-null strings, so coerce.
  event_status: z.string().nullable().transform((v) => v ?? ''),
  start_datetime: z.string(),
  end_datetime: z.string(),
  timezone: z.string().nullable().transform((v) => v ?? ''),
  capacity: z.number(),
  registered_user_count: z.number(),
  starting_player_count: z.number(),
  store: StoreSchema,
  gameplay_format: GameplayFormatSchema,
  full_header_image_url: z.string().nullable().default(null),
  queue_status: z.string().nullable().transform((v) => v ?? ''),
  event_type: z.string().nullable().transform((v) => v ?? ''),
  event_format: z.string().nullable().transform((v) => v ?? ''),
  description: z.string().nullable().transform((v) => v ?? ''),
  cost_in_cents: z.number().nullable().default(null),
  currency: z.string().nullable().transform((v) => v ?? ''),
  is_on_demand: z.boolean(),
  is_test_event: z.boolean(),
  tournament_phases: z.array(PhaseSchema).default([]),
});

// Detail responses carry the same fields plus the full phase tree;
// the list schema already tolerates phases, so one schema covers both.
const EventDetailSchema = EventListItemSchema;

const EventListResponseSchema = z.object({
  count: z.number(),
  next_page_number: z.number().nullable(),
  results: z.array(EventListItemSchema),
});

const UserSchema = z.object({
  id: z.number(),
  best_identifier: z.string(),
  pronouns: z.string().nullable().default(null),
  country_code: z.string().nullable().default(null),
});

const RegistrationSchema = z.object({
  id: z.number(),
  best_identifier: z.string(),
  registration_status: z.string(),
  is_guest: z.boolean(),
  matches_won: z.number(),
  matches_lost: z.number(),
  matches_drawn: z.number(),
  total_match_points: z.number(),
  full_profile_picture_url: z.string().nullable().default(null),
  user: UserSchema,
  final_place_in_standings: z.number().nullable().default(null),
});

const RegistrationsResponseSchema = z.object({
  count: z.number(),
  next_page_number: z.number().nullable(),
  results: z.array(RegistrationSchema),
});

const PlayerSchema = z.object({
  id: z.number(),
  best_identifier: z.string(),
});

const UserEventStatusSchema = z.object({
  id: z.number(),
  best_identifier: z.string(),
  registration_status: z.string(),
  matches_won: z.number(),
  matches_lost: z.number(),
  matches_drawn: z.number(),
  total_match_points: z.number(),
});

const PlayerMatchRelationshipSchema = z.object({
  player_order: z.number().nullable().default(null),
  is_starting_player: z.boolean(),
  player: PlayerSchema,
  user_event_status: UserEventStatusSchema,
});

const MatchSchema = z.object({
  id: z.number(),
  table_number: z.number(),
  status: z.string(),
  games_won_by_winner: z.number().nullable().default(null),
  games_won_by_loser: z.number().nullable().default(null),
  match_is_bye: z.boolean(),
  winning_player: z.number().nullable().default(null),
  player_match_relationships: z.array(PlayerMatchRelationshipSchema),
});

const MatchesResponseSchema = z.object({
  count: z.number(),
  next_page_number: z.number().nullable(),
  results: z.array(MatchSchema),
});

const StandingSchema = z.object({
  id: z.number(),
  rank: z.number(),
  round_number: z.number(),
  match_record: z.string(),
  match_points: z.number(),
  player: PlayerSchema,
  user_event_status: UserEventStatusSchema,
});

const StandingsResponseSchema = z.object({
  count: z.number(),
  next_page_number: z.number().nullable(),
  results: z.array(StandingSchema),
});

// ---------------------------------------------------------------------------
// Mappers (pure, local to this file)
// ---------------------------------------------------------------------------

function mapV2PhaseToSummary(api: z.infer<typeof PhaseSchema>): EventPhaseSummary {
  return {
    id: api.id,
    status: api.status,
    orderInPhases: api.order_in_phases,
    phaseName: api.phase_name,
    rounds: api.rounds.map(mapV2RoundToSummary),
  };
}

function mapV2RoundToSummary(api: z.infer<typeof RoundSummarySchema>): EventRoundSummary {
  return {
    id: api.id,
    roundNumber: api.round_number,
    status: api.status,
    pairingsStatus: api.pairings_status,
    standingsStatus: api.standings_status,
  };
}

function mapV2EventToEvent(api: z.infer<typeof EventDetailSchema>): Event {
  return {
    id: api.id,
    name: api.name,
    displayStatus: api.display_status,
    eventStatus: api.event_status,
    startDatetime: api.start_datetime,
    endDatetime: api.end_datetime,
    timezone: api.timezone,
    capacity: api.capacity,
    registeredCount: api.registered_user_count,
    startingPlayerCount: api.starting_player_count,
    store: {
      id: api.store.id,
      name: api.store.name,
      fullAddress: api.store.full_address,
      latitude: api.store.latitude,
      longitude: api.store.longitude,
      timezone: api.store.timezone,
      country: api.store.country,
    },
    gameplayFormatName: api.gameplay_format.name,
    headerImageUrl: api.full_header_image_url,
    queueStatus: api.queue_status,
    eventType: api.event_type,
    eventFormat: api.event_format,
    description: api.description,
    costInCents: api.cost_in_cents,
    currency: api.currency,
    isOnDemand: api.is_on_demand,
    isTestEvent: api.is_test_event,
    tournamentPhases: api.tournament_phases.map(mapV2PhaseToSummary),
  };
}

function mapV2RegistrationToEventRegistration(
  api: z.infer<typeof RegistrationSchema>,
): EventRegistration {
  return {
    name: api.best_identifier,
    // The upstream marks active players 'COMPLETE'; every other
    // registration state is treated as dropped for the roster UI.
    status: api.registration_status === 'COMPLETE' ? 'Active' : 'Dropped',
    profileImageUrl: api.full_profile_picture_url,
    matchesWon: api.matches_won,
    matchesLost: api.matches_lost,
    matchesDrawn: api.matches_drawn,
    isGuest: api.is_guest,
    finalPlaceInStandings: api.final_place_in_standings,
  };
}

function mapV2MatchToPairing(api: z.infer<typeof MatchSchema>): EventPairing {
  const rels = [...api.player_match_relationships].sort(
    (a, b) => (a.player_order ?? 0) - (b.player_order ?? 0),
  );

  let score1: number | null = null;
  let score2: number | null = null;
  // Only completed matches carry scores; attribute the winner's game
  // count to whichever side winning_player identifies.
  if (
    api.status === 'COMPLETE' &&
    api.winning_player != null &&
    api.games_won_by_winner != null &&
    api.games_won_by_loser != null &&
    rels.length >= 2
  ) {
    const winnerIsFirst = api.winning_player === rels[0]!.player.id;
    score1 = winnerIsFirst ? api.games_won_by_winner : api.games_won_by_loser;
    score2 = winnerIsFirst ? api.games_won_by_loser : api.games_won_by_winner;
  }

  return {
    tableNumber: api.table_number,
    player1: rels[0]?.user_event_status.best_identifier ?? '',
    player2: rels[1]?.user_event_status.best_identifier ?? '',
    score1,
    score2,
    isBye: api.match_is_bye,
  };
}

function mapV2StandingToLeaderboardEntry(
  api: z.infer<typeof StandingSchema>,
): EventStanding {
  return {
    rank: api.rank,
    name: api.player.best_identifier,
    wins: api.user_event_status.matches_won,
    losses: api.user_event_status.matches_lost,
    draws: api.user_event_status.matches_drawn,
    matchPoints: api.match_points,
    matchRecord: api.match_record,
  };
}

// ---------------------------------------------------------------------------
// currentRound derivation
// ---------------------------------------------------------------------------

// Scan the event's rounds in (orderInPhases desc, roundNumber desc)
// order. The "current" round is the first IN_PROGRESS one; else the
// first PENDING one; else the last COMPLETE one (the earliest round,
// which is what a fully-completed event's capture resolves to); else
// null. The watcher relies on this ordering to clear its snapshot
// when a round ends.
function deriveCurrentRound(event: Event): EventRoundSummary | null {
  const rounds: EventRoundSummary[] = [];
  const phaseOrder = new Map<number, number>();
  for (const phase of event.tournamentPhases) {
    for (const round of phase.rounds) {
      phaseOrder.set(round.id, phase.orderInPhases);
      rounds.push(round);
    }
  }

  rounds.sort((a, b) => {
    const phaseDiff = (phaseOrder.get(b.id) ?? 0) - (phaseOrder.get(a.id) ?? 0);
    return phaseDiff !== 0 ? phaseDiff : b.roundNumber - a.roundNumber;
  });

  for (const round of rounds) {
    if (round.status === 'IN_PROGRESS') return round;
  }
  for (const round of rounds) {
    if (round.status === 'PENDING') return round;
  }
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (rounds[i]!.status === 'COMPLETE') return rounds[i]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Adapter options
// ---------------------------------------------------------------------------

interface RiftboundV2AdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
}

// ---------------------------------------------------------------------------
// Cache (30s TTL, max 50 entries — same shape as the old locator cache)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 50;
const MAX_PAGES = 20; // safety cap on pagination loops

interface CacheEntry {
  data: EventDetail;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class RiftboundV2Adapter implements IEventRepository {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly cache: Map<number, CacheEntry>;

  constructor(options: RiftboundV2AdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.retryAttempts = options.retryAttempts;
    this.cache = new Map();
  }

  private buildUrl(path: string, queryParams: URLSearchParams): string {
    const url = new URL(path.replace(/^\//, ''), `${this.baseUrl}/`);
    url.search = queryParams.toString();
    return url.toString();
  }

  /** GET a single JSON resource. 404 → `{ status: 404, json: null }`.
   *  Transient network failures and timeouts become domain errors. */
  private async request(
    path: string,
    queryParams: URLSearchParams,
  ): Promise<{ status: number; json: unknown }> {
    try {
      const response = await fetchWithRetry(this.buildUrl(path, queryParams), {
        timeout: this.timeoutMs,
        retries: this.retryAttempts,
        headers: { Accept: 'application/json' },
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, json };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      console.error(`[Riftbound V2] ${path} error:`, error);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ApiTimeoutError('Riftbound V2');
      }
      throw new ApiTimeoutError('Riftbound V2');
    }
  }

  private parse<T>(schema: z.ZodType<T>, json: unknown): T {
    try {
      return schema.parse(json);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const snippet = error.message.slice(0, 200);
        throw new ApiResponseError('Riftbound V2', 502, `Schema parse failed: ${snippet}`);
      }
      throw error;
    }
  }

  /** Follow `next_page_number` until exhausted, concatenating results.
   *  A 404 means "no data here" (no registrations / no pairings yet)
   *  and yields an empty array. */
  private async fetchPaginated<T>(
    path: string,
    params: URLSearchParams,
    schema: z.ZodType<{ results: T[]; next_page_number: number | null }>,
  ): Promise<T[]> {
    const all: T[] = [];
    let page: number | null = 1;
    let pagesFetched = 0;

    while (page != null && pagesFetched < MAX_PAGES) {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      const { status, json } = await this.request(path, pageParams);
      if (status === 404) return all;
      if (status !== 200) throw new ApiResponseError('Riftbound V2', status);

      const parsed = this.parse(schema, json);
      all.push(...parsed.results);
      page = parsed.next_page_number;
      pagesFetched++;
    }

    return all;
  }

  async getEvents(
    startAfter: Date,
    startBefore: Date,
    location: EventLocation,
  ): Promise<Event[]> {
    const params = new URLSearchParams();
    params.set('start_date_after', startAfter.toISOString());
    params.set('start_date_before', startBefore.toISOString());
    params.append('display_statuses', 'upcoming');
    params.append('display_statuses', 'inProgress');
    params.set('game_slug', 'riftbound');
    params.set('latitude', String(location.latitude));
    params.set('longitude', String(location.longitude));
    params.set('num_miles', String(Math.round(location.numMiles)));
    params.set('upcoming_only', 'false');
    params.set('page_size', '25');

    const items = await this.fetchPaginated(
      '/events/',
      params,
      EventListResponseSchema,
    );
    return items.map(mapV2EventToEvent);
  }

  async getEventById(
    id: number,
    _location: EventLocation,
  ): Promise<Event | null> {
    const { status, json } = await this.request(`/events/${id}/`, new URLSearchParams());
    if (status === 404) return null;
    if (status !== 200) throw new ApiResponseError('Riftbound V2', status);

    const parsed = this.parse(EventDetailSchema, json);
    return mapV2EventToEvent(parsed);
  }

  async getEventRegistrations(
    id: number,
    _location: EventLocation,
  ): Promise<EventRegistration[]> {
    const params = new URLSearchParams();
    params.set('page_size', '100');
    const results = await this.fetchPaginated(
      `/events/${id}/registrations/`,
      params,
      RegistrationsResponseSchema,
    );
    return results.map(mapV2RegistrationToEventRegistration);
  }

  async getEventDetail(
    id: number,
    location: EventLocation,
    options?: { fresh?: boolean },
  ): Promise<EventDetail | null> {
    // Watcher tick path: bypass the in-adapter cache so a round
    // transition the upstream just published is observed immediately
    // instead of after up to CACHE_TTL_MS. Also skip the write to
    // avoid holding a stale snapshot for the next caller.
    if (options?.fresh !== true) {
      const cached = this.cache.get(id);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
    }

    const event = await this.getEventById(id, location);
    if (event == null) return null;

    const [registrations, currentRound] = await Promise.all([
      this.getEventRegistrations(id, location),
      Promise.resolve(deriveCurrentRound(event)),
    ]);

    let pairings: EventPairing[] = [];
    let standings: EventStanding[] = [];
    if (currentRound != null) {
      const [matches, standingRows] = await Promise.all([
        this.fetchPaginated(
          `/tournament-rounds/${currentRound.id}/matches/paginated/`,
          new URLSearchParams({ page_size: '10', avoid_cache: 'false' }),
          MatchesResponseSchema,
        ),
        this.fetchPaginated(
          `/tournament-rounds/${currentRound.id}/standings/paginated/`,
          new URLSearchParams({ page_size: '10' }),
          StandingsResponseSchema,
        ),
      ]);
      pairings = matches.filter((m) => !m.match_is_bye).map(mapV2MatchToPairing);
      standings = standingRows.map(mapV2StandingToLeaderboardEntry);
    }

    const detail: EventDetail = {
      event,
      currentRound,
      registrations,
      pairings,
      standings,
      fetchedAt: new Date().toISOString(),
    };

    this.pruneCache();
    this.cache.set(id, { data: detail, expiresAt: Date.now() + CACHE_TTL_MS });
    return detail;
  }

  private pruneCache(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    if (this.cache.size > MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
  }
}
