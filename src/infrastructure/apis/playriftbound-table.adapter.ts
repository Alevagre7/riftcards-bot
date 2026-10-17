import { Event, EventRoundSummary } from '../../core/entities/event.js';
import { EventDetail, EventPairing, EventStanding } from '../../core/entities/event-detail.js';
import { EventId } from '../../core/entities/event-id.js';
import { EventRegistration } from '../../core/entities/event-registration.js';
import { NexusTable } from '../../core/entities/nexus-table.js';
import { MytableLookupError } from '../../core/errors/index.js';
import { IEventListingRepository } from '../../core/ports/event-listing-repository.js';
import { EventLocation, IEventRepository } from '../../core/ports/event-repository.js';
import {
  GetNexusTableOptions,
  INexusTableRepository,
} from '../../core/ports/nexus-table-repository.js';
import { kmToMiles } from '../../utils/units.js';

const STORE_SEARCH_RADIUS_KM = 1;

interface PlayRiftboundTableAdapterOptions {
  readonly eventRepository: IEventRepository;
  readonly eventListingRepository: IEventListingRepository;
  /** Injectable clock for deterministic local-day boundaries in tests. */
  readonly now?: () => Date;
}

interface LocalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface Candidate {
  readonly detail: EventDetail;
  readonly registration: EventRegistration;
}

function localDateParts(date: Date, timezone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get('year'));
  const month = Number(values.get('month'));
  const day = Number(values.get('day'));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new MytableLookupError(`Could not determine today's date in ${timezone}.`);
  }
  return { year, month, day };
}

/** Convert a wall-clock time in an IANA zone to UTC, correcting across DST. */
function zonedTimeToUtc(parts: LocalDateParts, timezone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (let attempt = 0; attempt < 4; attempt++) {
    const values = new Map(
      formatter.formatToParts(new Date(guess)).map((part) => [part.type, Number(part.value)]),
    );
    const represented = Date.UTC(
      values.get('year') ?? 0,
      (values.get('month') ?? 1) - 1,
      values.get('day') ?? 1,
      values.get('hour') ?? 0,
      values.get('minute') ?? 0,
      values.get('second') ?? 0,
    );
    const correction = target - represented;
    if (correction === 0) break;
    guess += correction;
  }
  return new Date(guess);
}

function nextLocalDate(parts: LocalDateParts): LocalDateParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function localDayWindow(now: Date, timezone: string): { start: Date; end: Date } {
  const today = localDateParts(now, timezone);
  return {
    start: zonedTimeToUtc(today, timezone),
    end: zonedTimeToUtc(nextLocalDate(today), timezone),
  };
}

function isWithinWindow(value: string, start: Date, end: Date): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function normalizeName(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

function gameName(value: string): string {
  const separator = value.indexOf('#');
  return separator === -1 ? value : value.slice(0, separator);
}

function matchesName(query: string, registeredName: string): boolean {
  const normalizedQuery = normalizeName(query);
  const normalizedRegistered = normalizeName(registeredName);
  if (normalizedQuery.includes('#')) return normalizedRegistered === normalizedQuery;
  return normalizeName(gameName(registeredName)) === normalizedQuery;
}

function stablePlayerId(registration: EventRegistration): string | null {
  // The official Riot mapper uses EventRegistration.id for the player UUID.
  return typeof registration.id === 'string' ? registration.id : null;
}

function outcomeForPlayer(pairing: EventPairing, playerId: string):
  | 'win'
  | 'loss'
  | 'draw'
  | 'bye'
  | null {
  if (pairing.isBye || pairing.outcome === 'bye') return 'bye';
  if (pairing.outcome === 'draw') return 'draw';
  if (pairing.winnerId != null) {
    if (pairing.winnerId === playerId) return 'win';
    if (pairing.winnerId === pairing.player1Id || pairing.winnerId === pairing.player2Id) {
      return 'loss';
    }
  }
  return null;
}

function roundStatus(round: EventRoundSummary | null): 'pending' | 'inProgress' | 'completed' | null {
  if (round == null) return null;
  switch (round.status.toUpperCase()) {
    case 'IN_PROGRESS':
      return 'inProgress';
    case 'COMPLETE':
      return 'completed';
    default:
      return 'pending';
  }
}

function findPairing(detail: EventDetail, playerId: string): EventPairing | null {
  const matching = detail.pairings.filter(
    (pairing) => pairing.player1Id === playerId || pairing.player2Id === playerId,
  );
  if (matching.length > 1) {
    throw new MytableLookupError(
      `Riot returned more than one pairing for the same player in ${detail.event.name}. The result is ambiguous.`,
    );
  }
  return matching[0] ?? null;
}

function findStanding(detail: EventDetail, playerId: string): EventStanding | null {
  return detail.standings.find((standing) => standing.playerId === playerId) ?? null;
}

function parseRecord(record: string | null | undefined): { wins: number; losses: number; draws: number } | null {
  if (record == null) return null;
  const match = /^(\d+)-(\d+)-(\d+)$/.exec(record.trim());
  if (!match) return null;
  return {
    wins: Number(match[1]),
    losses: Number(match[2]),
    draws: Number(match[3]),
  };
}

function blankTable(username: string): NexusTable {
  return {
    username,
    event: null,
    round: null,
    tableNumber: null,
    opponent: null,
    standings: null,
    record: { wins: 0, losses: 0, draws: 0 },
    status: { active: false, inProgress: false },
    fetchedAt: new Date().toISOString(),
  };
}

function officialEventUrl(event: Event): string {
  if (event.locatorUrl) return event.locatorUrl;
  const id = typeof event.id === 'string' ? event.id.replace(/^riot:/, '') : String(event.id);
  return `https://events.playriftbound.com/en-US/events/${encodeURIComponent(id)}`;
}

function buildTable(
  username: string,
  storeTimezone: string,
  candidate: Candidate,
  playerId: string,
): NexusTable {
  const { detail, registration } = candidate;
  const event = detail.event;
  const pairing = findPairing(detail, playerId);
  const standing = findStanding(detail, playerId);
  const playerIsFirst = pairing?.player1Id === playerId;
  const opponentName = pairing == null || pairing.isBye
    ? null
    : playerIsFirst
      ? pairing.player2
      : pairing.player1;
  const opponentScore = pairing == null
    ? null
    : playerIsFirst
      ? pairing.score2
      : pairing.score1;
  const record = parseRecord(standing?.matchRecord) ?? {
    wins: registration.matchesWon,
    losses: registration.matchesLost,
    draws: registration.matchesDrawn,
  };
  const round = detail.currentRound;
  const currentRoundStatus = roundStatus(round);
  const result = pairing ? outcomeForPlayer(pairing, playerId) : null;

  return {
    username,
    event: {
      id: String(event.id),
      name: event.name,
      store: {
        id: String(event.store.id),
        name: event.store.name,
        address: event.store.fullAddress,
        timezone: storeTimezone,
      },
      startDate: new Date(event.startDatetime),
      format: event.gameplayFormatName,
      locatorUrl: officialEventUrl(event),
    },
    round: round == null
      ? null
      : {
          number: round.roundNumber,
          label: `Round ${round.roundNumber}`,
          status: currentRoundStatus ?? 'pending',
          result,
        },
    tableNumber: pairing?.isBye ? null : pairing?.tableNumber ?? null,
    opponent: opponentName == null || opponentName === ''
      ? null
      : { name: opponentName, score: opponentScore },
    standings: standing == null
      ? null
      : {
          rank: standing.rank,
          points: standing.points,
          ...record,
        },
    record,
    status: {
      active: round != null,
      inProgress: currentRoundStatus === 'inProgress',
    },
    fetchedAt: detail.fetchedAt,
  };
}

function eventIsForStore(event: Event, organizerId: string): boolean {
  return String(event.store.id) === organizerId;
}

function isSupported(event: Event): boolean {
  return event.supportsTracking !== false;
}

function describeEventCandidates(candidates: readonly Candidate[]): string {
  return candidates
    .map(({ detail }) => `${detail.event.name}: ${officialEventUrl(detail.event)}`)
    .join('; ');
}

export class PlayRiftboundTableAdapter implements INexusTableRepository {
  private readonly eventRepository: IEventRepository;
  private readonly eventListingRepository: IEventListingRepository;
  private readonly now: () => Date;

  constructor(options: PlayRiftboundTableAdapterOptions) {
    this.eventRepository = options.eventRepository;
    this.eventListingRepository = options.eventListingRepository;
    this.now = options.now ?? (() => new Date());
  }

  async getTable(options: GetNexusTableOptions): Promise<NexusTable> {
    const { username, store } = options;
    const { start, end } = localDayWindow(this.now(), store.timezone);
    const location: EventLocation = {
      latitude: store.latitude,
      longitude: store.longitude,
      numMiles: kmToMiles(STORE_SEARCH_RADIUS_KM),
    };

    const eventIds = options.eventId == null
      ? await this.listCandidateEventIds(start, end, location)
      : [options.eventId];
    const details: Array<EventDetail | null> = [];
    for (let offset = 0; offset < eventIds.length; offset += 4) {
      const batch = eventIds.slice(offset, offset + 4);
      details.push(
        ...(await Promise.all(
          batch.map((id) => this.eventRepository.getEventDetail(id, location, { fresh: true })),
        )),
      );
    }
    const sameStoreDetails = details.filter(
      (detail): detail is EventDetail =>
        detail != null && eventIsForStore(detail.event, store.organizerId),
    );
    if (sameStoreDetails.length > 0 && sameStoreDetails.every(({ event }) => !isSupported(event))) {
      throw new MytableLookupError(
        `The event at ${store.name} uses a team format. /mytable currently supports 1v1 events.`,
      );
    }
    const storeDetails = sameStoreDetails.filter(({ event }) => isSupported(event));

    const namedRegistrations = storeDetails.flatMap((detail) =>
      detail.registrations
        .filter((registration) => matchesName(username, registration.name))
        .map((registration) => ({ detail, registration })),
    );
    if (namedRegistrations.length === 0) return blankTable(username);

    const byPlayerId = new Map<string, Candidate>();
    const missingIds: string[] = [];
    for (const candidate of namedRegistrations) {
      const id = stablePlayerId(candidate.registration);
      if (id == null) {
        missingIds.push(candidate.registration.name);
        continue;
      }
      byPlayerId.set(id, candidate);
    }

    if (missingIds.length > 0) {
      throw new MytableLookupError(
        `Riot did not provide a stable player ID for ${missingIds.join(', ')}. Try again when the event roster is available.`,
      );
    }
    if (byPlayerId.size > 1) {
      const names = [...new Set(namedRegistrations.map(({ registration }) => registration.name))];
      throw new MytableLookupError(
        `Several players match "${username}" at ${store.name}: ${names.join(', ')}. Use the exact Riot ID, including #tag, such as /mytable Name#TAG.`,
      );
    }

    const [playerId, candidate] = [...byPlayerId.entries()][0] ?? [];
    if (!playerId || !candidate) return blankTable(username);

    const candidatesForPlayer = namedRegistrations.filter(
      ({ registration }) => stablePlayerId(registration) === playerId,
    );
    const activeCandidates = candidatesForPlayer.filter(({ detail }) =>
      detail.event.displayStatus === 'inProgress' || detail.currentRound?.status === 'IN_PROGRESS',
    );
    if (activeCandidates.length === 1) {
      return buildTable(username, store.timezone, activeCandidates[0]!, playerId);
    }
    if (activeCandidates.length > 1) {
      throw new MytableLookupError(
        `More than one active event at ${store.name} has a pairing for ${candidate.registration.name}: ${describeEventCandidates(activeCandidates)}. Use /mytable event <official event URL> to choose one.`,
      );
    }
    if (candidatesForPlayer.length === 1) {
      return buildTable(username, store.timezone, candidatesForPlayer[0]!, playerId);
    }

    throw new MytableLookupError(
      `Several events today at ${store.name} include ${candidate.registration.name}: ${describeEventCandidates(candidatesForPlayer)}. Use /mytable event <official event URL> to choose one.`,
    );
  }

  private async listCandidateEventIds(start: Date, end: Date, location: EventLocation): Promise<EventId[]> {
    const listings = await this.eventListingRepository.getEvents(start, end, location);
    const ids: EventId[] = [];
    const seen = new Set<string>();
    for (const listing of listings) {
      if (!isWithinWindow(listing.startDatetime, start, end)) continue;
      const key = String(listing.id);
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(listing.id);
    }
    return ids;
  }
}
