import { z } from "zod";
import {
  AutonomousCandidateSchema,
  AutonomousSafetyAssessmentSchema,
  AutonomousBudgetsSchema,
  AutonomousExecutionPolicySchema,
  AutonomousRunStatusSchema,
  AutonomousEvidencePacketSchema,
  AutonomousRunEventTypeSchema,
} from "./autonomous-run.schema.js";

/**
 * M37-WU01: the persisted, CLI-visible record of one autonomous run --
 * distinct from AutonomousEvidencePacket (M36-WU01, the terminal-only
 * output of a completed pipeline). A run record exists from the moment
 * `aiqt autonomous classify` creates it, tracks the M36 lifecycle status
 * across multiple CLI invocations (classify -> approve -> run -> status/
 * cancel/result -> cleanup), and only ever gains an `evidencePacket` once
 * `aiqt autonomous run` has produced one (real or, in this Work Unit,
 * always simulated). Persisted as one JSON file per run under the
 * resolved operator evidenceOutputDir (src/services/autonomous-run-
 * store.ts) -- never under this repository's own `.aiqt/`, and never
 * requiring an AIQT project to exist at all.
 */
export const AutonomousApprovalRecordSchema = z
  .object({
    approvedAt: z.string().min(1),
    /** "interactive" (confirmed via a TTY prompt) or "--yes" (non-interactive flag) -- never a free-form operator identity, since this repository has no user-account concept. */
    approvedBy: z.enum(["interactive", "--yes"]),
    /** sha256 hex digest binding this approval to the exact candidate/baseCommit/budgets it was granted for (autonomous-run-approval.ts). */
    bindingDigest: z.string().min(1),
  })
  .strict();
export type AutonomousApprovalRecord = z.infer<typeof AutonomousApprovalRecordSchema>;

export const AutonomousRunAuditEntrySchema = z
  .object({
    /** One of AUTONOMOUS_RUN_EVENT_TYPES (autonomous-run.schema.ts) -- reused verbatim, not a new event vocabulary. */
    event: AutonomousRunEventTypeSchema,
    at: z.string().min(1),
    detail: z.string().min(1),
  })
  .strict();
export type AutonomousRunAuditEntry = z.infer<typeof AutonomousRunAuditEntrySchema>;

export const AutonomousRunRecordSchema = z
  .object({
    runId: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    status: AutonomousRunStatusSchema,
    repositoryPath: z.string().min(1),
    baseCommit: z.string().min(1).nullable(),
    candidate: AutonomousCandidateSchema,
    safetyAssessment: AutonomousSafetyAssessmentSchema,
    budgets: AutonomousBudgetsSchema,
    policy: AutonomousExecutionPolicySchema,
    approval: AutonomousApprovalRecordSchema.nullable(),
    evidencePacket: AutonomousEvidencePacketSchema.nullable(),
    auditLog: z.array(AutonomousRunAuditEntrySchema),
  })
  .strict();
export type AutonomousRunRecord = z.infer<typeof AutonomousRunRecordSchema>;
