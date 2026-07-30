// Shared regex for the Nexus username input validation. Used by
// both the /mytable command (inline-set path) and the pickup
// handler (two-step set flow).
//
// Allows letters, digits, underscore, dot, hyphen, and internal
// spaces (e.g. "Dolores Deano"). Callers must trim() before
// matching, so leading/trailing whitespace never reaches the regex.

export const NEXUS_USERNAME_RE = /^[\w. -]{1,64}$/;
