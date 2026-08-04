import { z } from "zod";

/**
 * M36-WU01: contract-only schemas for the autonomous maintenance runner
 * (build spec Sec 6-7, WU36-01). Nothing in this file executes a
 * command, invokes a model, creates a worktree, or touches a
 * repository -- every export here is a data shape or a pure predicate
 * operating on that data. Autonomous execution itself (WU36-02 through
 * WU36-05) is not enabled by this file; see
 * docs/engineering/m36-autonomous-run-contract.md Sec 6 for the explicit
 * architecture guard that keeps it that way until a later Work Unit
 * deliberately wires it up.
 *
 * Distinct from src/schema/execution-session.schema.ts (M26/M27's
 * external-agent execution-session protocol, which tracks a human- or
 * externally-driven session AIQT observes) -- this schema describes
 * AIQT's own prospective self-driven maintenance run, a different
 * concern with a different lifecycle, never persisted to canonical
 * state in this Work Unit.
 */

const MAX_BOUNDED_TEXT_CHARS = 4000;
const MAX_BOUNDED_KEY_CHARS = 200;
const MAX_LIST_ITEMS = 50;

// ---------------------------------------------------------------------------
// Run lifecycle (build spec Sec "Required run lifecycle")
// ---------------------------------------------------------------------------

export const AutonomousRunStatusSchema = z.enum([
  "created",
  "preflight",
  "classified",
  "awaiting_approval",
  "preparing_workspace",
  "executing",
  "validating",
  "reviewing",
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "budget_exhausted",
]);
export type AutonomousRunStatus = z.infer<typeof AutonomousRunStatusSchema>;

/** Terminal statuses accept no further transition -- mirrors the convention in execution-session.schema.ts's TERMINAL_SESSION_STATUSES. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<AutonomousRunStatus> = new Set([
  "completed",
  "blocked",
  "failed",
  "cancelled",
  "budget_exhausted",
]);
export function isTerminalRunStatus(status: AutonomousRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Candidate contract
// ---------------------------------------------------------------------------

export const AutonomousCandidateSourceSchema = z.enum(["issue", "review_finding", "manual", "operator"]);
export type AutonomousCandidateSource = z.infer<typeof AutonomousCandidateSourceSchema>;

export const AutonomousCandidateSchema = z
  .object({
    issueId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    source: AutonomousCandidateSourceSchema,
    repository: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    baseRef: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    objective: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    acceptanceCriteria: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    constraints: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS).default([]),
    requestedPermissions: z.array(z.string().min(1).max(MAX_BOUNDED_KEY_CHARS)).max(MAX_LIST_ITEMS).default([]),
  })
  .strict();
export type AutonomousCandidate = z.infer<typeof AutonomousCandidateSchema>;

// ---------------------------------------------------------------------------
// Safety assessment (build spec Sec 6.3)
// ---------------------------------------------------------------------------

export const AutonomousRiskClassSchema = z.enum([
  "low_risk_autonomous",
  "medium_risk_requires_approval",
  "high_risk_prohibited",
  "insufficient_context",
  "validation_unavailable",
  "repository_dirty",
  "unsupported_operation",
]);
export type AutonomousRiskClass = z.infer<typeof AutonomousRiskClassSchema>;

/** Risk classes that must never proceed to execution without a human approval step recorded first. */
export const RISK_CLASSES_REQUIRING_APPROVAL: ReadonlySet<AutonomousRiskClass> = new Set([
  "medium_risk_requires_approval",
]);

/** Risk classes that can never proceed to execution at all, approval or not. */
export const RISK_CLASSES_ALWAYS_BLOCKED: ReadonlySet<AutonomousRiskClass> = new Set([
  "high_risk_prohibited",
  "insufficient_context",
  "validation_unavailable",
  "repository_dirty",
  "unsupported_operation",
]);

export const PROHIBITED_AREA_TAGS = [
  "authentication",
  "authorization",
  "cryptography",
  "secrets",
  "billing",
  "destructive_migration",
  "production_infrastructure",
  "branch_protection",
  "dependency_chain_upgrade",
  "generated_lockfile_rewrite",
] as const;
export const ProhibitedAreaTagSchema = z.enum(PROHIBITED_AREA_TAGS);
export type ProhibitedAreaTag = z.infer<typeof ProhibitedAreaTagSchema>;

export const AutonomousSafetyAssessmentSchema = z
  .object({
    riskClass: AutonomousRiskClassSchema,
    prohibitedAreas: z.array(ProhibitedAreaTagSchema).max(MAX_LIST_ITEMS).default([]),
    requiredApprovals: z.array(z.string().min(1).max(MAX_BOUNDED_KEY_CHARS)).max(MAX_LIST_ITEMS).default([]),
    commandPolicyProfile: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    networkPolicy: z.enum(["denied", "explicitly_enabled"]),
    reason: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  })
  .strict();
export type AutonomousSafetyAssessment = z.infer<typeof AutonomousSafetyAssessmentSchema>;

// ---------------------------------------------------------------------------
// Budget (build spec Sec 6.4)
// ---------------------------------------------------------------------------

export const AutonomousBudgetsSchema = z
  .object({
    maxWallClockSeconds: z.number().int().min(1).max(86400),
    maxCommandCount: z.number().int().min(1).max(10000),
    maxRetryCount: z.number().int().min(0).max(100),
    maxChangedFiles: z.number().int().min(1).max(10000),
    maxDiffLines: z.number().int().min(1).max(1_000_000),
    maxValidationSeconds: z.number().int().min(1).max(86400),
    maxModelTokenSpend: z.number().int().min(1).max(1_000_000_000).optional(),
  })
  .strict();
export type AutonomousBudgets = z.infer<typeof AutonomousBudgetsSchema>;

export const AutonomousBudgetUsageSchema = z
  .object({
    wallClockSeconds: z.number().min(0),
    commandCount: z.number().int().min(0),
    retryCount: z.number().int().min(0),
    changedFiles: z.number().int().min(0),
    diffLines: z.number().int().min(0),
    validationSeconds: z.number().min(0),
    modelTokenSpend: z.number().int().min(0).optional(),
  })
  .strict();
export type AutonomousBudgetUsage = z.infer<typeof AutonomousBudgetUsageSchema>;

// ---------------------------------------------------------------------------
// Command / execution policy (build spec Sec 6.5)
// ---------------------------------------------------------------------------

export const CommandClassSchema = z.enum([
  "read_only_inspection",
  "repository_local_write",
  "git_operation",
  "test_or_build",
  "network",
  "destructive",
  "privileged",
]);
export type CommandClass = z.infer<typeof CommandClassSchema>;

/** Command classes an autonomous run may execute without an explicit per-run override. Everything else is denied by default (fail-closed). */
export const DEFAULT_ALLOWED_COMMAND_CLASSES: ReadonlySet<CommandClass> = new Set([
  "read_only_inspection",
  "repository_local_write",
  "git_operation",
  "test_or_build",
]);

/** Command classes that are always denied, regardless of any per-run override -- there is no override path for these in WU36-01's contract. */
export const ALWAYS_DENIED_COMMAND_CLASSES: ReadonlySet<CommandClass> = new Set(["destructive", "privileged"]);

export const AutonomousExecutionPolicySchema = z
  .object({
    allowedCommandClasses: z.array(CommandClassSchema).max(MAX_LIST_ITEMS),
    blockedCommandClasses: z.array(CommandClassSchema).max(MAX_LIST_ITEMS),
    networkPolicy: z.enum(["denied", "explicitly_enabled"]),
    filesystemBoundary: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    gitBoundary: z.object({ allowedBaseRefPrefixes: z.array(z.string().min(1).max(MAX_BOUNDED_KEY_CHARS)).max(MAX_LIST_ITEMS) }).strict(),
  })
  .strict();
export type AutonomousExecutionPolicy = z.infer<typeof AutonomousExecutionPolicySchema>;

// ---------------------------------------------------------------------------
// Result state (build spec Sec 6.1 / "Result state")
// ---------------------------------------------------------------------------

export const AutonomousResultStateSchema = z.enum([
  "passed",
  "failed",
  "blocked",
  "needs_input",
  "cancelled",
  "budget_exhausted",
  "validation_failed",
  "review_rejected",
]);
export type AutonomousResultState = z.infer<typeof AutonomousResultStateSchema>;

/** The exact run status each terminal result state must have been reached from -- a fixed, checkable pairing (see autonomous-run-lifecycle.ts's resultStateForTerminalStatus). */
export const RESULT_STATE_TERMINAL_STATUS: Readonly<Record<AutonomousResultState, AutonomousRunStatus>> = {
  passed: "completed",
  failed: "failed",
  blocked: "blocked",
  needs_input: "blocked",
  cancelled: "cancelled",
  budget_exhausted: "budget_exhausted",
  validation_failed: "failed",
  review_rejected: "failed",
};

// ---------------------------------------------------------------------------
// Evidence packet (build spec Sec 6.7 / "Evidence packet")
// ---------------------------------------------------------------------------

export const AutonomousWorkspaceRecordSchema = z
  .object({
    sourceRepository: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    baseRef: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    baseCommit: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    branch: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    worktreePath: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    createdFiles: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    cleanupStatus: z.enum(["pending", "cleaned", "cleanup_failed"]),
  })
  .strict();
export type AutonomousWorkspaceRecord = z.infer<typeof AutonomousWorkspaceRecordSchema>;

export const AutonomousDiffSummarySchema = z
  .object({
    changedFiles: z.number().int().min(0),
    insertedLines: z.number().int().min(0),
    deletedLines: z.number().int().min(0),
    unexpectedFiles: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS).default([]),
  })
  .strict();
export type AutonomousDiffSummary = z.infer<typeof AutonomousDiffSummarySchema>;

export const AutonomousRecommendedActionSchema = z.enum([
  "review_and_merge",
  "request_changes",
  "discard",
  "provide_missing_input",
  "rerun_with_modified_budget",
]);
export type AutonomousRecommendedAction = z.infer<typeof AutonomousRecommendedActionSchema>;

export const AutonomousEvidencePacketSchema = z
  .object({
    runId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    candidate: AutonomousCandidateSchema,
    safetyAssessment: AutonomousSafetyAssessmentSchema,
    workspace: AutonomousWorkspaceRecordSchema.optional(),
    commandsExecuted: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS).default([]),
    filesChanged: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS).default([]),
    diffSummary: AutonomousDiffSummarySchema.optional(),
    validation: z
      .object({
        targetedTestsPassed: z.boolean(),
        authoritativeValidationPassed: z.boolean().nullable(),
        durationSeconds: z.number().min(0),
      })
      .strict()
      .optional(),
    findings: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS).default([]),
    residualRisk: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    resultState: AutonomousResultStateSchema,
    recommendedHumanAction: AutonomousRecommendedActionSchema,
  })
  .strict();
export type AutonomousEvidencePacket = z.infer<typeof AutonomousEvidencePacketSchema>;

// ---------------------------------------------------------------------------
// Audit / runlog events (build spec Sec "Required contracts" / Audit events)
// ---------------------------------------------------------------------------

/**
 * One event type per lifecycle transition (build spec: "Define runlog
 * events for all lifecycle transitions and policy decisions") plus the
 * cross-cutting policy-decision events that are not themselves a status
 * transition (a command-policy denial can happen many times within the
 * single "executing" status, for example). Naming follows the existing
 * runlog convention (buildXEvent-style event *type* string, snake_case,
 * `autonomous_run.` prefix distinguishes this event family from every
 * other build*Event() in runlog-store.ts). No builder function is added
 * in this Work Unit -- these are the reserved type strings a future
 * Work Unit's buildAutonomousRunXEvent() functions must use verbatim.
 */
export const AUTONOMOUS_RUN_EVENT_TYPES = [
  "autonomous_run.created",
  "autonomous_run.preflight_completed",
  "autonomous_run.classified",
  "autonomous_run.approval_requested",
  "autonomous_run.approval_granted",
  "autonomous_run.approval_denied",
  "autonomous_run.workspace_prepared",
  "autonomous_run.execution_started",
  "autonomous_run.command_allowed",
  "autonomous_run.command_denied",
  "autonomous_run.budget_warning",
  "autonomous_run.budget_exhausted",
  "autonomous_run.validation_started",
  "autonomous_run.validation_completed",
  "autonomous_run.review_started",
  "autonomous_run.review_completed",
  "autonomous_run.completed",
  "autonomous_run.blocked",
  "autonomous_run.failed",
  "autonomous_run.cancelled",
  "autonomous_run.cleanup_completed",
  "autonomous_run.cleanup_failed",
] as const;
export const AutonomousRunEventTypeSchema = z.enum(AUTONOMOUS_RUN_EVENT_TYPES);
export type AutonomousRunEventType = z.infer<typeof AutonomousRunEventTypeSchema>;
