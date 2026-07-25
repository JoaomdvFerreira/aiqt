import { sha256Hex } from "../core/util/hash.js";
import { canonicalJsonStringify, computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";

/**
 * M27 §3.1: "request identity is deterministic from canonical
 * project/session/request-sequence/adapter data", mirroring M26's
 * execution-session-identity.ts. Reuses the same canonical-JSON helper --
 * never a second canonical-JSON implementation. The same tuple always
 * produces the same request ID, so a retry that reuses the same active
 * request and sequence number is naturally idempotent at the identity
 * layer as well as the digest layer.
 */
export interface AdapterRequestIdentityInput {
  adapterId: string;
  executionSessionId: string;
  requestSequence: number;
}

export function deriveAdapterRequestIdentity(input: AdapterRequestIdentityInput): string {
  const tuple = [input.adapterId, input.executionSessionId, input.requestSequence];
  return sha256Hex(canonicalJsonStringify(tuple));
}

/**
 * M27 §3.1: requestDigest -- a bounded digest over the request's own
 * canonical (non-secret) identity fields, reusing the same canonical-JSON
 * digest helper as M26's event digest and M23's external-evidence digest
 * (never a second hashing scheme).
 */
export interface AdapterRequestDigestInput {
  adapterId: string;
  executionSessionId: string;
  workUnitId: string;
  packetId: string;
  requestSequence: number;
  mode: "start" | "resume";
  /** Claude-adapter-only fields; absent for generic-json@1 requests. */
  externalSessionId?: string;
  providerVersionConstraint?: string;
  /** M27R: AIQT-owned generic session identity, present for generic-json@1 requests. */
  sessionClientKey?: string;
}

export function computeAdapterRequestDigest(input: AdapterRequestDigestInput): string {
  return computeCanonicalPayloadDigest(input);
}
