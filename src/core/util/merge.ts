/**
 * Append `incoming` values onto `existing`, preserving existing order and
 * deduplicating so repeated values (in either list) appear only once.
 */
export function dedupeAppend(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  const seen = new Set(existing);
  const result = [...existing];
  for (const value of incoming) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * Structural equality for plain JSON-serializable values. Safe for comparing
 * canonical records built via `{ ...before, field: value }` spreads, since
 * object spread preserves existing key order.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
