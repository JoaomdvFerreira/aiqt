import { describe, it, expect } from "vitest";
import { buildReleaseCandidate, type ReleaseIntentInput } from "../../src/workflow/release-candidate.js";
import { buildReleaseProvenance, type ReleaseProvenanceFacts } from "../../src/workflow/release-provenance.js";
import { assessReleaseReadiness, type ReleaseReadinessFacts } from "../../src/workflow/release-readiness.js";

const input: ReleaseIntentInput = {
  repositoryIdentity: "example/widget",
  packageVersion: "1.2.0",
  schemaVersion: null,
  intendedReleaseTag: "v1.2.0",
  candidateCommit: "abc1234def5678",
  baseRelease: null,
  milestones: [
    { milestoneId: "m1", title: "One", status: "done", tag: "m1-tag", tagCommit: "abc1234def5678", closureCommit: "abc1234def5678" },
  ],
};

const goodFacts: ReleaseProvenanceFacts = {
  ciCommit: "abc1234def5678",
  ciRunIdentity: "run-1",
  ciStatus: "verified",
  validationEvidenceDigest: "sha256:aaaa",
  securityEvidenceStatus: "verified",
  releaseNotesDigest: "sha256:bbbb",
  riskAssessmentVersion: "release-risk-v1",
  approvalAuthorityDecision: null,
};

const fullDeclarations: ReleaseReadinessFacts = {
  tagAlreadyExists: false,
  declaredNotApplicable: [],
  declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
};

function candidate(overrides: Partial<ReleaseIntentInput> = {}) {
  const result = buildReleaseCandidate({ ...input, ...overrides });
  if (!result.ok) throw new Error("expected candidate build to succeed");
  return result.candidate;
}

describe("release readiness: fully satisfied candidate is ready", () => {
  it("integrity is 'ready' with no blocking findings or warnings", () => {
    const c = candidate();
    const provenance = buildReleaseProvenance(c, goodFacts);
    const readiness = assessReleaseReadiness(c, provenance, fullDeclarations, () => "2026-01-01T00:00:00.000Z");
    expect(readiness.integrity).toBe("ready");
    expect(readiness.blockingFindings).toEqual([]);
    expect(readiness.warnings).toEqual([]);
  });
});

describe("release readiness: hard blockers", () => {
  it("blocks when a milestone is not completed", () => {
    const c = candidate({ milestones: [{ milestoneId: "m1", title: "One", status: "in_progress", tag: "m1-tag", tagCommit: "abc1234def5678", closureCommit: "abc1234def5678" }] });
    const provenance = buildReleaseProvenance(c, goodFacts);
    const readiness = assessReleaseReadiness(c, provenance, fullDeclarations);
    expect(readiness.integrity).toBe("blocked");
    expect(readiness.blockingFindings.some((f) => f.id === "RELEASE-READINESS-MILESTONE-NOT-DONE")).toBe(true);
  });

  it("blocks when the intended release tag already exists", () => {
    const c = candidate();
    const provenance = buildReleaseProvenance(c, goodFacts);
    const readiness = assessReleaseReadiness(c, provenance, { ...fullDeclarations, tagAlreadyExists: true });
    expect(readiness.integrity).toBe("blocked");
    expect(readiness.blockingFindings.some((f) => f.id === "RELEASE-READINESS-TAG-CONFLICT")).toBe(true);
  });

  it("blocks on a CI-commit/candidate-commit provenance mismatch", () => {
    const c = candidate();
    const provenance = buildReleaseProvenance(c, { ...goodFacts, ciCommit: "0000000000000" });
    const readiness = assessReleaseReadiness(c, provenance, fullDeclarations);
    expect(readiness.integrity).toBe("blocked");
    expect(readiness.blockingFindings.some((f) => f.id === "RELEASE-PROVENANCE-CI-COMMIT-MISMATCH")).toBe(true);
  });
});

describe("release readiness: insufficient_evidence vs blocked stay distinct", () => {
  it("reports 'insufficient_evidence' (not 'blocked') when core evidence is missing but nothing else is wrong", () => {
    const c = candidate();
    const provenance = buildReleaseProvenance(c, { ...goodFacts, ciStatus: "missing" });
    const readiness = assessReleaseReadiness(c, provenance, fullDeclarations);
    expect(readiness.integrity).toBe("insufficient_evidence");
    expect(readiness.blockingFindings.some((f) => f.id === "RELEASE-READINESS-CI-MISSING")).toBe(true);
  });
});

describe("release readiness: not_applicable is distinct from missing", () => {
  it("a declared-not-applicable optional artifact produces no warning and appears in notApplicable", () => {
    const c = candidate();
    const provenance = buildReleaseProvenance(c, goodFacts);
    const readiness = assessReleaseReadiness(c, provenance, { ...fullDeclarations, declaredPresent: [], declaredNotApplicable: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"] });
    expect(readiness.integrity).toBe("ready");
    expect(readiness.notApplicable).toContain("breakingChanges");
  });

  it("an undeclared optional artifact (neither present nor not-applicable) produces a warning, not a blocker", () => {
    const c = candidate();
    const provenance = buildReleaseProvenance(c, goodFacts);
    const readiness = assessReleaseReadiness(c, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    expect(readiness.integrity).toBe("ready_with_warnings");
    expect(readiness.warnings.some((w) => w.id === "RELEASE-READINESS-BREAKINGCHANGES-UNDECLARED")).toBe(true);
    expect(readiness.blockingFindings).toEqual([]);
  });
});
