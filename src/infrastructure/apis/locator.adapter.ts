// LocatorHtmlAdapter — parses the Riftbound Locator SSR HTML page
// to extract roster, pairings, standings, and current round data.
//
// The locator is a Next.js app; data is hydrated into the page via
// React Server Component (RSC) flight chunks embedded in
// `self.__next_f.push` script tags. The adapter extracts these
// chunks, decodes the JSON, and navigates the React Query state
// structure to find the actual data.
//
// Known limitation: roster pagination is JS-driven (Next/Previous
// buttons with no href), so we only get the first page's entries.

import * as cheerio from 'cheerio';
import {
  ILocatorRepository,
  LocatorEventData,
  LocatorPairing,
  LocatorRosterEntry,
  LocatorStanding,
} from '../../core/ports/locator-repository.js';
import { ApiResponseError } from '../../core/errors/index.js';
import { fetchWithRetry } from '../../utils/api-client.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface LocatorHtmlAdapterOptions {
  baseUrl: string;
  timeoutMs: number;
  retryAttempts: number;
}

// ---------------------------------------------------------------------------
// Cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: LocatorEventData;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 50;

// ---------------------------------------------------------------------------
// RSC Flight Data Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the `results` array from a React Query dehydrated state embedded
 * in an RSC flight chunk. Navigates:
 *   `state.queries[0].state.data.results`
 *
 * Returns `null` if the structure isn't found or isn't parseable.
 */
function extractQueryResults(unescaped: string): unknown[] | null {
  const stateIdx = unescaped.indexOf('"state"');
  if (stateIdx === -1) return null;

  const braceIdx = unescaped.indexOf('{', stateIdx + 7);
  if (braceIdx === -1) return null;

  let depth = 0;
  let endIdx = braceIdx;
  for (let i = braceIdx; i < unescaped.length; i++) {
    if (unescaped[i] === '{') {
      depth++;
    } else if (unescaped[i] === '}') {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  try {
    // JSON.parse returns any; validated by the Array.isArray guard at the end
    const stateObj = JSON.parse(unescaped.substring(braceIdx, endIdx));
    const queries: unknown = stateObj.queries;
    const query = Array.isArray(queries) && queries.length > 0 ? queries[0] : null;
    const queryState: unknown = query && typeof query === 'object'
      ? (query as Record<string, unknown>).state
      : null;
    const data: unknown = queryState && typeof queryState === 'object'
      ? (queryState as Record<string, unknown>).data
      : null;
    const rawResults: unknown = data && typeof data === 'object'
      ? (data as Record<string, unknown>).results
      : null;
    return Array.isArray(rawResults) ? (rawResults as unknown[]) : null;
  } catch {
    return null;
  }
}

/**
 * Extract RSC data sections (pairings, standings, roster) from the page HTML.
 * Each section is identified by its `data-testid` attribute within the RSC
 * flight payload.
 */
function parseRscSections(html: string): {
  pairings: unknown[] | null;
  standings: unknown[] | null;
  roster: unknown[] | null;
} {
  const result: {
    pairings: unknown[] | null;
    standings: unknown[] | null;
    roster: unknown[] | null;
  } = { pairings: null, standings: null, roster: null };

  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(html)) !== null) {
    try {
      const unescaped = JSON.parse(`"${m[1]!}"`) as string;

      for (const key of ['pairings', 'standings', 'roster'] as const) {
        if (result[key] !== null) continue;

        const testId = `${key}-section`;
        if (!unescaped.includes(`data-testid":"${testId}"`)) continue;

        const data = extractQueryResults(unescaped);
        if (data !== null) {
          result[key] = data;
        }
      }

      // Stop early once we have all three sections
      if (result.pairings !== null && result.standings !== null && result.roster !== null) {
        break;
      }
    } catch {
      // Skip malformed chunks
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// RSC → Entity Builders
// ---------------------------------------------------------------------------

function buildPairingsFromRsc(results: unknown[]): LocatorPairing[] {
  const pairs: LocatorPairing[] = [];

  for (const raw of results) {
    const match = raw as Record<string, unknown>;

    // Skip bye matches (table_number 0 or match_is_bye flag)
    if (match.match_is_bye === true || match.table_number === 0) continue;

    const relationships = match.player_match_relationships as Array<Record<string, unknown>>;
    if (!relationships || relationships.length < 2) continue;

    // Sort by player_order to get deterministic player1/player2
    const sorted = [...relationships].sort(
      (a, b) => (a.player_order as number) - (b.player_order as number),
    );

    const player1 = sorted[0]!.player as Record<string, unknown>;
    const player2 = sorted[1]!.player as Record<string, unknown>;
    const tableNumber = match.table_number as number;
    const status = match.status as string;
    const winningPlayerId = match.winning_player as number | null | undefined;

    let score1: number | null = null;
    let score2: number | null = null;

    // Assign scores only when the match is complete and we know who won
    if (status === 'COMPLETE' && winningPlayerId != null) {
      const winnerScore = match.games_won_by_winner as number | null | undefined;
      const loserScore = match.games_won_by_loser as number | null | undefined;

      if (winningPlayerId === (sorted[0]!.player as Record<string, unknown>).id) {
        score1 = winnerScore ?? null;
        score2 = loserScore ?? null;
      } else {
        score1 = loserScore ?? null;
        score2 = winnerScore ?? null;
      }
    }

    pairs.push({
      tableNumber,
      player1: player1.best_identifier as string,
      player2: player2.best_identifier as string,
      score1,
      score2,
    });
  }

  // Sort by table number ascending
  pairs.sort((a, b) => a.tableNumber - b.tableNumber);

  return pairs;
}

function buildStandingsFromRsc(results: unknown[]): LocatorStanding[] {
  const standings: LocatorStanding[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < results.length; i++) {
    const entry = results[i] as Record<string, unknown>;
    const player = entry.player as Record<string, unknown> | undefined;
    const userEventStatus = entry.user_event_status as Record<string, unknown> | undefined;

    const name = (player?.best_identifier as string | undefined) ?? null;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    standings.push({
      rank: i + 1, // 1-based position in the returned array
      name,
      wins: (userEventStatus?.matches_won as number | null | undefined) ?? null,
      losses: (userEventStatus?.matches_lost as number | null | undefined) ?? null,
    });
  }

  return standings;
}

function buildRosterFromRsc(results: unknown[]): LocatorRosterEntry[] {
  const entries: LocatorRosterEntry[] = [];

  for (const raw of results) {
    const entry = raw as Record<string, unknown>;
    const displayName = entry.best_identifier as string | undefined;
    if (!displayName) continue;

    const registrationStatus = entry.registration_status as string;
    const status = registrationStatus === 'COMPLETE' ? 'Active' : 'Dropped';

    const profileImageUrl = (entry.full_profile_picture_url as string | undefined) ?? null;

    entries.push({ displayName, status, profileImageUrl });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class LocatorHtmlAdapter implements ILocatorRepository {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly cache: Map<number, CacheEntry>;

  constructor(options: LocatorHtmlAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs;
    this.retryAttempts = options.retryAttempts;
    this.cache = new Map();
  }

  async getEventData(eventId: number): Promise<LocatorEventData | null> {
    // Check cache
    const cached = this.cache.get(eventId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const url = `${this.baseUrl}/events/${eventId}`;
    const response = await fetchWithRetry(url, {
      timeout: this.timeoutMs,
      retries: this.retryAttempts,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new ApiResponseError('Locator', response.status);
    }

    const html = await response.text();
    const data = this.parseHtml(eventId, html);

    this.pruneCache();
    this.cache.set(eventId, {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return data;
  }

  // -----------------------------------------------------------------------
  // HTML parsing
  // -----------------------------------------------------------------------

  private parseHtml(eventId: number, html: string): LocatorEventData {
    const $ = cheerio.load(html);

    // The page has two h1 elements: first is event name, second is "Round N"
    const name = $('h1').first().text().trim();

    let currentRound: number | null = null;
    $('h1').each((_, el) => {
      const text = $(el).text().trim();
      const roundMatch = text.match(/Round\s+(\d+)/i);
      if (roundMatch) {
        currentRound = parseInt(roundMatch[1]!, 10);
      }
    });

    // Extract all data sections from RSC flight chunks in one pass
    const sections = parseRscSections(html);

    const roster = sections.roster
      ? buildRosterFromRsc(sections.roster)
      : this.parseRoster($);

    const pairings = sections.pairings
      ? buildPairingsFromRsc(sections.pairings)
      : [];

    const standings = sections.standings
      ? buildStandingsFromRsc(sections.standings)
      : [];

    return {
      eventId,
      name,
      currentRound,
      roster,
      standings,
      pairings,
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Fallback roster parser using cheerio DOM traversal.
   * Used when RSC flight data is not available for the roster section.
   */
  private parseRoster($: cheerio.CheerioAPI): readonly LocatorRosterEntry[] {
    const entries: LocatorRosterEntry[] = [];

    const rosterHeading = $('h2, h3')
      .filter((_, el) => /roster\s*\(\d+\)/i.test($(el).text()))
      .first();
    if (!rosterHeading.length) return entries;

    // h4 elements live inside the same parent div as the heading
    rosterHeading.parent().find('h4').each((_, el) => {
      const displayName = $(el).text().trim();
      if (!displayName) return;

      // Status badge is a sibling of the name card, 3 levels up from h4
      let contextEl = $(el);
      for (let up = 0; up < 4; up++) {
        const parent = contextEl.parent();
        if (!parent.length) break;
        contextEl = parent;
      }
      const contextText = contextEl.text();
      const status = contextText.includes('Dropped') ? 'Dropped' : 'Active';

      const img = $(el).closest('div').find('img').first().attr('src') ?? null;
      let profileImageUrl: string | null = null;
      if (img && !img.startsWith('data:')) {
        profileImageUrl = img.startsWith('http') ? img : `${this.baseUrl}${img}`;
      }

      entries.push({ displayName, status, profileImageUrl });
    });

    return entries;
  }

  // -----------------------------------------------------------------------
  // Cache management
  // -----------------------------------------------------------------------

  private pruneCache(): void {
    if (this.cache.size < MAX_CACHE_SIZE) return;

    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }

    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldest = [...this.cache.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      );
      const toRemove = this.cache.size - MAX_CACHE_SIZE + 10;
      for (let i = 0; i < toRemove && i < oldest.length; i++) {
        this.cache.delete(oldest[i]![0]);
      }
    }
  }
}
