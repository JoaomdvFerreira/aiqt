import { sha256Hex } from "../core/util/hash.js";
import { canonicalJsonStringify } from "../schema/external-evidence/canonical-json.js";

/**
 * M26 §3.3: the deterministic session identity. Reuses M23's canonical-JSON
 * helper (src/schema/external-evidence/canonical-json.ts) for the tuple
 * encoding -- never a second canonical-JSON implementation, mirroring
 * M25's workspace-identity.ts. Same tuple always produces the same session
 * ID; a retry after a terminal session requires a new `sessionClientKey`
 * (which changes the tuple and therefore the ID), never a special-cased
 * reopen path.
 */
export interface ExecutionSessionIdentityInput {
  projectId: string;
  workUnitId: string;
  packetId: string;
  workspaceMode: "managed" | "none";
  workspaceIdOrNone: string | null;
  workspaceGenerationOrZero: number;
  providerId: string;
  sessionClientKey: string;
}

export function deriveExecutionSessionIdentity(input: ExecutionSessionIdentityInput): string {
  const tuple = [
    input.projectId,
    input.workUnitId,
    input.packetId,
    input.workspaceMode,
    input.workspaceIdOrNone,
    input.workspaceGenerationOrZero,
    input.providerId,
    input.sessionClientKey,
  ];
  return sha256Hex(canonicalJsonStringify(tuple));
}
