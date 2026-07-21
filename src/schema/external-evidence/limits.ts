/**
 * M23 §4.4/§8: bounded external-input limits shared by every adapter and
 * the CLI's file/stdin readers. Not increased without review.
 */
export const EXTERNAL_INPUT_MAX_PAYLOAD_BYTES = 1048576;
export const EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH = 20;
export const EXTERNAL_INPUT_MAX_TOP_LEVEL_KEYS = 32;

export const EXTERNAL_EVIDENCE_MAX_FINDINGS = 100;
export const EXTERNAL_EVIDENCE_MAX_ARTIFACTS = 50;
export const EXTERNAL_EVIDENCE_MAX_DECISION_ESCALATIONS = 50;
export const EXTERNAL_EVIDENCE_MAX_CHECKS = 200;

const BOUNDED_SHORT = 500;
const BOUNDED_MEDIUM = 2000;

export const BOUNDED_SHORT_STRING_MAX = BOUNDED_SHORT;
export const BOUNDED_MEDIUM_STRING_MAX = BOUNDED_MEDIUM;

/** M23 §8: recursively rejected regardless of nesting position or casing. */
const PROHIBITED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);

export class ProhibitedKeyError extends Error {
  constructor(public readonly path: string) {
    super(`Prohibited object key at ${path}`);
    this.name = "ProhibitedKeyError";
  }
}

export class ExcessiveNestingError extends Error {
  constructor(public readonly maxDepth: number) {
    super(`JSON nesting depth exceeds ${maxDepth}`);
    this.name = "ExcessiveNestingError";
  }
}

/**
 * M23 §4.4/§8: walks a parsed JSON value (never re-parses text) and throws
 * on the first prohibited key or nesting-depth violation found. Uses
 * `Object.keys` (own enumerable string keys only from `JSON.parse` output)
 * so no exotic prototype-chain traversal is ever performed -- this is a
 * defense-in-depth structural check, not a substitute for safe object
 * construction elsewhere.
 */
export function assertSafeParsedJson(
  value: unknown,
  options: { maxDepth?: number } = {},
): void {
  const maxDepth = options.maxDepth ?? EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH;
  walk(value, "$", 0, maxDepth);
}

function walk(value: unknown, path: string, depth: number, maxDepth: number): void {
  if (depth > maxDepth) {
    throw new ExcessiveNestingError(maxDepth);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1, maxDepth));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (PROHIBITED_KEYS.has(key)) {
        throw new ProhibitedKeyError(`${path}.${key}`);
      }
      walk((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1, maxDepth);
    }
  }
}

export class TopLevelNotObjectError extends Error {
  constructor() {
    super("Top-level JSON value must be an object");
    this.name = "TopLevelNotObjectError";
  }
}

export class TooManyTopLevelKeysError extends Error {
  constructor(public readonly max: number) {
    super(`Top-level object has more than ${max} keys`);
    this.name = "TooManyTopLevelKeysError";
  }
}

/** M23 §4.4/§6.2: parse one JSON document and enforce the structural caps before any adapter sees it. */
export function parseAndValidateExternalJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyntaxError("Malformed JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TopLevelNotObjectError();
  }
  const topLevelKeys = Object.keys(parsed as Record<string, unknown>);
  if (topLevelKeys.length > EXTERNAL_INPUT_MAX_TOP_LEVEL_KEYS) {
    throw new TooManyTopLevelKeysError(EXTERNAL_INPUT_MAX_TOP_LEVEL_KEYS);
  }
  assertSafeParsedJson(parsed);
  return parsed as Record<string, unknown>;
}
