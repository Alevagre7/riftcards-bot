// LocatorHtmlAdapter — parses the Riftbound Locator SSR HTML page
// to extract roster, pairings, and current round data.
//
// The locator is a Next.js app; the page data is rendered into the
// DOM by React Server Components. This adapter extracts it with
// cheerio, using text-based regex for pairings (more robust than
// navigating the complex nested div/span structure) plus a regex
// fallback for scores from the RSC flight data.
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
// Helpers
// ---------------------------------------------------------------------------

/** Parse scores from RSC flight data when present. */
function parseScoresFromFlightData(
  html: string,
): Record<string, { score1: number | null; score2: number | null }> {
  const scores: Record<
    string,
    { score1: number | null; score2: number | null }
  > = {};

  // RSC flight embeds data like:
  //   ...,tableNumber:1,player1:"Name1",player2:"Name2",score1:1,score2:0,...
  const pairingPattern =
    /tableNumber:(\d+),player1:"([^"]*)",player2:"([^"]*)",score1:(null|\d+),score2:(null|\d+)/g;

  let match: RegExpExecArray | null;
  while ((match = pairingPattern.exec(html)) !== null) {
    const tableNum = parseInt(match[1]!, 10);
    const player1 = match[2]!;
    const player2 = match[3]!;
    const score1 = match[4] === 'null' ? null : parseInt(match[4]!, 10);
    const score2 = match[5] === 'null' ? null : parseInt(match[5]!, 10);

    const key = `${tableNum}:${[player1, player2].sort().join('|')}`;
    if (!scores[key]) {
      scores[key] = { score1, score2 };
    }
  }

  return scores;
}

/** Parse standings from RSC flight data when present. */
function parseStandingsFromFlightData(
  html: string,
): LocatorStanding[] {
  const standings: LocatorStanding[] = [];
  const seen = new Set<string>();

  // RSC flight embeds data like:
  //   ...,rank:1,name:"Alice",wins:3,losses:1,...
  const standingPattern =
    /rank:(\d+),name:"([^"]*)",wins:(null|\d+),losses:(null|\d+)/g;

  let match: RegExpExecArray | null;
  while ((match = standingPattern.exec(html)) !== null) {
    const name = match[2]!;

    // Dedup: standings rows may appear mirrored, same as pairings
    if (seen.has(name)) continue;
    seen.add(name);

    standings.push({
      rank: parseInt(match[1]!, 10),
      name,
      wins: match[3] === 'null' ? null : parseInt(match[3]!, 10),
      losses: match[4] === 'null' ? null : parseInt(match[4]!, 10),
    });
  }

  return standings;
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

    const roster = this.parseRoster($);
    const pairings = this.parsePairings($, html);
    const standings = parseStandingsFromFlightData(html);

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

  private parsePairings(
    $: cheerio.CheerioAPI,
    html: string,
  ): readonly LocatorPairing[] {
    const scoreMap = parseScoresFromFlightData(html);
    const pairs: LocatorPairing[] = [];
    const seen = new Set<string>();

    // Find the Pairings heading, then use text-based extraction on its
    // parent container's text content. This avoids navigating the
    // complex nested DOM (each pairing renders twice — mirror layout).
    const pairingsHeading = $('h2')
      .filter((_, el) => /pairings/i.test($(el).text()))
      .first();
    if (!pairingsHeading.length) return pairs;

    const sectionText = pairingsHeading.parent().text();

    // Each pairing appears as: TABLEN Player1 VS Player2 (mirrored twice)
    const tableRegex = /TABLE\s*(\d+)\s*(.*?)\s*VS\s*(.*?)(?=TABLE|$)/gi;

    let match: RegExpExecArray | null;
    while ((match = tableRegex.exec(sectionText)) !== null) {
      const tableNumber = parseInt(match[1]!, 10);
      const player1 = match[2]!.trim();
      const player2 = match[3]!.trim();

      if (!player1 || !player2 || player1.length > 50 || player2.length > 50) {
        continue;
      }

      const dedupKey = `${tableNumber}:${[player1, player2].sort().join('|')}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const cachedScores = scoreMap[dedupKey];

      pairs.push({
        tableNumber,
        player1,
        player2,
        score1: cachedScores?.score1 ?? null,
        score2: cachedScores?.score2 ?? null,
      });
    }

    return pairs;
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
