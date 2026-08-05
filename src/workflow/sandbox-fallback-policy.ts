/**
 * M38-WU01 (build spec Sec 6 "Fallback": "If sandbox capability is
 * insufficient, recommend M37 request/import. Never fall back to
 * `execFile + cwd`"). This is the single place in the M38 codebase that
 * decides what to recommend when live execution cannot proceed -- every
 * other M38-WU01 module that needs a fallback (platform decision,
 * capability evaluation) calls into this one, so there is exactly one
 * fallback recommendation ever produced, never a locally-improvised one
 * that might drift.
 *
 * The recommendation always points at the M37 request/import workflow
 * (`aiqt autonomous run`, without `--simulate`) -- the same permanent,
 * already-shipped, already-piloted lower-risk path documented in
 * docs/engineering/m37-wu05-operator-workflow.md. This function contains
 * no process-spawning, container, or network code of any kind; it
 * returns a plain data value describing what a caller (a future CLI
 * command, not built in this Work Unit) should tell the operator.
 */
export interface SandboxFallbackRecommendation {
  recommendation: "fallback_to_request_import";
  recommendedCommand: "aiqt autonomous run";
  reason: string;
}

export function buildSandboxFallbackRecommendation(reason: string): SandboxFallbackRecommendation {
  return { recommendation: "fallback_to_request_import", recommendedCommand: "aiqt autonomous run", reason };
}
