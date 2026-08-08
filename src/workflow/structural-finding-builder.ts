import type {
  StructuralFinding,
  StructuralFindingConfidence,
  StructuralFindingDisposition,
  StructuralFindingEvidence,
  StructuralFindingSignificance,
  StructuralReviewDomain,
} from "../schema/structural-review.schema.js";
import { computeStructuralFindingFingerprint } from "./structural-finding-fingerprint.js";

export interface BuildFindingInput {
  domain: StructuralReviewDomain;
  ruleId: string;
  title: string;
  explanation: string;
  reviewCommit: string;
  affectedPaths: string[];
  affectedOwners?: string[];
  evidence: StructuralFindingEvidence[];
  confidence: StructuralFindingConfidence;
  significance: StructuralFindingSignificance;
  reasonCodes: string[];
  evidenceGaps?: string[];
  disposition: StructuralFindingDisposition;
  eligibleForIntake: boolean;
  recommendedNextAction: string;
  evidenceSignature: string;
  providerSource?: string;
}

/** Shared construction path every rule uses -- guarantees a consistent, deterministic findingKey (Section 3.2/6.1). */
export function buildStructuralFinding(input: BuildFindingInput): StructuralFinding {
  return {
    findingKey: computeStructuralFindingFingerprint({
      domain: input.domain,
      ruleId: input.ruleId,
      evidenceSignature: input.evidenceSignature,
    }),
    domain: input.domain,
    ruleId: input.ruleId,
    title: input.title,
    explanation: input.explanation,
    reviewCommit: input.reviewCommit,
    affectedPaths: input.affectedPaths,
    affectedOwners: input.affectedOwners,
    evidence: input.evidence,
    confidence: input.confidence,
    significance: input.significance,
    reasonCodes: input.reasonCodes,
    evidenceGaps: input.evidenceGaps ?? [],
    disposition: input.disposition,
    eligibleForIntake: input.eligibleForIntake,
    recommendedNextAction: input.recommendedNextAction,
    providerSource: input.providerSource ?? "repository-local",
  };
}
