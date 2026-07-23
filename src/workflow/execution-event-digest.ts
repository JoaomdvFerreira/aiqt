import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { ExecutionProtocolEvent } from "../schema/execution-protocol-envelope.schema.js";

/**
 * M26 §4.3: canonical normalized event digest -- reuses M23's shared
 * canonical-JSON payload digest (parse -> canonicalize -> stringify ->
 * SHA-256), never a second digest algorithm. Computed over the validated,
 * parsed event object (post-schema, so key order and incidental
 * whitespace never affect the digest).
 */
export function computeEventDigest(event: ExecutionProtocolEvent): string {
  return computeCanonicalPayloadDigest(event);
}
