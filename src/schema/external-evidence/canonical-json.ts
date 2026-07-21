import { sha256Hex } from "../../core/util/hash.js";

/**
 * M23 §6.1: recursively sorts object keys (array order and value contents
 * are preserved exactly) so that two JSON documents differing only in key
 * order or insignificant whitespace produce an identical canonical form.
 * Operates on an already-parsed JSON value -- never re-parses text.
 */
export function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sortedKeys = Object.keys(source).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeJsonValue(source[key]);
    }
    return result;
  }
  return value;
}

/** M23 §6.1: canonical form serialized with no insignificant whitespace. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJsonValue(value));
}

/**
 * M23 §6.1: the one shared payload-digest algorithm -- parse (by the
 * caller) -> canonicalize -> serialize -> SHA-256 over the UTF-8 bytes.
 * Used identically by preview and mutation, and by every adapter; no
 * adapter-specific hashing is permitted.
 */
export function computeCanonicalPayloadDigest(value: unknown): string {
  return sha256Hex(canonicalJsonStringify(value));
}

/**
 * M23 §9 Critical rule 1: encodes an ordered tuple of strings as a JSON
 * array (`JSON.stringify`, which escapes embedded delimiter characters) so
 * that tuple elements can never collide across a separator the way naive
 * string concatenation could (e.g. `["ab","c"]` vs `["a","bc"]` joined with
 * `"-"` both yielding `"ab-c"`/`"a-bc"` is impossible here, since JSON
 * string quoting/escaping makes the encoding unambiguous).
 */
export function canonicalTupleEncode(parts: readonly string[]): string {
  return JSON.stringify(parts);
}
