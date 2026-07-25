import { z } from "zod";

/**
 * M27R §3.1: the complete, static adapter registry. No dynamic adapter
 * loading, arbitrary module path, executable adapter, arbitrary provider
 * command, project-defined parser, or network-backed adapter discovery
 * exists anywhere in AIQT. A future adapter requires a separate reviewed
 * milestone, never a runtime registration surface.
 */
export const GENERIC_ADAPTER_ID = "generic-json@1" as const;
export const CLAUDE_ADAPTER_ID = "claude-code-stream-json@1" as const;

export const AdapterIdSchema = z.enum([GENERIC_ADAPTER_ID, CLAUDE_ADAPTER_ID]);
export type AdapterId = z.infer<typeof AdapterIdSchema>;

export interface StaticAdapterDescriptor {
  adapterId: AdapterId;
  role: "canonical_default" | "optional_native_translator";
  maturity: "stable" | "experimental";
  validation?: "synthetic_only";
}

export const ADAPTER_REGISTRY: readonly StaticAdapterDescriptor[] = [
  { adapterId: GENERIC_ADAPTER_ID, role: "canonical_default", maturity: "stable" },
  { adapterId: CLAUDE_ADAPTER_ID, role: "optional_native_translator", maturity: "experimental", validation: "synthetic_only" },
];

export function findAdapterDescriptor(adapterId: string): StaticAdapterDescriptor | undefined {
  return ADAPTER_REGISTRY.find((a) => a.adapterId === adapterId);
}

/**
 * M27R §9: minimum generic limits. Distinct from (and does not modify)
 * the Claude adapter's own pre-existing, larger stream-json limits
 * (schema/claude-code-stream-json.schema.ts) or its pre-existing
 * per-session request cap (MAX_ADAPTER_REQUESTS_PER_SESSION in
 * schema/execution-adapter-request.schema.ts) -- both remain unchanged
 * for full M27 backward compatibility.
 */
export const GENERIC_INPUT_MAX_BYTES = 1048576;
export const GENERIC_MAX_JSON_DEPTH = 20;
export const GENERIC_MAX_SUMMARY_CHARS = 4000;
export const GENERIC_MAX_VALIDATION_CLAIMS = 50;
export const GENERIC_MAX_COMMIT_REFS = 100;
export const GENERIC_MAX_EVIDENCE_REFS = 100;
export const GENERIC_MAX_CONTINUATION_REASON_CHARS = 1000;
export const GENERIC_MAX_REQUESTS_PER_SESSION = 100;
export const GENERIC_MAX_REQUESTS_PER_WORK_UNIT = 200;
