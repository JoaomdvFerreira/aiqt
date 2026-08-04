import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AutonomousAgentRequestSchema, type AutonomousAgentRequest } from "../schema/autonomous-agent-request.schema.js";

/**
 * M37-WU03: persistence for AutonomousAgentRequest (M37-WU02 defined the
 * pure contract; this is its first storage backend, needed once a real
 * -- non-simulated -- run actually creates one). Mirrors
 * autonomous-run-store.ts's own shape exactly: one JSON file per
 * request, under the same resolved evidenceOutputDir, a fixed id
 * pattern that makes path traversal via a user-supplied id structurally
 * unreachable.
 */
const AGENT_REQUEST_ID_PATTERN = /^agentreq-\d+-[0-9a-f]{8}$/;

export function isValidAgentRequestId(id: string): boolean {
  return AGENT_REQUEST_ID_PATTERN.test(id);
}

export function generateAgentRequestId(): string {
  return `agentreq-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function requestFilePath(evidenceDir: string, requestId: string): string {
  return join(evidenceDir, `${requestId}.agent-request.json`);
}

export function saveAgentRequest(request: AutonomousAgentRequest, evidenceDir: string): void {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(requestFilePath(evidenceDir, request.requestId), JSON.stringify(request, null, 2) + "\n", "utf8");
}

export type LoadAgentRequestResult = { ok: true; request: AutonomousAgentRequest } | { ok: false; reason: string };

export function loadAgentRequest(requestId: string, evidenceDir: string): LoadAgentRequestResult {
  if (!isValidAgentRequestId(requestId)) {
    return { ok: false, reason: `"${requestId}" is not a valid agent request id.` };
  }
  const path = requestFilePath(evidenceDir, requestId);
  if (!existsSync(path)) {
    return { ok: false, reason: `No agent request found for request id "${requestId}" in ${evidenceDir}.` };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, reason: `Failed to read agent request: ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `Agent request file is not valid JSON: ${path}` };
  }

  const result = AutonomousAgentRequestSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: `Agent request failed schema validation: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  return { ok: true, request: result.data };
}
