import { z } from "zod";
import { ReleaseEvidenceStatusSchema } from "./release-governance.schema.js";

/**
 * M40-WU03: the validated shape of the JSON body every `aiqt release *`
 * command accepts via --from-file/--stdin. Kept separate from
 * release-governance.schema.ts (the persisted/output contract) since this
 * is an input-only, `.strict()` request shape -- unknown fields are
 * rejected rather than silently ignored, matching M23/M27 import
 * conventions elsewhere in this repository.
 */

const RiskLevelSchema = z.enum(["low", "medium", "high", "unknown"]);
const ConfidenceLevelSchema = z.enum(["high", "medium", "low", "unknown"]);
const MaturityLevelSchema = z.enum(["proven", "limited", "none", "unknown"]);
const DeclaredAspectSchema = z.boolean().nullable();

export const ReleaseRiskSignalsRequestSchema = z
  .object({
    regressionExposureLevel: RiskLevelSchema,
    blastRadiusLevel: RiskLevelSchema,
    testConfidenceLevel: ConfidenceLevelSchema,
    operationalComplexityLevel: RiskLevelSchema,
    breakingChangesDeclared: DeclaredAspectSchema,
    migrationDeclared: DeclaredAspectSchema,
    rollbackDeclared: DeclaredAspectSchema,
    dogfoodMaturityLevel: MaturityLevelSchema,
    knownLimitationsDeclared: DeclaredAspectSchema,
  })
  .strict();

export const ReleaseMilestoneRequestSchema = z
  .object({
    milestoneId: z.string().min(1),
    tag: z.string().min(1).nullable().optional(),
    closureCommit: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ReleaseDecisionRequestSchema = z
  .object({
    repositoryIdentity: z.string().min(1),
    packageVersion: z.string().min(1),
    schemaVersion: z.string().nullable().optional(),
    intendedReleaseTag: z.string().min(1),
    candidateRef: z.string().min(1).optional(),
    baseRelease: z.string().nullable().optional(),
    milestones: z.array(ReleaseMilestoneRequestSchema).min(1),
    ciCommit: z.string().nullable().optional(),
    ciRunIdentity: z.string().nullable().optional(),
    ciStatus: ReleaseEvidenceStatusSchema.optional(),
    validationEvidenceDigest: z.string().nullable().optional(),
    securityEvidenceStatus: ReleaseEvidenceStatusSchema.optional(),
    releaseNotesDigest: z.string().nullable().optional(),
    declaredNotApplicable: z.array(z.string()).optional(),
    declaredPresent: z.array(z.string()).optional(),
    riskSignals: ReleaseRiskSignalsRequestSchema.optional(),
  })
  .strict();
export type ReleaseDecisionRequestBody = z.infer<typeof ReleaseDecisionRequestSchema>;
