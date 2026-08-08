import { describe, it, expect } from "vitest";
import {
  StructuralFindingSchema,
  StructuralReviewSchema,
} from "../../src/schema/structural-review.schema.js";
import { computeStructuralFindingFingerprint } from "../../src/workflow/structural-finding-fingerprint.js";
import { evaluateStructuralFindingFreshness } from "../../src/workflow/structural-review-freshness.js";
import {
  STRUCTURAL_DOMAIN_REGISTRY,
  allStructuralDomains,
  isKnownStructuralDomain,
} from "../../src/workflow/structural-review-domains.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const NOW = "2026-08-08T00:00:00.000Z";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

function makeFinding(overrides: Partial<Parameters<typeof StructuralFindingSchema.parse>[0]> = {}) {
  return StructuralFindingSchema.parse({
    findingKey: computeStructuralFindingFingerprint({
      domain: "ownership_divergence",
      ruleId: "duplicate-decision-owner",
      evidenceSignature: "src/a.ts::src/b.ts",
    }),
    domain: "ownership_divergence",
    ruleId: "duplicate-decision-owner",
    title: "Duplicate decision owner",
    explanation: "Two modules independently implement the same governed decision.",
    reviewCommit: COMMIT_A,
    affectedPaths: ["src/a.ts", "src/b.ts"],
    evidence: [{ evidenceId: "EV1", description: "Both export the same decision function shape", locator: "src/a.ts" }],
    confidence: "strong_signal",
    significance: "medium",
    reasonCodes: ["DUPLICATE_OWNER"],
    evidenceGaps: [],
    disposition: "actionable",
    eligibleForIntake: true,
    recommendedNextAction: "Consolidate to one owner.",
    providerSource: "repository-local",
    ...overrides,
  });
}

describe("StructuralFindingSchema / StructuralReviewSchema", () => {
  it("round-trips a valid finding", () => {
    const finding = makeFinding();
    expect(StructuralFindingSchema.safeParse(finding).success).toBe(true);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const raw = { ...makeFinding(), extra: "nope" };
    expect(StructuralFindingSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects a finding with zero evidence items", () => {
    const raw = { ...makeFinding(), evidence: [] };
    expect(StructuralFindingSchema.safeParse(raw).success).toBe(false);
  });

  it("round-trips a full StructuralReview payload", () => {
    const review = StructuralReviewSchema.parse({
      reviewCommit: COMMIT_A,
      generatedAt: NOW,
      domainsRequested: allStructuralDomains(),
      domainsSupported: ["ownership_divergence"],
      domainsUnsupported: [{ domain: "execution_safety_boundary", reason: "not yet implemented" }],
      providerStatus: [{ providerId: "repository-local", available: true }],
      findings: [makeFinding()],
    });
    expect(review.findings).toHaveLength(1);
  });
});

describe("computeStructuralFindingFingerprint", () => {
  it("is deterministic for identical structural identity", () => {
    const a = computeStructuralFindingFingerprint({ domain: "ownership_divergence", ruleId: "r1", evidenceSignature: "sig" });
    const b = computeStructuralFindingFingerprint({ domain: "ownership_divergence", ruleId: "r1", evidenceSignature: "sig" });
    expect(a).toBe(b);
  });

  it("differs for a different rule or evidence signature", () => {
    const base = computeStructuralFindingFingerprint({ domain: "ownership_divergence", ruleId: "r1", evidenceSignature: "sig" });
    const diffRule = computeStructuralFindingFingerprint({ domain: "ownership_divergence", ruleId: "r2", evidenceSignature: "sig" });
    const diffSig = computeStructuralFindingFingerprint({ domain: "ownership_divergence", ruleId: "r1", evidenceSignature: "sig2" });
    expect(diffRule).not.toBe(base);
    expect(diffSig).not.toBe(base);
  });

  it("matches the sha256: shape StructuralFindingSchema.findingKey requires", () => {
    const fp = computeStructuralFindingFingerprint({ domain: "ownership_divergence", ruleId: "r1", evidenceSignature: "sig" });
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of reviewCommit -- the same real condition keeps the same key across commits", () => {
    const findingAtA = makeFinding({ reviewCommit: COMMIT_A });
    const findingAtB = makeFinding({ reviewCommit: COMMIT_B });
    expect(findingAtA.findingKey).toBe(findingAtB.findingKey);
  });
});

describe("evaluateStructuralFindingFreshness", () => {
  it("is current when reviewCommit matches HEAD", () => {
    expect(evaluateStructuralFindingFreshness(COMMIT_A, COMMIT_A)).toBe("current");
  });

  it("is stale when reviewCommit does not match HEAD", () => {
    expect(evaluateStructuralFindingFreshness(COMMIT_A, COMMIT_B)).toBe("stale");
  });
});

describe("structural domain registry", () => {
  it("covers all 7 Section 4 domains", () => {
    expect(STRUCTURAL_DOMAIN_REGISTRY).toHaveLength(7);
    expect(allStructuralDomains().sort()).toEqual(
      [
        "dependency_coupling",
        "dead_structural_paths",
        "execution_safety_boundary",
        "ownership_divergence",
        "public_contract_drift",
        "responsibility_concentration",
        "test_infrastructure",
      ].sort(),
    );
  });

  it("recognizes a known domain and rejects an unknown one", () => {
    expect(isKnownStructuralDomain("ownership_divergence")).toBe(true);
    expect(isKnownStructuralDomain("made_up_domain")).toBe(false);
  });
});

describe("canonical state is unaffected (Section 3.1: read-only, no new canonical file)", () => {
  it("StateModelSchema has no structural-review field, and initial state model still validates", () => {
    const model = buildInitialStateModel(NOW) as Record<string, unknown>;
    expect(model.structuralReview).toBeUndefined();
    expect(model.structuralFindings).toBeUndefined();
    expect(StateModelSchema.safeParse(model).success).toBe(true);
  });
});
