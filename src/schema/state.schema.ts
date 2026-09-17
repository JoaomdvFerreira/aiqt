import { z } from "zod";
import { WorkGraphSchema } from "./work-graph.schema.js";
import { CheckpointSchema } from "./checkpoint.schema.js";
import { AgentPacketMetadataSchema } from "./agent-packet.schema.js";
import { ReviewAcknowledgmentStateSchema } from "./review-acknowledgment.schema.js";
import { IssueStateSchema } from "./issue-state.schema.js";
import { CheckpointAmendmentSchema } from "./checkpoint-amendment.schema.js";
import { ReviewRecordSchema } from "./review-record.schema.js";
import { EvidenceStateSchema } from "./evidence.schema.js";
import { WorkspaceStateSchema } from "./managed-workspace.schema.js";
import { ExecutionSessionSchema, MAX_SESSIONS } from "./execution-session.schema.js";
import { ExecutionAdapterRequestSchema, MAX_ADAPTER_REQUESTS } from "./execution-adapter-request.schema.js";
import { EvidenceGateConfigurationSchema } from "./evidence-gate-policy.schema.js";
import { CheckpointEvidenceAdvisorySchema } from "./checkpoint-evidence-advisory.schema.js";
import { EvidenceAdvisoryFeedbackSchema, MAX_EVIDENCE_ADVISORY_FEEDBACK } from "./evidence-advisory-feedback.schema.js";
import { EvidenceEnforcementProfileSchema, MAX_ENFORCEMENT_PROFILES } from "./evidence-enforcement-profile.schema.js";
import { RequiredRuleRecoveryProofSchema, MAX_RECOVERY_PROOFS } from "./required-rule-recovery-proof.schema.js";
import { RequiredModeActivationPlanSchema, MAX_ACTIVATION_PLANS } from "./required-mode-activation-plan.schema.js";
import { RequiredModeActivationSchema } from "./required-mode-activation.schema.js";
import { RequiredEvidenceExceptionSchema, MAX_EXCEPTIONS } from "./required-evidence-exception.schema.js";
import { DefectRecordSchema, MAX_DEFECTS } from "./defect.schema.js";
import { MaintenanceScheduleSchema, MaintenanceOccurrenceRecordSchema, MAX_MAINTENANCE_SCHEDULES } from "./maintenance-schedule.schema.js";
import { NightAuditCoverageEntrySchema, NightAuditActiveSessionRecordSchema, MAX_NIGHT_AUDIT_COVERAGE_ENTRIES } from "./night-audit.schema.js";

export const ProjectStatusSchema = z.enum([
  "draft",
  "planned",
  "in_progress",
  "blocked",
  "review",
  "done",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const StateModelSchema = z.object({
  version: z.string(),
  projectStatus: ProjectStatusSchema,
  currentMilestoneId: z.string().nullable(),
  currentWorkUnitId: z.string().nullable(),
  workGraph: WorkGraphSchema,
  checkpoints: z.array(CheckpointSchema),
  lastAgentPacket: AgentPacketMetadataSchema.nullable(),
  nextRecommendedCommand: z.string().nullable(),
  lastUpdatedAt: z.string(),
  /** M9 §7.2: optional, additive. Missing entirely on pre-M9 state files. */
  review: ReviewAcknowledgmentStateSchema.optional(),
  /** M11 §8.2: optional, additive. Missing entirely on pre-M11 state files. */
  issues: IssueStateSchema.optional(),
  /** M12 §6.1: optional, additive. Missing entirely on pre-M12 state files. */
  checkpointAmendments: z.array(CheckpointAmendmentSchema).optional(),
  /** Append-only post-handoff review history. Legacy amendments are projected when this is absent. */
  reviewRecords: z.array(ReviewRecordSchema).optional(),
  /** M22-WU02: optional, additive. Missing entirely on pre-M22 state files. */
  evidence: EvidenceStateSchema.optional(),
  /** M25 §5: optional, additive. Missing entirely on pre-M25 state files. */
  workspace: WorkspaceStateSchema.optional(),
  /** M26 §3: optional, additive. Missing entirely on pre-M26 state files; never materialized by a read-only command. */
  executionSessions: z.array(ExecutionSessionSchema).max(MAX_SESSIONS).optional(),
  /** M27 §3.1: optional, additive. Missing entirely on pre-M27 state files; never materialized by a read-only command. */
  executionAdapterRequests: z.array(ExecutionAdapterRequestSchema).max(MAX_ADAPTER_REQUESTS).optional(),
  /** M28 §3: optional, additive. Missing entirely on pre-M28 state files; never materialized by a read-only command. */
  evidenceGate: EvidenceGateConfigurationSchema.optional(),
  /**
   * M29 §3.3: optional, additive. Missing entirely on pre-M29 state files
   * and on historical checkpoints with no advisory yet. One entry per
   * checkpoint that has ever been advisory-evaluated; current/latest-N
   * mirror only, never the complete advisory history (the runlog is).
   */
  checkpointEvidenceAdvisories: z.array(CheckpointEvidenceAdvisorySchema).optional(),
  /**
   * M29 §5.1: optional, additive. Missing entirely on pre-M29 state files.
   * One current feedback record per issueKey; capped at
   * MAX_EVIDENCE_ADVISORY_FEEDBACK per project.
   */
  evidenceAdvisoryFeedback: z.array(EvidenceAdvisoryFeedbackSchema).max(MAX_EVIDENCE_ADVISORY_FEEDBACK).optional(),
  /** M30 §4.1: optional, additive. Missing entirely on pre-M30 state files. Immutable, versioned; never edited in place. */
  enforcementProfiles: z.array(EvidenceEnforcementProfileSchema).max(MAX_ENFORCEMENT_PROFILES).optional(),
  /** M30 §4.5: optional, additive. Bounded, append-only recovery-proof metadata (no raw simulation reports). */
  requiredRuleRecoveryProofs: z.array(RequiredRuleRecoveryProofSchema).max(MAX_RECOVERY_PROOFS).optional(),
  /** M30 §4.6: optional, additive. Bounded to MAX_ACTIVATION_PLANS retained; each expires after 24h. */
  requiredModeActivationPlans: z.array(RequiredModeActivationPlanSchema).max(MAX_ACTIVATION_PLANS).optional(),
  /** M30 §4.7: optional, additive. Append-only (status transitions active->deactivated in place; a new activation is a new entry). */
  requiredModeActivations: z.array(RequiredModeActivationSchema).optional(),
  /** M30 §4.8: optional, additive. Bounded scoped exceptions. */
  requiredEvidenceExceptions: z.array(RequiredEvidenceExceptionSchema).max(MAX_EXCEPTIONS).optional(),
  /**
   * M42 §4/§13: optional, additive. Missing entirely on pre-M42 state
   * files. The remediation queue IS this list (queue-eligible statuses
   * are a subset of DefectStatus, see defect-transitions.ts) -- no
   * separate `RemediationQueueEntry` list, file, or database exists.
   */
  defects: z.array(DefectRecordSchema).max(MAX_DEFECTS).optional(),
  /**
   * M45 §7: optional, additive. Missing entirely on pre-M45 state files;
   * never materialized by a read-only command. No schedule is ever created
   * or enabled by migration/defaulting -- pre-M45 state defaults to zero
   * schedules (build spec Sec 7.4).
   */
  maintenanceSchedules: z.array(MaintenanceScheduleSchema).max(MAX_MAINTENANCE_SCHEDULES).optional(),
  /**
   * M45 §8.3/§13.2: optional, additive. A nullable singleton (never an
   * array) so "no parallel scheduled maintenance" is structural. Absent
   * entirely on pre-M45 state; explicitly null (not just absent) once a
   * project has run its first occurrence and returned to idle.
   */
  maintenanceActiveOccurrence: MaintenanceOccurrenceRecordSchema.nullable().optional(),
  /**
   * M48 build spec Sec 6: optional, additive. Missing entirely on pre-M48
   * state files. One entry per (domain, scope) pair reviewed at least
   * once; upserted after each completed ReviewTask -- never rewritten
   * wholesale.
   */
  nightAuditCoverage: z.array(NightAuditCoverageEntrySchema).max(MAX_NIGHT_AUDIT_COVERAGE_ENTRIES).optional(),
  /**
   * M48 build spec Sec 6/9: optional, additive. A nullable singleton
   * (never an array) mirroring maintenanceActiveOccurrence -- "at most one
   * Night Audit session running" is structural. Absent entirely on
   * pre-M48 state; explicitly null once a project has run its first
   * session and returned to idle.
   */
  nightAuditActiveSession: NightAuditActiveSessionRecordSchema.nullable().optional(),
});
export type StateModel = z.infer<typeof StateModelSchema>;
