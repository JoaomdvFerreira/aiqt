import { z } from "zod";

/**
 * M26 §7: state-growth and input limits, validated before mutation. Not
 * increased without review.
 */
export const MAX_SESSIONS = 1000;
export const MAX_SESSIONS_PER_WORK_UNIT = 20;
export const MAX_NON_TERMINAL_SESSIONS_PER_PACKET = 1;
export const MAX_ITERATIONS_PER_SESSION = 100;
export const MAX_DECISIONS_PER_SESSION = 20;
export const MAX_OPEN_DECISIONS_PER_SESSION = 5;
export const MAX_ROLLBACK_RECORDS_PER_SESSION = 50;
export const MAX_COMMIT_REFS_PER_SESSION = 100;
export const MAX_EVIDENCE_REFS_PER_SESSION = 100;
export const MAX_STATUS_TRANSITIONS_PER_SESSION = 100;
export const MAX_EVENT_RECEIPTS_PER_SESSION = 500;
export const MAX_SERIALIZED_SESSION_BYTES = 262144;
export const MAX_EVENTS_PER_ENVELOPE = 100;
/**
 * M26 §7's input.max_bytes/max_json_depth are numerically identical to
 * M23's existing EXTERNAL_INPUT_MAX_PAYLOAD_BYTES/
 * EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH (schema/external-evidence/limits.ts)
 * -- reused directly at the CLI input boundary rather than redefined here.
 */

export const MAX_BOUNDED_KEY_CHARS = 200;
export const MAX_BOUNDED_TEXT_CHARS = 2000;
export const MAX_LEARNING_SUMMARY_CHARS = 4000;

export const PROTOCOL_VERSION = "long-running-execution-protocol@1" as const;
export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);

/**
 * M26 §2: opaque provider identity. AIQT never loads, interprets, or
 * dynamically imports a provider based on this value -- it is bounded,
 * namespaced, syntactically-validated data only.
 */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,127}$/;
export const ProviderIdSchema = z.string().regex(PROVIDER_ID_PATTERN);

export const ExecutionProviderRefSchema = z
  .object({
    providerId: ProviderIdSchema,
    externalSessionId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS).optional(),
  })
  .strict();
export type ExecutionProviderRef = z.infer<typeof ExecutionProviderRefSchema>;

/**
 * M26 §3.2: `mode: "managed"` requires all three M25 binding fields;
 * `mode: "none"` requires none of them. Enforced in the parent schema's
 * superRefine (workspaceId/workspaceBindingId/workspaceGeneration are only
 * meaningful together).
 */
export const ExecutionWorkspaceRefModeSchema = z.enum(["managed", "none"]);
export const ExecutionWorkspaceRefSchema = z
  .object({
    mode: ExecutionWorkspaceRefModeSchema,
    workspaceId: z.string().min(1).optional(),
    workspaceBindingId: z.string().min(1).optional(),
    workspaceGeneration: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "managed") {
      if (value.workspaceId === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workspaceId is required when mode is 'managed'", path: ["workspaceId"] });
      }
      if (value.workspaceBindingId === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workspaceBindingId is required when mode is 'managed'", path: ["workspaceBindingId"] });
      }
      if (value.workspaceGeneration === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workspaceGeneration is required when mode is 'managed'", path: ["workspaceGeneration"] });
      }
    } else {
      if (value.workspaceId !== undefined || value.workspaceBindingId !== undefined || value.workspaceGeneration !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "workspaceId/workspaceBindingId/workspaceGeneration must not be set when mode is 'none'" });
      }
    }
  });
export type ExecutionWorkspaceRef = z.infer<typeof ExecutionWorkspaceRefSchema>;

export const ExecutionSessionStatusSchema = z.enum([
  "planned",
  "running",
  "paused",
  "blocked",
  "stale",
  "failed",
  "completed",
  "cancelled",
]);
export type ExecutionSessionStatus = z.infer<typeof ExecutionSessionStatusSchema>;

/** M26 §4.1: sessions in these statuses accept no further transition. */
export const TERMINAL_SESSION_STATUSES: ReadonlySet<ExecutionSessionStatus> = new Set([
  "failed",
  "completed",
  "cancelled",
]);
export function isTerminalSessionStatus(status: ExecutionSessionStatus): boolean {
  return TERMINAL_SESSION_STATUSES.has(status);
}

export const ExecutionBudgetStateSchema = z.enum(["not_configured", "within", "reached", "exceeded"]);
export type ExecutionBudgetState = z.infer<typeof ExecutionBudgetStateSchema>;

export const ExecutionBudgetsSchema = z
  .object({
    maxIterations: z.number().int().min(1).max(100).optional(),
    maxTokens: z.number().int().min(1).max(1_000_000_000).optional(),
    maxDurationSeconds: z.number().int().min(1).max(604800).optional(),
    staleAfterSeconds: z.number().int().min(60).max(2_592_000).optional(),
  })
  .strict();
export type ExecutionBudgets = z.infer<typeof ExecutionBudgetsSchema>;

export const ExecutionIterationStatusSchema = z.enum(["running", "completed", "failed", "blocked", "cancelled"]);
export type ExecutionIterationStatus = z.infer<typeof ExecutionIterationStatusSchema>;

/** M26 §3.5: metadata only -- never proves Git existence, never executed. */
export const ExecutionCommitRefSchema = z
  .object({
    id: z.string().min(1),
    sha: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    message: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    reportedAt: z.string(),
  })
  .strict();
export type ExecutionCommitRef = z.infer<typeof ExecutionCommitRefSchema>;

export const ExecutionIterationSchema = z
  .object({
    id: z.string().min(1),
    providerIterationKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    sequence: z.number().int().positive(),
    status: ExecutionIterationStatusSchema,
    objectiveSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    resultSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    reportedTokens: z.number().int().min(0).optional(),
    reportedDurationSeconds: z.number().int().min(0).optional(),
    commitRefs: z.array(ExecutionCommitRefSchema).max(MAX_COMMIT_REFS_PER_SESSION),
    evidenceRefs: z.array(z.string()).max(MAX_EVIDENCE_REFS_PER_SESSION),
  })
  .strict();
export type ExecutionIteration = z.infer<typeof ExecutionIterationSchema>;

export const ExecutionDecisionStatusSchema = z.enum(["open", "resolved"]);
export type ExecutionDecisionStatus = z.infer<typeof ExecutionDecisionStatusSchema>;

export const ExecutionDecisionSchema = z
  .object({
    id: z.string().min(1),
    providerDecisionKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    status: ExecutionDecisionStatusSchema,
    title: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    question: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    contextSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    options: z.array(z.string().max(MAX_BOUNDED_TEXT_CHARS)).max(50),
    requestedAt: z.string(),
    resolvedAt: z.string().optional(),
    selectedOption: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    resolutionSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  })
  .strict();
export type ExecutionDecision = z.infer<typeof ExecutionDecisionSchema>;

/** M26 §3.5: unverified, provider-reported historical metadata only -- never executes Git or alters a workspace. */
export const ExecutionRollbackRecordSchema = z
  .object({
    id: z.string().min(1),
    providerRollbackKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    reportedAt: z.string(),
    targetRef: z.string().max(MAX_BOUNDED_KEY_CHARS).optional(),
    reasonSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    scope: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  })
  .strict();
export type ExecutionRollbackRecord = z.infer<typeof ExecutionRollbackRecordSchema>;

export const ExecutionSessionStatusTransitionSchema = z
  .object({
    fromStatus: ExecutionSessionStatusSchema,
    toStatus: ExecutionSessionStatusSchema,
    reason: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    at: z.string(),
  })
  .strict();
export type ExecutionSessionStatusTransition = z.infer<typeof ExecutionSessionStatusTransitionSchema>;

/** M26 §4.3: replay/idempotency receipt -- never the raw event payload. */
export const ExecutionEventReceiptSchema = z
  .object({
    eventId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    digest: z.string().min(1),
    appliedAt: z.string(),
  })
  .strict();
export type ExecutionEventReceipt = z.infer<typeof ExecutionEventReceiptSchema>;

/**
 * M26 §3.1: canonical execution-session metadata record. No credentials,
 * billing data, raw prompts, transcripts, logs, diffs, or source files are
 * ever persisted here -- only bounded summaries and opaque references.
 * `protocolVersion` is a fixed literal; there is no dynamic protocol
 * negotiation or loading.
 */
export const ExecutionSessionSchema = z
  .object({
    id: z.string().min(1),
    protocolVersion: ProtocolVersionSchema,
    sessionClientKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    provider: ExecutionProviderRefSchema,
    workUnitId: z.string().min(1),
    packetId: z.string().min(1),
    workspaceRef: ExecutionWorkspaceRefSchema,
    status: ExecutionSessionStatusSchema,
    budgets: ExecutionBudgetsSchema.optional(),
    budgetState: ExecutionBudgetStateSchema,
    stopCondition: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
    iterations: z.array(ExecutionIterationSchema).max(MAX_ITERATIONS_PER_SESSION),
    decisions: z.array(ExecutionDecisionSchema).max(MAX_DECISIONS_PER_SESSION),
    rollbackRecords: z.array(ExecutionRollbackRecordSchema).max(MAX_ROLLBACK_RECORDS_PER_SESSION),
    commitRefs: z.array(ExecutionCommitRefSchema).max(MAX_COMMIT_REFS_PER_SESSION),
    evidenceRefs: z.array(z.string()).max(MAX_EVIDENCE_REFS_PER_SESSION),
    learningSummary: z.string().max(MAX_LEARNING_SUMMARY_CHARS).optional(),
    statusTransitions: z.array(ExecutionSessionStatusTransitionSchema).max(MAX_STATUS_TRANSITIONS_PER_SESSION),
    eventReceipts: z.array(ExecutionEventReceiptSchema).max(MAX_EVENT_RECEIPTS_PER_SESSION),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastActivityAt: z.string(),
    staleAt: z.string().optional(),
    terminalAt: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const openDecisions = value.decisions.filter((d) => d.status === "open").length;
    if (openDecisions > MAX_OPEN_DECISIONS_PER_SESSION) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ExecutionSession exceeds max_open_decisions_per_session (${MAX_OPEN_DECISIONS_PER_SESSION})`,
        path: ["decisions"],
      });
    }
    const runningIterations = value.iterations.filter((i) => i.status === "running").length;
    if (runningIterations > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most one iteration may be running per session",
        path: ["iterations"],
      });
    }
    if (isTerminalSessionStatus(value.status) !== (value.terminalAt !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "terminalAt must be set if and only if status is terminal (failed/completed/cancelled)",
        path: ["terminalAt"],
      });
    }
    if (JSON.stringify(value).length > MAX_SERIALIZED_SESSION_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ExecutionSession exceeds max_serialized_session_bytes (${MAX_SERIALIZED_SESSION_BYTES})`,
      });
    }
  });
export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
