import { describe, expect, it } from 'vitest';
import {
  encodeEventId, decodeEventId, watchSelectionCallback, watchReplacementCallback,
  decodeWatchCallback, parseEventReference,
} from './event-callback-codec.js';

const player = '01234567-89ab-cdef-0123-456789abcdef';
const eventId = 'riot:117093196872746571' as const;

describe('Riot callback protocol', () => {
  it('preserves 18 digit IDs and stable player UUIDs without number conversion', () => {
    expect(decodeEventId(encodeEventId(eventId))).toBe(eventId);
    const data = watchSelectionCallback(eventId, player);
    expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
    expect(decodeWatchCallback(data)).toEqual({ eventId, registrationId: player });
  });

  it.each(['mabcdefghijklmnop', '0123456789abcdef0123456789abcdef'])(
    'fits maximum 64 bit event IDs and revision %s within Telegram limits', (revision) => {
      const maximum = 'riot:18446744073709551615' as const;
      const data = watchReplacementCallback(maximum, player, revision);
      expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      expect(decodeWatchCallback(data)).toEqual({ eventId: maximum, registrationId: player, revision });
    },
  );

  it('keeps old numeric callbacks compatible', () => {
    expect(encodeEventId(799609)).toBe('799609');
    expect(decodeEventId('799609')).toBe(799609);
    expect(watchSelectionCallback(799609, 123)).toBe('event:799609:watch:select:123');
    expect(watchReplacementCallback(799609, 123, 'revision-1')).toBe('watch:replace:799609:123:revision-1');
  });

  it.each(['wps:0:invalid', 'wpr:1:AAAAAAAAAAAAAAAAAAAAAA', 'wps:01:AAAAAAAAAAAAAAAAAAAAAA',
    'wps:1:AAAAAAAAAAAAAAAAAAAAAB', 'wps:1:AAAAAAAAAAAAAAAAAAAAAA:texcess'])('rejects malformed callback %s', (data) => {
    expect(decodeWatchCallback(data)).toBeNull();
  });

  it('rejects overflow rather than rounding an ID', () => {
    expect(() => decodeEventId('117093196872746571')).toThrow();
    expect(() => encodeEventId('riot:18446744073709551616')).toThrow();
  });
});

describe('official event references', () => {
  it('recognizes Riot URLs and preserves exact long bare IDs', () => {
    expect(parseEventReference('https://events.playriftbound.com/en-US/events/117093196872746571')).toBe(eventId);
    expect(parseEventReference('117093196872746571')).toBe(eventId);
    expect(parseEventReference('https://locator.riftbound.uvsgames.com/events/799609')).toBe(799609);
  });

  it.each(['https://events.playriftbound.com.evil.test/en-US/events/117093196872746571',
    'https://events.playriftbound.com@evil.test/events/1', 'https://events.playriftbound.com/api/gql',
    'https://events.playriftbound.com/en-US/events/117093196872746571/trailing', '0', '-1'])(
    'rejects unsupported reference %s', (value) => expect(parseEventReference(value)).toBeNull(),
  );
});
