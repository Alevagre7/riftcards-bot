// Shared validation for /mytable display names and Riot IDs. A name may be
// supplied without a tagline or as gameName#tagLine. Unicode letters and
// combining marks are accepted so names from non-Latin alphabets work too.
// Callers trim input before testing.
export const NEXUS_USERNAME_RE =
  /^[\p{L}\p{N}\p{M}_.’' -]{1,64}(?:#[\p{L}\p{N}\p{M}_-]{1,16})?$/u;

export const RIOT_PLAYER_NAME_RE = NEXUS_USERNAME_RE;
