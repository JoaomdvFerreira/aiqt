import { z } from "zod";
import {
  ProtocolVersionSchema,
  ProviderIdSchema,
  ExecutionSessionStatusSchema,
  ExecutionIterationStatusSchema,
  ExecutionBudgetsSchema,
  MAX_BOUNDED_KEY_CHARS,
  MAX_BOUNDED_TEXT_CHARS,
  MAX_LEARNING_SUMMARY_CHARS,
  MAX_EVENTS_PER_ENVELOPE,
  MAX_COMMIT_REFS_PER_SESSION,
  MAX_EVIDENCE_REFS_PER_SESSION,
} from "./execution-session.schema.js";

/**
 * M26 §4.2: the ten supported protocol event types. Unknown event types
 * are invalid -- there is no passthrough or extension mechanism. Every
 * event carries `eventId` (scoped by providerId+sessionClientKey+eventId
 * per §4.3) and `at` (the provider's own reported time for that fact --
 * used only for the domain-specific timestamp it reports, e.g. an
 * iteration's startedAt; never for session-level bookkeeping like
 * terminalAt/updatedAt, which are always the import call's own
 * effectiveNow so the seven-day grace boundary can never be gamed by a
 * spoofed event timestamp).
 */
const EventBaseSchema = z.object({
  eventId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
  at: z.string().min(1),
});

const CommitRefInputSchema = z
  .object({
    sha: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    message: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  })
  .strict();

export const SessionOpenedEventSchema = EventBaseSchema.extend({
  type: z.literal("session.opened"),
  externalSessionId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS).optional(),
  budgets: ExecutionBudgetsSchema.optional(),
}).strict();

export const SessionStatusChangedEventSchema = EventBaseSchema.extend({
  type: z.literal("session.status_changed"),
  toStatus: ExecutionSessionStatusSchema,
  reason: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
}).strict();

export const SessionBudgetUpdatedEventSchema = EventBaseSchema.extend({
  type: z.literal("session.budget_updated"),
  budgets: ExecutionBudgetsSchema,
}).strict();

export const IterationStartedEventSchema = EventBaseSchema.extend({
  type: z.literal("iteration.started"),
  providerIterationKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
  objectiveSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
}).strict();

export const IterationFinishedEventSchema = EventBaseSchema.extend({
  type: z.literal("iteration.finished"),
  providerIterationKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
  status: ExecutionIterationStatusSchema.exclude(["running"]),
  resultSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  reportedTokens: z.number().int().min(0).optional(),
  reportedDurationSeconds: z.number().int().min(0).optional(),
  commitRefs: z.array(CommitRefInputSchema).max(MAX_COMMIT_REFS_PER_SESSION).optional(),
  evidenceRefs: z.array(z.string()).max(MAX_EVIDENCE_REFS_PER_SESSION).optional(),
}).strict();

export const DecisionRequestedEventSchema = EventBaseSchema.extend({
  type: z.literal("decision.requested"),
  providerDecisionKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
  title: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  question: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  contextSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  options: z.array(z.string().max(MAX_BOUNDED_TEXT_CHARS)).max(50).optional(),
}).strict();

export const DecisionResolvedEventSchema = EventBaseSchema.extend({
  type: z.literal("decision.resolved"),
  providerDecisionKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
  selectedOption: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  resolutionSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
}).strict();

export const RollbackReportedEventSchema = EventBaseSchema.extend({
  type: z.literal("rollback.reported"),
  providerRollbackKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
  targetRef: z.string().max(MAX_BOUNDED_KEY_CHARS).optional(),
  reasonSummary: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
  scope: z.string().max(MAX_BOUNDED_TEXT_CHARS).optional(),
}).strict();

export const SessionSummaryUpdatedEventSchema = EventBaseSchema.extend({
  type: z.literal("session.summary_updated"),
  learningSummary: z.string().min(1).max(MAX_LEARNING_SUMMARY_CHARS),
}).strict();

export const SessionReferencesAddedEventSchema = EventBaseSchema.extend({
  type: z.literal("session.references_added"),
  commitRefs: z.array(CommitRefInputSchema).max(MAX_COMMIT_REFS_PER_SESSION).optional(),
  evidenceRefs: z.array(z.string()).max(MAX_EVIDENCE_REFS_PER_SESSION).optional(),
}).strict();

export const ExecutionProtocolEventSchema = z.discriminatedUnion("type", [
  SessionOpenedEventSchema,
  SessionStatusChangedEventSchema,
  SessionBudgetUpdatedEventSchema,
  IterationStartedEventSchema,
  IterationFinishedEventSchema,
  DecisionRequestedEventSchema,
  DecisionResolvedEventSchema,
  RollbackReportedEventSchema,
  SessionSummaryUpdatedEventSchema,
  SessionReferencesAddedEventSchema,
]);
export type ExecutionProtocolEvent = z.infer<typeof ExecutionProtocolEventSchema>;

/**
 * M26 §4.2: one envelope always targets exactly one session (providerId +
 * sessionClientKey are constant for every event in the batch) -- an
 * envelope never fans out across multiple sessions.
 */
export const ExecutionProtocolEnvelopeSchema = z
  .object({
    protocolVersion: ProtocolVersionSchema,
    providerId: ProviderIdSchema,
    sessionClientKey: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    events: z.array(ExecutionProtocolEventSchema).min(1).max(MAX_EVENTS_PER_ENVELOPE),
  })
  .strict();
export type ExecutionProtocolEnvelope = z.infer<typeof ExecutionProtocolEnvelopeSchema>;
