import { createHash } from "node:crypto";
import { AutonomousAgentResponseSchema, type AutonomousAgentRequest, type AutonomousAgentResponse } from "../schema/autonomous-agent-request.schema.js";
import { isAgentRequestExpired, isValidAgentRequestTransition } from "../workflow/autonomous-agent-request-lifecycle.js";

/**
 * M37-WU02 (build spec: "failure classification"; "provider errors map
 * to M33 contract"). Importing a response is a pure parse + validate +
 * record operation -- it NEVER executes a proposed command (build spec:
 * "The agent may inspect, propose, and prepare. The human decides
 * whether to integrate."). No process spawn, no file write beyond
 * whatever the caller does with the returned record.
 */
export type ImportAgentResponseFailureReason =
  | "request_expired"
  | "request_not_pending"
  | "malformed_response"
  | "request_id_mismatch"
  | "provider_id_mismatch";

export type ImportAgentResponseResult =
  | { ok: true; request: AutonomousAgentRequest; response: AutonomousAgentResponse }
  | { ok: false; reason: ImportAgentResponseFailureReason; detail: string };

/** Bounded, deterministic digest of the raw imported text -- never the raw text itself is persisted by any caller of this function; the digest alone is what binds an import to specific bytes. */
export function computeRawResponseDigest(rawResponseText: string): string {
  return `sha256:${createHash("sha256").update(rawResponseText).digest("hex")}`;
}

export function importAutonomousAgentResponse(request: AutonomousAgentRequest, rawResponseJson: unknown, now: Date = new Date()): ImportAgentResponseResult {
  if (!isValidAgentRequestTransition(request.status, "imported")) {
    return { ok: false, reason: "request_not_pending", detail: `Request ${request.requestId} is in status "${request.status}", not "pending" -- it cannot be imported.` };
  }
  if (isAgentRequestExpired(request, now)) {
    return { ok: false, reason: "request_expired", detail: `Request ${request.requestId} expired at ${request.expiresAt}.` };
  }

  const parsed = AutonomousAgentResponseSchema.safeParse(rawResponseJson);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_response", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const response = parsed.data;

  if (response.requestId !== request.requestId) {
    return { ok: false, reason: "request_id_mismatch", detail: `Response requestId "${response.requestId}" does not match request "${request.requestId}".` };
  }
  if (response.providerId !== request.providerId) {
    return { ok: false, reason: "provider_id_mismatch", detail: `Response providerId "${response.providerId}" does not match request providerId "${request.providerId}".` };
  }

  const importedRequest: AutonomousAgentRequest = { ...request, status: "imported", importedAt: now.toISOString() };
  return { ok: true, request: importedRequest, response };
}
