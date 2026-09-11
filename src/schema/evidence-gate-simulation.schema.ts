import { z } from "zod";
import { TrustLevelSchema } from "./evidence.schema.js";
import { TargetScopeSchema } from "./evidence-gate-policy.schema.js";

export const EVIDENCE_GATE_SIMULATION_PROTOCOL_VERSION = "aiqt-evidence-gate-simulation@1" as const;
export const EVIDENCE_SNAPSHOT_PROTOCOL_VERSION = "aiqt-evidence-snapshot@1" as const;
export const EVIDENCE_GATE_SIMULATION_DIGEST_PROTOCOL_VERSION = "aiqt-evidence-gate-simulation-digest@1" as const;

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const SimulationTargetSchema = z
  .object({
    type: TargetScopeSchema,
    id: z.string().min(1),
    relatedProjectId: z.string().min(1),
    relatedWorkUnitId: z.string().min(1).optional(),
  })
  .strict();
export type SimulationTarget = z.infer<typeof SimulationTargetSchema>;

export const OverallResultSchema = z.enum(["pass", "fail", "indeterminate"]);
export type OverallResult = z.infer<typeof OverallResultSchema>;

export const RuleResultOutcomeSchema = z.enum(["pass", "fail", "indeterminate", "not_applicable"]);
export type RuleResultOutcome = z.infer<typeof RuleResultOutcomeSchema>;

/** M28 §5.2: a bounded, stable enum -- never a free-text explanation. */
export const ReasonCodeSchema = z.enum([
  "target_not_applicable",
  "sufficient_evidence",
  "insufficient_evidence",
  "insufficient_evidence_indeterminate",
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export const RejectedCandidateCountsSchema = z
  .object({
    wrongArtifactKind: z.number().int().min(0),
    insufficientTrust: z.number().int().min(0),
    wrongScope: z.number().int().min(0),
    stale: z.number().int().min(0),
    unsuccessfulOutcome: z.number().int().min(0),
    invalidReference: z.number().int().min(0),
  })
  .strict();
export type RejectedCandidateCounts = z.infer<typeof RejectedCandidateCountsSchema>;

export const EvidenceGateRuleResultSchema = z
  .object({
    ruleId: z.string().min(1),
    result: RuleResultOutcomeSchema,
    requiredCount: z.number().int().positive(),
    matchedCount: z.number().int().min(0),
    matchedEvidenceRefs: z.array(z.string()).max(1000),
    rejectedCandidateCounts: RejectedCandidateCountsSchema,
    reasonCode: ReasonCodeSchema,
    summary: z.string().max(2000),
  })
  .strict();
export type EvidenceGateRuleResult = z.infer<typeof EvidenceGateRuleResultSchema>;

export const EvidenceGateSimulationSchema = z
  .object({
    protocolVersion: z.literal(EVIDENCE_GATE_SIMULATION_PROTOCOL_VERSION),
    policy: z
      .object({
        policyId: z.string().min(1),
        version: z.number().int().positive(),
        digest: Sha256DigestSchema,
      })
      .strict(),
    target: SimulationTargetSchema,
    asOf: z.string(),
    overallResult: OverallResultSchema,
    ruleResults: z.array(EvidenceGateRuleResultSchema).max(100),
    evidenceSnapshotDigest: Sha256DigestSchema,
    simulationDigest: Sha256DigestSchema,
    generatedAt: z.string(),
  })
  .strict();
export type EvidenceGateSimulation = z.infer<typeof EvidenceGateSimulationSchema>;

/** M28 §5.7.1: internal normalized snapshot entry -- never exported/persisted raw; only feeds the digest. */
export const NormalizedEvidenceSnapshotEntrySchema = z
  .object({
    evidenceId: z.string().min(1),
    trust: TrustLevelSchema,
    scopeRefs: z.array(z.string()),
    artifactKinds: z.array(z.string()),
    freshnessTimestamp: z.string().nullable(),
    validationResult: z.enum(["passed", "failed", "partial", "not_run", "unknown"]),
    referenceValidity: z.enum(["valid", "invalid"]),
  })
  .strict();
export type NormalizedEvidenceSnapshotEntry = z.infer<typeof NormalizedEvidenceSnapshotEntrySchema>;
