import { z } from "zod";

/**
 * M41-WU01 (build spec Sec 6): the single shared test-impact contract
 * owner. Reuses M35's test-inventory-classifier.ts for bounded/
 * deterministic inventory discovery and M39's ValidationTier enum
 * (execution-guidance.schema.ts) for T0-T4 rather than duplicating either.
 * This file defines shapes only -- no filesystem, no process, no network.
 */

export const TEST_IMPACT_SELECTION_VERSION = "test-impact@1" as const;

export const TestTargetKindSchema = z.enum(["test_file", "validation_command"]);
export type TestTargetKind = z.infer<typeof TestTargetKindSchema>;

/**
 * A single addressable validation target: either a discovered test file
 * (kind "test_file", `locator` is its repo-relative path) or an explicit
 * validation command from the Work Unit's own plan (kind
 * "validation_command", `locator` is the literal command string).
 */
export const TestTargetSchema = z.object({
  id: z.string().min(1),
  kind: TestTargetKindSchema,
  locator: z.string().min(1),
  layer: z.enum(["unit", "integration"]).nullable(),
  domain: z.string().nullable(),
  criticality: z.string().nullable(),
});
export type TestTarget = z.infer<typeof TestTargetSchema>;

export const TestImpactReasonCodeSchema = z.enum([
  "explicit_requirement",
  "changed_test",
  "scoped_file_match",
  "direct_dependency",
  "mapped_dependency",
  "prior_relevant_failure",
  "shared_surface",
  "broad_fallback",
]);
export type TestImpactReasonCode = z.infer<typeof TestImpactReasonCodeSchema>;

export const TestImpactConfidenceSchema = z.enum(["high", "medium", "low"]);
export type TestImpactConfidence = z.infer<typeof TestImpactConfidenceSchema>;

export const TestEscalationOutcomeSchema = z.enum([
  "selected_focused",
  "selected_impacted",
  "broaden_required",
  "full_required",
  "insufficient_evidence",
]);
export type TestEscalationOutcome = z.infer<typeof TestEscalationOutcomeSchema>;

export interface TestImpactEvidenceGap {
  code: string;
  message: string;
}

/** One inventory entry: bounded facts about a discovered test file, no file content. */
export interface TestInventoryEntry {
  path: string;
  layer: "unit" | "integration";
  domain: string;
  criticality: string;
  testCountStatic: number;
}

export interface TestInventorySnapshot {
  generatedAt: string;
  entries: TestInventoryEntry[];
}

/** Bounded prior-evidence reference (build spec Sec 10); owned/populated by WU41-04. */
export interface ValidationFeedbackRef {
  targetId: string;
  outcome: "passed" | "failed" | "unknown";
  workUnitId: string;
  changeIdentity: string;
  durationMs: number | null;
  failureCategory: string | null;
  evidenceTimestamp: string;
  evidenceSource: string;
}

/** Every field a selector run is allowed to read (build spec Sec 6.1) -- never raw conversation history. */
export interface TestImpactInput {
  workUnitId: string;
  /** Work-Unit-declared scoped/suggested files. */
  scopedFiles: string[];
  /** Changed files since the bounded WU/checkpoint baseline. */
  changedFiles: string[];
  /** This Work Unit's own explicit validationCommands (build spec Sec 6.1, reused from M39). */
  explicitValidationCommands: string[];
  inventory: TestInventorySnapshot;
  priorFeedback: ValidationFeedbackRef[];
  /** M41-WU04: the identity prior feedback must match to be trusted (defaults to workUnitId when omitted). A feedback ref whose changeIdentity differs is stale/mismatched, never verified evidence. */
  currentChangeIdentity?: string;
}

export interface SelectedTestTarget {
  target: TestTarget;
  order: number;
  mandatory: boolean;
  reasonCodes: TestImpactReasonCode[];
  reasons: string[];
}

export interface TestSelectionSummary {
  candidateCount: number;
  selectedCount: number;
  mandatoryCount: number;
}

/** The full deterministic selection result (build spec Sec 6.2). */
export interface TestImpactSelection {
  selectionVersion: typeof TEST_IMPACT_SELECTION_VERSION;
  inputDigest: string;
  selectedTargets: SelectedTestTarget[];
  mandatoryTargetIds: string[];
  /** Reuses M39's ValidationTier ("static"|"focused"|"impacted"|"milestone"|"full"|"unclassified"). */
  recommendedTier: string;
  confidence: TestImpactConfidence;
  escalation: TestEscalationOutcome;
  evidenceGaps: TestImpactEvidenceGap[];
  fullSuiteDeferred: boolean;
  fullSuiteDeferredReason: string | null;
  summary: TestSelectionSummary;
}
