// levenshtein: classic Wagner-Fischer distance, used by the inline
// query to re-rank upstream results. Pure function, no deps.

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Single-row rolling buffer. O(min(a,b)) space.
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const m = shorter.length;
  const n = longer.length;

  let previous = new Array<number>(m + 1);
  let current = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) previous[j] = j;

  for (let i = 1; i <= n; i++) {
    current[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = longer.charCodeAt(i - 1) === shorter.charCodeAt(j - 1) ? 0 : 1;
      const insert = (current[j - 1] ?? 0) + 1;
      const del = (previous[j] ?? 0) + 1;
      const sub = (previous[j - 1] ?? 0) + cost;
      current[j] = Math.min(insert, del, sub);
    }
    const tmp = previous;
    previous = current;
    current = tmp;
  }

  return previous[m] ?? 0;
}
