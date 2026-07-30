import { describe, expect, it } from 'vitest';
import { NEXUS_USERNAME_RE } from './nexus-username.js';

describe('NEXUS_USERNAME_RE', () => {
  it('accepts a simple alphanumeric username', () => {
    expect(NEXUS_USERNAME_RE.test('riftbound_player')).toBe(true);
    expect(NEXUS_USERNAME_RE.test('player123')).toBe(true);
  });

  it('accepts a username with internal spaces', () => {
    expect(NEXUS_USERNAME_RE.test('Dolores Deano')).toBe(true);
    expect(NEXUS_USERNAME_RE.test('John Jacob Jingleheimer Schmidt')).toBe(true);
  });

  it('accepts usernames with dots, hyphens, and underscores', () => {
    expect(NEXUS_USERNAME_RE.test('player.one')).toBe(true);
    expect(NEXUS_USERNAME_RE.test('player-one')).toBe(true);
    expect(NEXUS_USERNAME_RE.test('player_one')).toBe(true);
    expect(NEXUS_USERNAME_RE.test('Mr. Smith-Jones')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(NEXUS_USERNAME_RE.test('')).toBe(false);
  });

  it('rejects usernames longer than 64 characters', () => {
    expect(NEXUS_USERNAME_RE.test('a'.repeat(65))).toBe(false);
  });

  it('rejects usernames with special characters', () => {
    expect(NEXUS_USERNAME_RE.test('player@one')).toBe(false);
    expect(NEXUS_USERNAME_RE.test('player/one')).toBe(false);
    expect(NEXUS_USERNAME_RE.test('player!one')).toBe(false);
  });
});
