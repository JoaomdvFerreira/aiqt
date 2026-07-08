/**
 * Deterministic, prefix-scoped ID generation.
 * IDs look like `PREFIX-001` and increment by 1, zero-padded to 3 digits.
 */
export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** Parse the numeric suffix of a prefixed ID, or null if it does not match. */
export function parseIdNumber(prefix: string, id: string): number | null {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

/**
 * Given a prefix and a set of existing IDs, return the next ID in sequence.
 * The highest existing numeric suffix determines the next value.
 */
export function nextId(prefix: string, existingIds: readonly string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const n = parseIdNumber(prefix, id);
    if (n !== null && n > max) max = n;
  }
  return formatId(prefix, max + 1);
}
