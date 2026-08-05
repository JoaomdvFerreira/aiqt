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
import { AutonomousAgentProposedCommandSchema } from "./autonomous-agent-request.schema.js";
import { SandboxEvidenceSchema } from "./sandbox-backend.schema.js";

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
    /**
     * M37-WU03: the id of the AutonomousAgentRequest (M37-WU02) built for
     * this run's real (non-simulated) execution, once `aiqt autonomous
     * run` (without --simulate) has created one. Null until then, and
     * for every simulated run.
     */
    agentRequestId: z.string().min(1).nullable(),
    /**
     * M37-WU03: real validation commands, supplied at classify time
     * (`--targeted-validation-command`/`--authoritative-validation-
     * command`), used only by the real (non-simulated) completion path
     * (autonomous-agent-import.command.ts) -- an empty
     * targetedValidationCommands list preserves M36-WU04's own "no pass
     * without validation" invariant unchanged (runAutonomousValidation
     * itself still enforces this; this record only carries the operator's
     * declared commands through to that call).
     */
    targetedValidationCommands: z.array(AutonomousAgentProposedCommandSchema),
    authoritativeValidationCommands: z.array(AutonomousAgentProposedCommandSchema),
    /**
     * M38-WU04: the Docker container id of this run's real sandbox,
     * persisted IMMEDIATELY after a real `create()` succeeds -- before
     * any command ever runs inside it. This is the crash-recovery
     * anchor: if AIQT itself crashes mid-run (the Node process dies
     * before its own `cleanup()` call), a LATER `aiqt autonomous
     * cleanup` invocation (a fresh process, a fresh Docker connection)
     * can still find and destroy the orphaned container by this id.
     * Null for every simulated or non-live run, and for a live run
     * that never reached real sandbox creation.
     */
    sandboxContainerId: z.string().min(1).nullable(),
    /**
     * M38-WU04: the real SandboxEvidence (M38-WU01/WU03) a live
     * (`--live`) run produced, distinct from `evidencePacket` above
     * (the M36 bare-worktree evidence shape a non-live run produces).
     * A single run is always exactly one or the other, never both --
     * `aiqt autonomous agent-import` picks the live or non-live path
     * once, at the start, based on `--live`.
     */
    sandboxEvidence: SandboxEvidenceSchema.nullable(),
  })
  .strict();
export type AutonomousRunRecord = z.infer<typeof AutonomousRunRecordSchema>;
