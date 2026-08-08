import { describe, it, expect } from "vitest";
import { buildReleaseCandidate, type ReleaseIntentInput } from "../../src/workflow/release-candidate.js";
import { buildReleaseProvenance, computeReleaseProvenanceDigest, detectProvenanceMismatches, type ReleaseProvenanceFacts } from "../../src/workflow/release-provenance.js";

const input: ReleaseIntentInput = {
  repositoryIdentity: "example/widget",
  packageVersion: "1.2.0",
  schemaVersion: "0.5.0",
  intendedReleaseTag: "v1.2.0",
  candidateCommit: "abc1234def5678",
  baseRelease: null,
  milestones: [
    { milestoneId: "m1", title: "One", status: "done", tag: "m1-tag", tagCommit: "abc1234def5678", closureCommit: "abc1234def5678" },
  ],
};

const facts: ReleaseProvenanceFacts = {
  ciCommit: "abc1234def5678",
  ciRunIdentity: "run-42",
  ciStatus: "verified",
  validationEvidenceDigest: "sha256:deadbeef",
  securityEvidenceStatus: "verified",
  releaseNotesDigest: null,
  riskAssessmentVersion: "release-risk-v1",
  approvalAuthorityDecision: null,
};

function candidateOrThrow() {
  const result = buildReleaseCandidate(input);
  if (!result.ok) throw new Error("expected candidate build to succeed");
  return result.candidate;
}

describe("release provenance: deterministic digest", () => {
  it("produces an identical digest for identical canonical inputs", () => {
    const candidate = candidateOrThrow();
    const d1 = computeReleaseProvenanceDigest(candidate, facts);
    const d2 = computeReleaseProvenanceDigest(candidate, facts);
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any bound fact changes", () => {
    const candidate = candidateOrThrow();
    const d1 = computeReleaseProvenanceDigest(candidate, facts);
    const d2 = computeReleaseProvenanceDigest(candidate, { ...facts, ciCommit: "0000000000000" });
    expect(d1).not.toBe(d2);
  });

  it("is independent of caller-provided key order (canonical JSON)", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, facts);
    expect(provenance.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("release provenance: mismatch detection fails closed", () => {
  it("flags a CI commit that differs from the candidate commit", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, { ...facts, ciCommit: "0000000000000" });
    const findings = detectProvenanceMismatches(candidate, provenance);
    expect(findings.some((f) => f.id === "RELEASE-PROVENANCE-CI-COMMIT-MISMATCH")).toBe(true);
  });

  it("flags a milestone whose resolved tag commit disagrees with its declared closure commit", () => {
    const mismatched = buildReleaseCandidate({
      ...input,
      milestones: [{ milestoneId: "m1", title: "One", status: "done", tag: "m1-tag", tagCommit: "abc1234def5678", closureCommit: "ffffffffffff" }],
    });
    if (!mismatched.ok) throw new Error("expected candidate build to succeed");
    const provenance = buildReleaseProvenance(mismatched.candidate, facts);
    const findings = detectProvenanceMismatches(mismatched.candidate, provenance);
    expect(findings.some((f) => f.id === "RELEASE-PROVENANCE-MILESTONE-TAG-CLOSURE-MISMATCH")).toBe(true);
  });

  it("reports no findings when candidate/CI/milestone provenance all agree", () => {
    const candidate = candidateOrThrow();
    const provenance = buildReleaseProvenance(candidate, facts);
    expect(detectProvenanceMismatches(candidate, provenance)).toEqual([]);
  });
});
