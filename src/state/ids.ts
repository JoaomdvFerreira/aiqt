/**
 * Deterministic, prefix-scoped ID generation.
 * IDs look like `PREFIX-001` (or `PREFIX001` when separator is "") and
 * increment by 1, zero-padded to 3 digits.
 */
export function formatId(prefix: string, n: number, separator = "-"): string {
  return `${prefix}${separator}${String(n).padStart(3, "0")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse the numeric suffix of a prefixed ID, or null if it does not match. */
export function parseIdNumber(
  prefix: string,
  id: string,
  separator = "-",
): number | null {
  const pattern = `^${escapeRegExp(prefix)}${escapeRegExp(separator)}(\\d+)$`;
  const match = new RegExp(pattern).exec(id);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

/**
 * Given a prefix and a set of existing IDs, return the next ID in sequence.
 * The highest existing numeric suffix determines the next value.
 */
export function nextId(
  prefix: string,
  existingIds: readonly string[],
  separator = "-",
): string {
  let max = 0;
  for (const id of existingIds) {
    const n = parseIdNumber(prefix, id, separator);
    if (n !== null && n > max) max = n;
  }
  return formatId(prefix, max + 1, separator);
}
