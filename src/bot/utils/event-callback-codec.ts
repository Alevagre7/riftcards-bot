import { createHash } from 'node:crypto';
import type { EventId, RoundId } from '../../core/entities/event-id.js';

const MAX_ID = (1n << 64n) - 1n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decimal(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error('Invalid event ID');
  const id = BigInt(value);
  if (id > MAX_ID) throw new Error('Unsupported event ID');
  return id;
}

function fromBase36(value: string): string {
  if (!/^[0-9a-z]{1,13}$/.test(value)) throw new Error('Invalid event token');
  let id = 0n;
  for (const char of value) id = id * 36n + BigInt(parseInt(char, 36));
  const result = decimal(id.toString()).toString();
  if (BigInt(result).toString(36) !== value) throw new Error('Invalid event token');
  return result;
}

export function encodeEventId(id: EventId): string {
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid legacy event ID');
    return String(id);
  }
  if (!id.startsWith('riot:')) throw new Error('Unknown event provider');
  return `r${decimal(id.slice(5)).toString(36)}`;
}

export function decodeEventId(token: string): EventId {
  if (token.startsWith('r')) return `riot:${fromBase36(token.slice(1))}`;
  if (!/^[1-9]\d*$/.test(token) || !Number.isSafeInteger(Number(token))) {
    throw new Error('Invalid legacy event token');
  }
  return Number(token);
}

function encodePlayer(id: number | string): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid Riot player ID');
  return Buffer.from(id.replaceAll('-', ''), 'hex').toString('base64url');
}

function decodePlayer(token: string): string {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) throw new Error('Invalid player token');
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 16 || bytes.toString('base64url') !== token) throw new Error('Invalid player token');
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodeRevision(revision: string): string {
  if (/^[0-9a-f]{32}$/.test(revision)) return `h${Buffer.from(revision, 'hex').toString('base64url')}`;
  if (/^[A-Za-z0-9_-]{1,17}$/.test(revision)) return `t${revision}`;
  throw new Error('Unsupported watch revision');
}

function decodeRevision(token: string): string {
  if (/^t[A-Za-z0-9_-]{1,17}$/.test(token)) return token.slice(1);
  if (/^h[A-Za-z0-9_-]{22}$/.test(token)) {
    const bytes = Buffer.from(token.slice(1), 'base64url');
    if (bytes.length === 16 && bytes.toString('base64url') === token.slice(1)) return bytes.toString('hex');
  }
  throw new Error('Invalid watch revision');
}

function checked(data: string): string {
  if (Buffer.byteLength(data) > 64) throw new Error('Telegram callback too long');
  return data;
}

export function watchSelectionCallback(eventId: EventId, registrationId: number | string): string {
  if (typeof eventId === 'number') return checked(`event:${eventId}:watch:select:${registrationId}`);
  return checked(`wps:${encodeEventId(eventId).slice(1)}:${encodePlayer(registrationId)}`);
}

export function watchReplacementCallback(eventId: EventId, registrationId: number | string, revision: string): string {
  if (typeof eventId === 'number') return checked(`watch:replace:${eventId}:${registrationId}:${revision}`);
  return checked(`wpr:${encodeEventId(eventId).slice(1)}:${encodePlayer(registrationId)}:${encodeRevision(revision)}`);
}

export function decodeWatchCallback(data: string): {
  eventId: EventId; registrationId: string; revision?: string;
} | null {
  const match = /^(wps|wpr):([0-9a-z]+):([A-Za-z0-9_-]+)(?::([A-Za-z0-9_-]+))?$/.exec(data);
  if (!match) return null;
  if ((match[1] === 'wpr') !== (match[4] !== undefined)) return null;
  try {
    return {
      eventId: `riot:${fromBase36(match[2]!)}`,
      registrationId: decodePlayer(match[3]!),
      ...(match[4] ? { revision: decodeRevision(match[4]) } : {}),
    };
  } catch {
    return null;
  }
}

/** Accept only official URLs; keep legacy IDs distinct from Riot IDs. */
export function parseEventReference(value: string): EventId | null {
  if (/^[1-9]\d*$/.test(value)) {
    try {
      decimal(value);
      return Number.isSafeInteger(Number(value)) ? Number(value) : `riot:${value}`;
    } catch { return null; }
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.port) return null;
    if (url.hostname === 'events.playriftbound.com') {
      const match = /^\/(?:[a-z]{2}-[A-Z]{2}\/)?events\/([1-9]\d*)\/?$/.exec(url.pathname);
      return match ? `riot:${decimal(match[1]!).toString()}` : null;
    }
    if (url.hostname === 'locator.riftbound.uvsgames.com') {
      const match = /^\/events\/([1-9]\d*)\/?$/.exec(url.pathname);
      return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
    }
  } catch { /* Invalid or unsupported URL. */ }
  return null;
}

/** Stable, bounded round reference; resolved only within the fetched event. */
export function encodeRoundId(id: RoundId): string {
  return typeof id === 'number' ? String(id)
    : `q${createHash('sha256').update(id).digest().subarray(0, 12).toString('base64url')}`;
}
