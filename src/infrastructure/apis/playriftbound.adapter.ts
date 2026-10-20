// PlayRiftboundAdapter — public, read-only client for Riot's events GraphQL
// service. It implements both event ports so one provider-aware ID stays on
// the PlayRiftbound path for listings, detail, and live tournament data.

import { z } from 'zod';
import { Event } from '../../core/entities/event.js';
import type { EventId, RoundId } from '../../core/entities/event-id.js';
import { EventDetail, EventPairing, EventStanding } from '../../core/entities/event-detail.js';
import { EventListing, normalizeEventMode } from '../../core/entities/event-listing.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { ApiResponseError, ApiTimeoutError } from '../../core/errors/index.js';
import { DomainError } from '../../core/errors/base-error.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import { eventTimezone } from './event-timezone.js';
import { fetchWithRetry } from '../../utils/api-client.js';

const DEFAULT_BASE_URL = 'https://events.playriftbound.com';
const API_PATH = '/api/gql';
const CLIENT_NAME = 'Esports Web';
const CLIENT_VERSION = 'b3891f6';
const SEARCH_PAGE_SIZE = 20;
const MAX_SEARCH_PAGES = 50;
const MAX_DISCOVERY_BUNDLES = 40;
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 100;
const MAX_SEARCH_MILES = 100;

type OperationName = 'CompeteTournamentSearch' | 'GetCompeteTournamentForRiftboundPlayer' | 'OrganizerSummary';

const INITIAL_HASHES: Readonly<Record<OperationName, string>> = {
  CompeteTournamentSearch: '7791f530b0e27f81a3ef1c8571099cb6a96e0bfb9fadd4ff66bfd4929a323e86',
  GetCompeteTournamentForRiftboundPlayer: 'e56d6d93e4f8fa287557521535544350e5cc9baafd78ba69f9f592873b090e57',
  OrganizerSummary: '9142e18241bb86a3b4c2692d899b31aaf61d11065ca8a259191aa9cc0a06ed57',
};

const GraphqlErrorSchema = z.object({
  message: z.string().optional(),
  extensions: z.object({ code: z.string().optional() }).passthrough().optional(),
}).passthrough();

const GraphqlEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(GraphqlErrorSchema).optional(),
}).passthrough();

const PlayerSchema = z.object({
  id: z.uuid().transform((value) => value.toLowerCase()).nullable(),
  displayName: z.string().nullable(),
  tagLine: z.string().nullable().optional(),
}).passthrough();

const RegistrantPlayerSchema = PlayerSchema.extend({ tagLine: z.string().nullable() });

const SearchRegistrantCountSchema = z.object({
  status: z.string(),
  count: z.number().int().nonnegative(),
}).passthrough();

const SearchTournamentSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  startsAt: z.string(),
  pricing: z.string().nullable(),
  entryFee: z.object({ currency: z.string(), minorUnits: z.number() }).nullable(),
  registrantCounts: z.array(SearchRegistrantCountSchema),
  config: z.object({
    tournamentType: z.string().nullable(),
    format: z.string().nullable(),
    playerFormat: z.string().nullable(),
    participantCapacity: z.number().int().nullable(),
  }).nullable(),
}).passthrough();

const SearchAddressSchema = z.object({
  city: z.string().nullable(),
  adminArea1: z.string().nullable(),
  formattedAddress: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
}).passthrough().nullable();

const SearchOrganizerSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  physicalAddress: SearchAddressSchema,
}).passthrough();

const SearchNodeSchema = z.object({
  __typename: z.string(),
  distanceMeters: z.number().nonnegative(),
  organizer: SearchOrganizerSchema,
  tournament: SearchTournamentSchema,
}).passthrough();

const SearchDataSchema = z.object({
  competeTournamentSearch: z.object({
    edges: z.array(z.object({
      cursor: z.string().nullable(),
      node: SearchNodeSchema,
    }).passthrough()),
    pageInfo: z.object({
      endCursor: z.string().nullable(),
      hasNextPage: z.boolean(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const RegistrantSchema = z.object({
  id: z.string().min(1),
  player: RegistrantPlayerSchema.nullable(),
  status: z.string(),
  team: z.object({ id: z.string().min(1) }).passthrough().nullable(),
  waitlistPosition: z.number().int().nullable(),
}).passthrough();

const ParticipantSchema = z.object({
  id: z.string().min(1),
  esportsTeamId: z.string().min(1).nullable(),
  player: PlayerSchema.nullable(),
  status: z.string(),
}).passthrough();

const TeamOutcomeSchema = z.object({
  esportsTeamId: z.string().min(1),
  outcome: z.string(),
}).passthrough();

const TeamSchema = z.object({
  esportsTeamId: z.string().min(1).nullable(),
  players: z.array(PlayerSchema).nullable(),
}).passthrough();

const GameSchema = z.object({
  number: z.number().int(),
  teamOutcomes: z.array(TeamOutcomeSchema).nullable(),
}).passthrough();

const MatchSchema = z.object({
  esportsMatchId: z.string().min(1),
  tableNumber: z.number().int().nullable(),
  status: z.string(),
  games: z.array(GameSchema),
  teamOutcomes: z.array(TeamOutcomeSchema).nullable(),
  teams: z.array(TeamSchema).nullable(),
}).passthrough();

const PercentageSchema = z.union([z.number(), z.string()])
  .transform((value) => Number(value))
  .refine(Number.isFinite, 'percentage must be finite');

const StandingSchema = z.object({
  esportsTeamId: z.string().min(1),
  rank: z.number().int(),
  matchPoints: z.number(),
  matchWins: z.number().int(),
  matchLosses: z.number().int(),
  matchDraws: z.number().int(),
  opponentMatchWinPercentage: PercentageSchema,
  gameWinPercentage: PercentageSchema,
  opponentGameWinPercentage: PercentageSchema,
}).passthrough();

const RoundSchema = z.object({
  roundNumber: z.number().int().positive(),
  status: z.string(),
  byeTeamIds: z.array(z.string().min(1)),
  matches: z.array(MatchSchema),
  // Riot publishes null while a round has no standings yet. This must not
  // prevent reading its live pairings. Missing/malformed fields still fail.
  endOfRoundStandings: z.array(StandingSchema).nullable().transform((rows) => rows ?? []),
}).passthrough();

const SectionSchema = z.object({
  esportsSectionId: z.string().min(1),
  rounds: z.array(RoundSchema),
}).passthrough();

const StageSchema = z.object({
  esportsStageId: z.string().min(1),
  name: z.string().nullable(),
  sections: z.array(SectionSchema),
}).passthrough();

const TournamentSchema = z.object({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  organizerId: z.string().min(1),
  pricing: z.string().nullable(),
  entryFee: z.object({ currency: z.string(), minorUnits: z.number() }).nullable(),
  registrationPolicy: z.string().nullable(),
  visibility: z.string().nullable(),
  registrantCounts: z.array(SearchRegistrantCountSchema),
  config: z.object({
    format: z.string().nullable(),
    playerFormat: z.string().nullable(),
    participantCapacity: z.number().int().nullable(),
    roundCount: z.number().int().nullable(),
    tournamentType: z.string().nullable(),
  }).nullable(),
  stages: z.array(StageSchema),
  tournamentParticipants: z.array(ParticipantSchema),
  tournamentRegistrants: z.array(RegistrantSchema),
}).passthrough();

const TournamentDataSchema = z.object({
  competeTournaments: z.array(TournamentSchema),
}).passthrough();

const OrganizerDataSchema = z.object({
  organizerSummary: z.object({
    id: z.string().min(1),
    name: z.string(),
    physicalAddress: z.object({
      formattedAddress: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }).passthrough().nullable(),
  }).passthrough().nullable(),
}).passthrough();

type RawTournament = z.infer<typeof TournamentSchema>;
type RawStage = z.infer<typeof StageSchema>;
type RawSection = z.infer<typeof SectionSchema>;
type RawRound = z.infer<typeof RoundSchema>;
type RawMatch = z.infer<typeof MatchSchema>;
type RawTeam = z.infer<typeof TeamSchema>;
type RawPlayer = z.infer<typeof PlayerSchema>;
type RawStanding = z.infer<typeof StandingSchema>;
type RawOrganizer = NonNullable<z.infer<typeof OrganizerDataSchema>['organizerSummary']>;

export interface PlayRiftboundAdapterOptions {
  readonly baseUrl?: string;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

interface RoundRef {
  readonly id: string;
  readonly raw: RawRound;
  readonly stage: RawStage;
  readonly section: RawSection;
  readonly index: number;
  readonly summary: Event['tournamentPhases'][number]['rounds'][number];
}

interface ParsedRoundId {
  readonly eventId: string;
  readonly stageId: string;
  readonly sectionId: string;
  readonly roundNumber: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getGraphqlErrorCode(error: z.infer<typeof GraphqlErrorSchema>): string {
  return error.extensions?.code?.toUpperCase() ?? '';
}

function isPersistedHashError(errors: readonly z.infer<typeof GraphqlErrorSchema>[]): boolean {
  return errors.some((error) => {
    const code = getGraphqlErrorCode(error);
    const message = error.message?.toUpperCase() ?? '';
    return code.includes('PERSISTED_QUERY_NOT_FOUND') ||
      code.includes('PERSISTED_QUERY_NOT_IN_LIST') ||
      message.includes('PERSISTED_QUERY_NOT_FOUND') ||
      message.includes('PERSISTED_QUERY_NOT_IN_LIST');
  });
}

function parseEventRawId(id: EventId): string {
  if (typeof id !== 'string' || !id.startsWith('riot:')) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Expected a Riot event ID.');
  }
  const rawId = id.slice('riot:'.length);
  if (!/^\d+$/.test(rawId)) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Invalid Riot event ID.');
  }
  return rawId;
}

function parseRoundId(roundId: RoundId): ParsedRoundId {
  if (typeof roundId !== 'string') {
    throw new ApiResponseError('PlayRiftbound', 400, 'Expected a Riot round ID.');
  }
  const parts = roundId.split(':');
  if (
    parts.length !== 5 ||
    parts[0] !== 'riot' ||
    !/^\d+$/.test(parts[1] ?? '') ||
    !/^\d+$/.test(parts[2] ?? '') ||
    !/^\d+$/.test(parts[3] ?? '') ||
    !/^\d+$/.test(parts[4] ?? '')
  ) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Invalid Riot round ID.');
  }
  return {
    eventId: parts[1]!,
    stageId: parts[2]!,
    sectionId: parts[3]!,
    roundNumber: Number(parts[4]),
  };
}

function makeRoundId(eventId: string, stageId: string, sectionId: string, roundNumber: number): string {
  return `riot:${eventId}:${stageId}:${sectionId}:${roundNumber}`;
}

function parseIsoDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new ApiResponseError('PlayRiftbound', 502, `Invalid ${field} timestamp.`);
  }
  return parsed;
}

function mapRoundStatus(status: string): string {
  switch (status.toUpperCase()) {
    case 'FINALIZED':
      return 'COMPLETE';
    case 'READY':
    case 'PENDING':
      return 'PENDING';
    case 'NOT_STARTED':
    case 'UNSTARTED':
      return 'UPCOMING';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    default:
      return status;
  }
}

function flattenRounds(tournament: RawTournament): RoundRef[] {
  const output: RoundRef[] = [];
  for (const stage of tournament.stages) {
    for (const section of stage.sections) {
      for (const round of section.rounds) {
        const pairingsPublished = round.matches.length > 0 || round.byeTeamIds.length > 0;
        output.push({
          id: makeRoundId(tournament.id, stage.esportsStageId, section.esportsSectionId, round.roundNumber),
          raw: round,
          stage,
          section,
          index: output.length,
          summary: {
            id: makeRoundId(tournament.id, stage.esportsStageId, section.esportsSectionId, round.roundNumber),
            roundNumber: round.roundNumber,
            status: mapRoundStatus(round.status),
            pairingsStatus: pairingsPublished ? 'COMPLETE' : null,
            standingsStatus: round.endOfRoundStandings.length > 0 ? 'COMPLETE' : null,
          },
        });
      }
    }
  }
  return output;
}

function isFinalized(round: RawRound): boolean {
  return round.status.toUpperCase() === 'FINALIZED';
}

function selectCurrentRound(rounds: readonly RoundRef[]): RoundRef | null {
  const priority = ['IN_PROGRESS', 'READY', 'PENDING'];
  for (const status of priority) {
    const selected = rounds.find((round) => round.raw.status.toUpperCase() === status);
    if (selected) return selected;
  }
  for (let index = rounds.length - 1; index >= 0; index--) {
    const candidate = rounds[index];
    if (candidate && isFinalized(candidate.raw)) return candidate;
  }
  return rounds[0] ?? null;
}

function selectStandingsRound(
  rounds: readonly RoundRef[],
  target: RoundRef,
): RoundRef | null {
  if (target.raw.endOfRoundStandings.length > 0) return target;
  for (let index = target.index - 1; index >= 0; index--) {
    const candidate = rounds[index];
    if (candidate && isFinalized(candidate.raw) && candidate.raw.endOfRoundStandings.length > 0) {
      return candidate;
    }
  }
  return null;
}

function formatPlayerName(player: RawPlayer | null | undefined): string | null {
  const displayName = player?.displayName?.trim();
  if (!displayName) return null;
  const tagLine = player?.tagLine?.trim();
  return tagLine ? `${displayName}#${tagLine}` : displayName;
}

function playerNameLookup(tournament: RawTournament): Map<string, string> {
  const names = new Map<string, string>();
  const add = (player: RawPlayer | null | undefined) => {
    if (!player?.id) return;
    const name = formatPlayerName(player);
    if (!name) return;
    const current = names.get(player.id);
    if (!current || (!current.includes('#') && name.includes('#'))) names.set(player.id, name);
  };
  for (const registrant of tournament.tournamentRegistrants) add(registrant.player);
  for (const participant of tournament.tournamentParticipants) add(participant.player);
  for (const round of flattenRounds(tournament)) {
    for (const match of round.raw.matches) {
      for (const team of match.teams ?? []) {
        for (const player of team.players ?? []) add(player);
      }
    }
  }
  return names;
}

function isTrackingSupported(tournament: RawTournament, rounds: readonly RoundRef[]): boolean {
  if (tournament.config?.playerFormat !== 'ONE_V_ONE') return false;

  const teamPlayers = new Map<string, Set<string>>();
  for (const participant of tournament.tournamentParticipants) {
    const teamId = participant.esportsTeamId;
    const playerId = participant.player?.id;
    if (!teamId || !playerId) continue;
    const players = teamPlayers.get(teamId) ?? new Set<string>();
    players.add(playerId);
    teamPlayers.set(teamId, players);
  }
  if ([...teamPlayers.values()].some((players) => players.size !== 1)) return false;

  let sawMatch = false;
  for (const round of rounds) {
    for (const match of round.raw.matches) {
      sawMatch = true;
      const teams = match.teams;
      if (!teams || teams.length !== 2 || teams.some((team) => !team.esportsTeamId || team.players?.length !== 1 || !team.players[0]?.id)) {
        return false;
      }
    }
  }
  const activeRoundCount = rounds.filter((round) => ['IN_PROGRESS', 'READY', 'PENDING'].includes(round.raw.status.toUpperCase())).length;
  if (activeRoundCount > 1) return false;
  return !sawMatch || tournament.config.playerFormat === 'ONE_V_ONE';
}

function deriveDisplayStatus(tournament: RawTournament, rounds: readonly RoundRef[]): Event['displayStatus'] {
  if (tournament.tournamentParticipants.length === 0 || rounds.length === 0) return 'upcoming';
  const expectedRounds = tournament.config?.roundCount;
  if (
    expectedRounds != null &&
    expectedRounds > 0 &&
    rounds.length === expectedRounds &&
    rounds.every((round) => isFinalized(round.raw))
  ) {
    return 'complete';
  }
  return 'inProgress';
}

function countRegistrantStatus(tournament: RawTournament, status: string): number {
  return tournament.registrantCounts
    .filter((count) => count.status.toUpperCase() === status)
    .reduce((total, count) => total + count.count, 0);
}

function mapPhaseSummaries(tournament: RawTournament, eventId: string): Event['tournamentPhases'] {
  return tournament.stages.map((stage, stageIndex) => {
    const rounds = stage.sections.flatMap((section) => section.rounds);
    let status = 'UPCOMING';
    if (rounds.length > 0 && rounds.every(isFinalized)) status = 'COMPLETE';
    else if (rounds.some((round) => ['IN_PROGRESS', 'READY', 'PENDING'].includes(round.status.toUpperCase()))) status = 'IN_PROGRESS';
    return {
      id: stage.esportsStageId,
      status,
      orderInPhases: stageIndex + 1,
      phaseName: stage.name?.trim() || `Stage ${stageIndex + 1}`,
      rounds: stage.sections.flatMap((section) => section.rounds.map((round) => ({
        id: makeRoundId(eventId, stage.esportsStageId, section.esportsSectionId, round.roundNumber),
        roundNumber: round.roundNumber,
        status: mapRoundStatus(round.status),
        pairingsStatus: round.matches.length > 0 || round.byeTeamIds.length > 0 ? 'COMPLETE' : null,
        standingsStatus: round.endOfRoundStandings.length > 0 ? 'COMPLETE' : null,
      }))),
    };
  });
}

function mapOrganizerToStore(organizer: RawOrganizer): Event['store'] {
  const address = organizer.physicalAddress;
  const latitude = address?.latitude;
  const longitude = address?.longitude;
  if (latitude == null || longitude == null) {
    throw new ApiResponseError('PlayRiftbound', 502, 'Organizer is missing public store coordinates.');
  }
  return {
    id: organizer.id,
    name: organizer.name,
    fullAddress: address?.formattedAddress ?? '',
    latitude,
    longitude,
    timezone: eventTimezone(latitude, longitude),
    country: null,
  };
}

function mapTournamentToEvent(
  tournament: RawTournament,
  organizer: RawOrganizer,
  rounds: readonly RoundRef[],
): Event {
  const displayStatus = deriveDisplayStatus(tournament, rounds);
  const eventStatus = displayStatus === 'upcoming'
    ? 'SCHEDULED'
    : displayStatus === 'complete'
      ? 'COMPLETE'
      : 'IN_PROGRESS';
  const startDate = parseIsoDate(tournament.startsAt, 'start');
  const endDate = tournament.endsAt == null ? null : parseIsoDate(tournament.endsAt, 'end').toISOString();
  const store = mapOrganizerToStore(organizer);
  const event: Event = {
    id: `riot:${tournament.id}`,
    name: tournament.name,
    displayStatus,
    eventStatus,
    startDatetime: startDate.toISOString(),
    endDatetime: endDate,
    timezone: store.timezone ?? 'UTC',
    capacity: tournament.config?.participantCapacity ?? 0,
    registeredCount: countRegistrantStatus(tournament, 'REGISTERED'),
    startingPlayerCount: tournament.tournamentParticipants.length,
    store,
    gameplayFormatName: tournament.config?.format ?? '',
    headerImageUrl: null,
    queueStatus: tournament.registrationPolicy ?? '',
    eventType: tournament.config?.tournamentType ?? '',
    eventFormat: tournament.config?.playerFormat ?? tournament.config?.format ?? '',
    description: tournament.description ?? '',
    costInCents: tournament.entryFee?.minorUnits ?? null,
    currency: tournament.entryFee?.currency ?? '',
    isOnDemand: false,
    isTestEvent: false,
    tournamentPhases: mapPhaseSummaries(tournament, tournament.id),
    locatorUrl: `https://events.playriftbound.com/en-US/events/${tournament.id}`,
    supportsTracking: isTrackingSupported(tournament, rounds),
  };
  return event;
}

function mapSearchNodeToListing(node: z.infer<typeof SearchNodeSchema>): EventListing {
  if (node.__typename !== 'RbTournamentSearchResult') {
    throw new ApiResponseError('PlayRiftbound', 502, `Unsupported search result type: ${node.__typename}`);
  }
  const startsAt = parseIsoDate(node.tournament.startsAt, 'start').toISOString();
  const type = node.tournament.config?.tournamentType ?? '';
  const address = node.organizer.physicalAddress;
  return {
    id: `riot:${node.tournament.id}`,
    name: node.tournament.name,
    startDatetime: startsAt,
    ...(address?.latitude != null && address.longitude != null
      ? { timezone: eventTimezone(address.latitude, address.longitude) }
      : {}),
    mode: normalizeEventMode(type.replaceAll('_', '-')),
    storeName: node.organizer.name,
    registeredCount: node.tournament.registrantCounts
      .filter((count) => count.status.toUpperCase() === 'REGISTERED')
      .reduce((total, count) => total + count.count, 0),
    capacity: node.tournament.config?.participantCapacity ?? 0,
  };
}

function parsePercentage(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function mapStandings(
  source: RoundRef,
  tournament: RawTournament,
  names: ReadonlyMap<string, string>,
): EventStanding[] {
  const teamToPlayer = new Map<string, string>();
  for (const participant of tournament.tournamentParticipants) {
    if (participant.esportsTeamId && participant.player?.id) {
      teamToPlayer.set(participant.esportsTeamId, participant.player.id);
    }
  }
  for (const match of source.raw.matches) {
    for (const team of match.teams ?? []) {
      const player = team.players?.[0];
      if (team.esportsTeamId && player?.id && !teamToPlayer.has(team.esportsTeamId)) {
        teamToPlayer.set(team.esportsTeamId, player.id);
      }
    }
  }
  return source.raw.endOfRoundStandings.map((standing) => {
    const playerId = teamToPlayer.get(standing.esportsTeamId);
    return {
      rank: standing.rank,
      name: playerId ? names.get(playerId) ?? 'Unknown player' : 'Unknown player',
      ...(playerId ? { playerId } : {}),
      roundNumber: source.raw.roundNumber,
      matchRecord: `${standing.matchWins}-${standing.matchLosses}-${standing.matchDraws}`,
      points: standing.matchPoints,
      opponentMatchWinPercentage: parsePercentage(standing.opponentMatchWinPercentage),
      gameWinPercentage: parsePercentage(standing.gameWinPercentage),
      opponentGameWinPercentage: parsePercentage(standing.opponentGameWinPercentage),
    };
  });
}

function registrationStatus(
  registrantStatus: string,
  participantStatus: string | undefined,
  waitlistPosition: number | null | undefined,
): string {
  if (participantStatus != null) {
    switch (participantStatus.toUpperCase()) {
      case 'ACTIVE':
        return 'Active';
      case 'DROPPED':
      case 'ELIMINATED':
        return 'Dropped';
      default:
        return participantStatus;
    }
  }
  switch (registrantStatus.toUpperCase()) {
    case 'REGISTERED':
      return 'Active';
    case 'DROPPED':
      return 'Dropped';
    case 'WAITLISTED':
      return 'Waitlisted';
    default:
      return waitlistPosition == null ? registrantStatus : 'Waitlisted';
  }
}

function mapRegistrations(tournament: RawTournament, names: ReadonlyMap<string, string>, finalRound: RoundRef | null): EventRegistration[] {
  const participantByPlayerId = new Map<string, z.infer<typeof ParticipantSchema>>();
  for (const participant of tournament.tournamentParticipants) {
    if (participant.player?.id) participantByPlayerId.set(participant.player.id, participant);
  }
  const standingsByTeamId = new Map<string, RawStanding>();
  if (finalRound && deriveDisplayStatus(tournament, flattenRounds(tournament)) === 'complete') {
    for (const standing of finalRound.raw.endOfRoundStandings) standingsByTeamId.set(standing.esportsTeamId, standing);
  }
  const seen = new Set<string>();
  const output: EventRegistration[] = [];
  for (const registrant of tournament.tournamentRegistrants) {
    const playerId = registrant.player?.id;
    if (!playerId) continue;
    if (seen.has(playerId)) {
      throw new ApiResponseError('PlayRiftbound', 502, 'The public roster contains a duplicate player identity.');
    }
    seen.add(playerId);
    const participant = participantByPlayerId.get(playerId);
    const standing = participant?.esportsTeamId ? standingsByTeamId.get(participant.esportsTeamId) : undefined;
    output.push({
      id: playerId,
      name: names.get(playerId) ?? formatPlayerName(registrant.player) ?? 'Unknown player',
      status: registrationStatus(registrant.status, participant?.status, registrant.waitlistPosition),
      profileImageUrl: null,
      matchesWon: standing?.matchWins ?? 0,
      matchesLost: standing?.matchLosses ?? 0,
      matchesDrawn: standing?.matchDraws ?? 0,
      isGuest: false,
      finalPlaceInStandings: standing?.rank ?? null,
    });
  }
  return output;
}

function tallyGameOutcomes(match: RawMatch, teamIds: readonly [string, string]): {
  readonly score1: number | null;
  readonly score2: number | null;
  readonly gamesDrawn: number;
} {
  let score1 = 0;
  let score2 = 0;
  let hasOutcome = false;
  let gamesDrawn = 0;
  for (const game of match.games) {
    const outcomes = new Map((game.teamOutcomes ?? []).map((outcome) => [outcome.esportsTeamId, outcome.outcome.toUpperCase()]));
    const first = outcomes.get(teamIds[0]);
    const second = outcomes.get(teamIds[1]);
    if (first === 'WIN') {
      score1++;
      hasOutcome = true;
    }
    if (second === 'WIN') {
      score2++;
      hasOutcome = true;
    }
    if (first === 'TIE' && second === 'TIE') {
      gamesDrawn++;
      hasOutcome = true;
    }
  }
  return {
    score1: hasOutcome ? score1 : null,
    score2: hasOutcome ? score2 : null,
    gamesDrawn,
  };
}

function mapMatch(
  match: RawMatch,
  round: RawRound,
  names: ReadonlyMap<string, string>,
): EventPairing | null {
  const teams = match.teams;
  if (!teams || teams.length !== 2) return null;
  const firstTeam = teams[0];
  const secondTeam = teams[1];
  if (!firstTeam?.esportsTeamId || !secondTeam?.esportsTeamId) return null;
  const firstPlayer = firstTeam.players?.[0];
  const secondPlayer = secondTeam.players?.[0];
  if (!firstPlayer?.id || !secondPlayer?.id) return null;
  const player1 = names.get(firstPlayer.id) ?? formatPlayerName(firstPlayer) ?? 'Unknown player';
  const player2 = names.get(secondPlayer.id) ?? formatPlayerName(secondPlayer) ?? 'Unknown player';

  const outcomes = new Map((match.teamOutcomes ?? []).map((outcome) => [outcome.esportsTeamId, outcome.outcome.toUpperCase()]));
  const firstOutcome = outcomes.get(firstTeam.esportsTeamId);
  const secondOutcome = outcomes.get(secondTeam.esportsTeamId);
  let winnerId: string | null = null;
  let winner: string | null = null;
  let outcome: EventPairing['outcome'];
  if (firstOutcome === 'WIN' && (secondOutcome === 'LOSS' || secondOutcome === 'FORFEIT')) {
    winnerId = firstPlayer.id;
    winner = player1;
    outcome = 'win';
  } else if (secondOutcome === 'WIN' && (firstOutcome === 'LOSS' || firstOutcome === 'FORFEIT')) {
    winnerId = secondPlayer.id;
    winner = player2;
    outcome = 'win';
  } else if (firstOutcome === 'TIE' && secondOutcome === 'TIE') {
    outcome = 'draw';
  } else if ((match.teamOutcomes?.length ?? 0) > 0) {
    // Match-level outcomes are authoritative when present, even if Riot has
    // published only one side or a new/contradictory outcome token. Falling
    // back to games here could turn an incomplete contract response into a
    // false winner.
    outcome = 'unavailable';
  } else if (round.status.toUpperCase() === 'FINALIZED') {
    const gameTally = tallyGameOutcomes(match, [firstTeam.esportsTeamId, secondTeam.esportsTeamId]);
    if (gameTally.score1 != null && gameTally.score1 > (gameTally.score2 ?? 0)) {
      winnerId = firstPlayer.id;
      winner = player1;
      outcome = 'win';
    } else if (gameTally.score2 != null && gameTally.score2 > (gameTally.score1 ?? 0)) {
      winnerId = secondPlayer.id;
      winner = player2;
      outcome = 'win';
    } else if (gameTally.gamesDrawn > 0 && gameTally.score1 === gameTally.score2) {
      outcome = 'draw';
    } else {
      outcome = 'unavailable';
    }
  } else {
    outcome = 'pending';
  }

  const gameTally = tallyGameOutcomes(match, [firstTeam.esportsTeamId, secondTeam.esportsTeamId]);
  return {
    tableNumber: match.tableNumber ?? 0,
    player1,
    player2,
    player1Id: firstPlayer.id,
    player2Id: secondPlayer.id,
    winnerId,
    score1: gameTally.score1,
    score2: gameTally.score2,
    isBye: false,
    status: match.status,
    outcome,
    winner,
    drawType: null,
    gamesDrawn: gameTally.gamesDrawn,
  };
}

function mapByes(
  round: RawRound,
  tournament: RawTournament,
  names: ReadonlyMap<string, string>,
): EventPairing[] {
  const playerByTeamId = new Map<string, RawPlayer>();
  for (const participant of tournament.tournamentParticipants) {
    if (participant.esportsTeamId && participant.player?.id) {
      playerByTeamId.set(participant.esportsTeamId, participant.player);
    }
  }
  return round.byeTeamIds.flatMap((teamId) => {
    const player = playerByTeamId.get(teamId);
    if (!player?.id) return [];
    const name = names.get(player.id) ?? formatPlayerName(player) ?? 'Unknown player';
    return [{
      tableNumber: 0,
      player1: name,
      player2: '',
      player1Id: player.id,
      score1: null,
      score2: null,
      isBye: true,
      status: round.status,
      outcome: 'bye' as const,
      winner: name,
      winnerId: player.id,
      drawType: null,
      gamesDrawn: 0,
    }];
  });
}

function mapRoundPairings(round: RoundRef, tournament: RawTournament, names: ReadonlyMap<string, string>, trackingSupported: boolean): EventPairing[] {
  if (!trackingSupported) return [];
  const matches = round.raw.matches.flatMap((match) => {
    const pairing = mapMatch(match, round.raw, names);
    return pairing ? [pairing] : [];
  });
  return [...matches, ...mapByes(round.raw, tournament, names)];
}

function findRound(rounds: readonly RoundRef[], parsed: ParsedRoundId): RoundRef | undefined {
  return rounds.find((round) =>
    round.stage.esportsStageId === parsed.stageId &&
    round.section.esportsSectionId === parsed.sectionId &&
    round.raw.roundNumber === parsed.roundNumber,
  );
}

function validateLocation(location: EventLocation): { latitude: number; longitude: number; distanceMeters: number } {
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Latitude must be between -90 and 90.');
  }
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Longitude must be between -180 and 180.');
  }
  if (!Number.isFinite(location.numMiles) || location.numMiles <= 0 || location.numMiles > MAX_SEARCH_MILES) {
    throw new ApiResponseError('PlayRiftbound', 400, `Search radius must be greater than 0 and no more than ${MAX_SEARCH_MILES} miles.`);
  }
  const distanceMeters = Math.round(location.numMiles * 1609.344);
  if (distanceMeters < 1 || distanceMeters > 160_934) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Search radius is outside the supported range.');
  }
  return { latitude: location.latitude, longitude: location.longitude, distanceMeters };
}

function validateDateWindow(startAfter: Date, startBefore: Date): void {
  if (!Number.isFinite(startAfter.getTime()) || !Number.isFinite(startBefore.getTime()) || startAfter > startBefore) {
    throw new ApiResponseError('PlayRiftbound', 400, 'Invalid event date window.');
  }
}

function findPersistedHash(source: string, operationName: string): string | null {
  const normalized = source.replace(/\\\//g, '/').replace(/\\+"/g, '"');
  const operation = escapeRegExp(operationName);
  const patterns = [
    new RegExp(`"id"\\s*:\\s*"([a-f0-9]{64})"\\s*,\\s*"name"\\s*:\\s*"${operation}"`),
    new RegExp(`id\\?"?\\s*:\\s*\\?"([a-f0-9]{64})\\?"?\\s*,\\s*name\\?"?\\s*:\\s*\\?"${operation}\\?"?`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractBundleUrls(source: string, baseUrl: string): string[] {
  const normalized = source.replace(/\\\//g, '/');
  const found = normalized.match(/(?:https?:\/\/[^"'\\\s]+)?\/_next\/static\/chunks\/[^"'\\\s]+?\.js(?:\?[^"'\\\s]*)?/g) ?? [];
  const loaderRelative = [...normalized.matchAll(/(?:^|[\s"'`(])(?:\.\/)?static\/chunks\/([^"'`\\\s)]+?\.js)(?:\?[^"'`\\\s)]*)?/g)]
    .map((match) => `/_next/static/chunks/${match[1]}`);
  const output = new Set<string>();
  const origin = new URL(baseUrl).origin;
  for (const candidate of [...found, ...loaderRelative]) {
    try {
      const url = new URL(candidate, origin);
      if (url.origin === origin && url.pathname.startsWith('/_next/static/chunks/') && url.pathname.endsWith('.js')) {
        output.add(url.toString());
      }
    } catch {
      // Ignore malformed bundle references from the public page.
    }
  }
  return [...output];
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ApiResponseError('PlayRiftbound', 502, 'Public discovery response exceeded the size limit.');
    }
    return text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel();
        throw new ApiResponseError('PlayRiftbound', 502, 'Public discovery response exceeded the size limit.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export class PlayRiftboundAdapter implements IEventRepository, IEventListingRepository {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly hashes: Record<OperationName, string>;
  private readonly hashRecoveryRequests = new Map<OperationName, Promise<string>>();
  private readonly tournamentCache = new Map<string, CacheEntry<RawTournament | null>>();
  private readonly organizerCache = new Map<string, CacheEntry<RawOrganizer>>();
  private readonly tournamentRequests = new Map<string, Promise<RawTournament | null>>();
  private readonly organizerRequests = new Map<string, Promise<RawOrganizer>>();

  constructor(options: PlayRiftboundAdapterOptions) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL).origin;
    this.timeoutMs = options.timeoutMs;
    this.retryAttempts = options.retryAttempts;
    this.hashes = { ...INITIAL_HASHES };
  }

  async getEvents(startAfter: Date, startBefore: Date, location: EventLocation): Promise<EventListing[]> {
    validateDateWindow(startAfter, startBefore);
    const coords = validateLocation(location);
    const allNodes: z.infer<typeof SearchNodeSchema>[] = [];
    const seenCursors = new Set<string>();
    let after: string | null = null;
    let pageCount = 0;
    let hasMorePages = false;
    let previousStart = Number.NEGATIVE_INFINITY;
    let reachedUpperBound = false;
    const startUpper = startBefore.getTime();

    while (pageCount < MAX_SEARCH_PAGES) {
      const variables: Record<string, unknown> = {
        sport: 'rb',
        first: SEARCH_PAGE_SIZE,
        filter: {
          rb: {
            coords: { latitude: coords.latitude, longitude: coords.longitude },
            startDate: startAfter.toISOString(),
            distanceMeters: coords.distanceMeters,
          },
        },
        sortBy: { rb: 'DATE' },
      };
      if (after != null) variables.after = after;

      const data = await this.graphqlData('CompeteTournamentSearch', variables);
      const parsed = this.parse(SearchDataSchema, data, 'CompeteTournamentSearch');
      const connection = parsed.competeTournamentSearch;
      for (const edge of connection.edges) {
        const start = parseIsoDate(edge.node.tournament.startsAt, 'start').getTime();
        if (start < previousStart) {
          throw new ApiResponseError('PlayRiftbound', 502, 'Search results were not ordered by event start time.');
        }
        previousStart = start;
        allNodes.push(edge.node);
        if (start > startUpper) reachedUpperBound = true;
      }
      pageCount++;
      // The public operation supports a lower-bound date and ascending DATE
      // order, but not an upper-bound variable. Once a full page reaches the
      // upper bound, validate that page's ordering and stop; later pages can
      // only contain out-of-window events.
      if (reachedUpperBound) {
        hasMorePages = false;
        break;
      }
      if (!connection.pageInfo.hasNextPage) {
        hasMorePages = false;
        break;
      }

      hasMorePages = true;
      const nextCursor = connection.pageInfo.endCursor;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new ApiResponseError('PlayRiftbound', 502, 'Search pagination returned a missing or repeated cursor.');
      }
      seenCursors.add(nextCursor);
      after = nextCursor;
    }

    if (pageCount === MAX_SEARCH_PAGES && hasMorePages) {
      throw new ApiResponseError('PlayRiftbound', 502, 'Search pagination exceeded the safe page limit.');
    }

    const startLower = startAfter.getTime();
    const unique = new Map<string, EventListing>();
    for (const node of allNodes) {
      if (node.__typename !== 'RbTournamentSearchResult') {
        throw new ApiResponseError('PlayRiftbound', 502, `Unsupported search result type: ${node.__typename}`);
      }
      const start = parseIsoDate(node.tournament.startsAt, 'start').getTime();
      if (start < startLower || start > startUpper) continue;
      const listing = mapSearchNodeToListing(node);
      unique.set(String(listing.id), listing);
    }
    return [...unique.values()].sort((left, right) =>
      left.startDatetime.localeCompare(right.startDatetime) || String(left.id).localeCompare(String(right.id)),
    );
  }

  async getEventById(id: EventId, _location: EventLocation): Promise<Event | null> {
    const rawId = parseEventRawId(id);
    const tournament = await this.getTournament(rawId);
    if (tournament == null) return null;
    const organizer = await this.getOrganizer(tournament.organizerId);
    const rounds = flattenRounds(tournament);
    return mapTournamentToEvent(tournament, organizer, rounds);
  }

  async getEventRegistrations(id: EventId, _location: EventLocation): Promise<EventRegistration[]> {
    const rawId = parseEventRawId(id);
    const tournament = await this.getTournament(rawId);
    if (tournament == null) return [];
    const rounds = flattenRounds(tournament);
    const finalRound = [...rounds].reverse().find((round) => isFinalized(round.raw) && round.raw.endOfRoundStandings.length > 0) ?? null;
    return mapRegistrations(tournament, playerNameLookup(tournament), finalRound);
  }

  async getEventDetail(
    id: EventId,
    _location: EventLocation,
    options?: { fresh?: boolean },
  ): Promise<EventDetail | null> {
    const rawId = parseEventRawId(id);
    const fresh = options?.fresh === true;
    const tournament = await this.getTournament(rawId, fresh);
    if (tournament == null) return null;

    const organizer = await this.getOrganizer(tournament.organizerId, fresh);
    const rounds = flattenRounds(tournament);
    const trackingSupported = isTrackingSupported(tournament, rounds);
    const event = mapTournamentToEvent(tournament, organizer, rounds);
    const currentRound = selectCurrentRound(rounds);
    const standingsRound = trackingSupported && currentRound ? selectStandingsRound(rounds, currentRound) : null;
    const names = playerNameLookup(tournament);
    const finalRound = [...rounds].reverse().find((round) => isFinalized(round.raw) && round.raw.endOfRoundStandings.length > 0) ?? null;
    const registrations = mapRegistrations(tournament, names, finalRound);
    const pairings = currentRound
      ? mapRoundPairings(currentRound, tournament, names, trackingSupported)
      : [];
    const standings = standingsRound && trackingSupported ? mapStandings(standingsRound, tournament, names) : [];

    return {
      event,
      currentRound: currentRound?.summary ?? null,
      registrations,
      pairings,
      standings,
      fetchedAt: new Date().toISOString(),
      ...(standingsRound ? {
        standingsRoundNumber: standingsRound.raw.roundNumber,
        standingsRoundId: standingsRound.id,
      } : {}),
    };
  }

  async getEventMatches(roundId: RoundId): Promise<EventPairing[]> {
    const parsedId = parseRoundId(roundId);
    const tournament = await this.getTournament(parsedId.eventId);
    if (tournament == null) return [];
    const rounds = flattenRounds(tournament);
    const round = findRound(rounds, parsedId);
    if (!round) throw new ApiResponseError('PlayRiftbound', 404, 'The requested Riot round was not found.');
    const names = playerNameLookup(tournament);
    return mapRoundPairings(round, tournament, names, isTrackingSupported(tournament, rounds));
  }

  async getEventStandings(roundId: RoundId): Promise<EventStanding[]> {
    const parsedId = parseRoundId(roundId);
    const tournament = await this.getTournament(parsedId.eventId);
    if (tournament == null) return [];
    const rounds = flattenRounds(tournament);
    const round = findRound(rounds, parsedId);
    if (!round) throw new ApiResponseError('PlayRiftbound', 404, 'The requested Riot round was not found.');
    if (!isTrackingSupported(tournament, rounds)) return [];
    return round.raw.endOfRoundStandings.length > 0
      ? mapStandings(round, tournament, playerNameLookup(tournament))
      : [];
  }

  private async getTournament(rawId: string, fresh = false): Promise<RawTournament | null> {
    const cacheKey = rawId;
    const requestKey = `${fresh ? 'fresh:' : 'cached:'}${rawId}`;
    if (!fresh) {
      const cached = this.tournamentCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      if (cached) this.tournamentCache.delete(cacheKey);
    }
    const inFlight = this.tournamentRequests.get(requestKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const data = await this.graphqlData('GetCompeteTournamentForRiftboundPlayer', { tournamentId: rawId });
      const parsed = this.parse(TournamentDataSchema, data, 'GetCompeteTournamentForRiftboundPlayer');
      if (parsed.competeTournaments.length === 0) return null;
      if (parsed.competeTournaments.length !== 1) {
        throw new ApiResponseError('PlayRiftbound', 502, 'Tournament lookup returned an unexpected number of records.');
      }
      const tournament = parsed.competeTournaments[0]!;
      if (tournament.id !== rawId) {
        throw new ApiResponseError('PlayRiftbound', 502, 'Tournament lookup returned a different event ID.');
      }
      return tournament;
    })();
    this.tournamentRequests.set(requestKey, request);
    try {
      const value = await request;
      if (!fresh) {
        this.pruneCache(this.tournamentCache);
        this.tournamentCache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return value;
    } finally {
      this.tournamentRequests.delete(requestKey);
    }
  }

  private async getOrganizer(id: string, fresh = false): Promise<RawOrganizer> {
    if (!fresh) {
      const cached = this.organizerCache.get(id);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      if (cached) this.organizerCache.delete(id);
    }
    const requestKey = `${fresh ? 'fresh:' : 'cached:'}${id}`;
    const inFlight = this.organizerRequests.get(requestKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const data = await this.graphqlData('OrganizerSummary', { id });
      const parsed = this.parse(OrganizerDataSchema, data, 'OrganizerSummary');
      const organizer = parsed.organizerSummary;
      if (!organizer) {
        throw new ApiResponseError('PlayRiftbound', 502, 'Organizer summary is missing from the public response.');
      }
      if (organizer.id !== id) {
        throw new ApiResponseError('PlayRiftbound', 502, 'Organizer lookup returned a different organizer ID.');
      }
      return organizer;
    })();
    this.organizerRequests.set(requestKey, request);
    try {
      const value = await request;
      if (!fresh) {
        this.pruneCache(this.organizerCache);
        this.organizerCache.set(id, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return value;
    } finally {
      this.organizerRequests.delete(requestKey);
    }
  }

  private async graphqlData(operationName: OperationName, variables: Record<string, unknown>): Promise<unknown> {
    const hash = this.hashes[operationName];
    const first = await this.postGraphql(operationName, variables, hash);
    if (!first.hashError) return first.data;

    const discoveredHash = this.hashes[operationName] !== hash
      ? this.hashes[operationName]
      : await this.recoverPersistedHash(operationName);
    this.hashes[operationName] = discoveredHash;
    const second = await this.postGraphql(operationName, variables, discoveredHash);
    if (second.hashError) {
      throw new ApiResponseError('PlayRiftbound', 502, `The public persisted query for ${operationName} is no longer accepted.`);
    }
    return second.data;
  }

  private async postGraphql(
    operationName: OperationName,
    variables: Record<string, unknown>,
    hash: string,
  ): Promise<{ readonly data: unknown; readonly hashError: false } | { readonly data: null; readonly hashError: true }> {
    const url = new URL(API_PATH, this.baseUrl).toString();
    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        method: 'POST',
        timeout: this.timeoutMs,
        retries: this.retryAttempts,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'apollographql-client-name': CLIENT_NAME,
          'apollographql-client-version': CLIENT_VERSION,
        },
        body: JSON.stringify({
          operationName,
          variables,
          extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
        }),
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new ApiTimeoutError('PlayRiftbound');
    }

    const json: unknown = await response.json().catch(() => null);
    if (json != null) {
      const envelopeResult = GraphqlEnvelopeSchema.safeParse(json);
      if (envelopeResult.success) {
        const envelope = envelopeResult.data;
        if (envelope.errors?.length) {
          if (isPersistedHashError(envelope.errors)) return { data: null, hashError: true };
          const error = envelope.errors[0];
          const code = error ? getGraphqlErrorCode(error) : '';
          throw new ApiResponseError('PlayRiftbound', response.status || 502, `GraphQL ${code || 'error'}: ${error?.message ?? 'request failed'}`);
        }
        if (!response.ok) throw new ApiResponseError('PlayRiftbound', response.status);
        if (!('data' in envelope)) {
          throw new ApiResponseError('PlayRiftbound', 502, 'GraphQL response did not include data.');
        }
        return { data: envelope.data, hashError: false };
      }
    }

    if (!response.ok) throw new ApiResponseError('PlayRiftbound', response.status);
    throw new ApiResponseError('PlayRiftbound', 502, 'GraphQL response was not valid JSON.');
  }

  private parse<T>(schema: z.ZodType<T>, data: unknown, operationName: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      const details = result.error.message.slice(0, 240);
      throw new ApiResponseError('PlayRiftbound', 502, `Invalid ${operationName} response: ${details}`);
    }
    return result.data;
  }

  private async recoverPersistedHash(operationName: OperationName): Promise<string> {
    let request = this.hashRecoveryRequests.get(operationName);
    if (!request) {
      request = this.discoverPersistedHash(operationName);
      this.hashRecoveryRequests.set(operationName, request);
    }
    try {
      return await request;
    } finally {
      if (this.hashRecoveryRequests.get(operationName) === request) {
        this.hashRecoveryRequests.delete(operationName);
      }
    }
  }

  private async discoverPersistedHash(operationName: OperationName): Promise<string> {
    const pageUrl = new URL('/en-US/events/', this.baseUrl).toString();
    const html = await this.getDiscoveryText(pageUrl, 'text/html');
    const seen = new Set<string>();
    let pending = extractBundleUrls(html, this.baseUrl);
    let checked = 0;
    let depth = 0;
    while (pending.length > 0 && checked < MAX_DISCOVERY_BUNDLES && depth < 3) {
      const level = pending.filter((url) => !seen.has(url)).slice(0, MAX_DISCOVERY_BUNDLES - checked);
      if (level.length === 0) break;
      for (const url of level) seen.add(url);
      checked += level.length;
      const next = new Set<string>();
      for (let offset = 0; offset < level.length; offset += 5) {
        const batch = level.slice(offset, offset + 5);
        const results = await Promise.all(batch.map(async (url) => {
          try {
            return { url, body: await this.getDiscoveryText(url, 'application/javascript') };
          } catch {
            return { url, body: null };
          }
        }));
        for (const result of results) {
          if (!result.body) continue;
          const hash = findPersistedHash(result.body, operationName);
          if (hash) {
            // One manifest contains several operations. Cache all recognized
            // IDs so another operation does not repeat the same discovery.
            for (const name of Object.keys(INITIAL_HASHES) as OperationName[]) {
              const discovered = findPersistedHash(result.body, name);
              if (discovered) this.hashes[name] = discovered;
            }
            return hash;
          }
          for (const nested of extractBundleUrls(result.body, this.baseUrl)) {
            if (!seen.has(nested)) next.add(nested);
          }
        }
      }
      pending = [...next];
      depth++;
    }
    throw new ApiResponseError('PlayRiftbound', 502, `Could not discover the current public query hash for ${operationName}.`);
  }

  private async getDiscoveryText(url: string, accept: string): Promise<string> {
    let response: Response;
    try {
      response = await fetchWithRetry(url, {
        timeout: this.timeoutMs,
        retries: this.retryAttempts,
        headers: { Accept: accept },
      });
    } catch {
      throw new ApiTimeoutError('PlayRiftbound');
    }
    if (!response.ok) throw new ApiResponseError('PlayRiftbound', response.status);
    return readLimitedText(response, accept === 'text/html' ? 2_000_000 : 8_000_000);
  }

  private pruneCache<T>(cache: Map<string, CacheEntry<T>>): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= MAX_CACHE_SIZE) {
      const first = cache.keys().next().value;
      if (first === undefined) break;
      cache.delete(first);
    }
  }
}
