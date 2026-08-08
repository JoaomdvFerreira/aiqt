import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";

// M34-WU02: this file spawns real subprocesses (git, via initGitFixtureRepo).
// Uses the shared class constant, not a locally hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { assembleReleaseCandidate, assessReleaseCandidate, assessReleaseDecision, type ReleaseIntentRequest } from "../../src/services/release-governance-service.js";
import type { ReleaseRiskSignals } from "../../src/workflow/release-risk.js";

/**
 * M40-WU01: real-Git integration coverage for the orchestration layer --
 * resolving refs/tags against a real repository, detecting real tag
 * conflicts, and folding in real per-milestone tag/closure-commit
 * verification. No .aiqt/ project is created here (this repository's own
 * self-management rule) -- milestone status simply comes back null, which
 * the readiness layer already treats as an honest "unknown", not "done".
 */
describe("release-governance-service: real Git resolution", () => {
  let dir: string;
  let headCommit: string;

  beforeEach(() => {
    dir = makeTempDir("aiqt-release-governance-");
    headCommit = initGitFixtureRepo(dir);
  });

  afterEach(() => {
    removeDir(dir);
  });

  function baseRequest(overrides: Partial<ReleaseIntentRequest> = {}): ReleaseIntentRequest {
    return {
      cwd: dir,
      repositoryIdentity: "example/widget",
      packageVersion: "1.0.0",
      intendedReleaseTag: "v1.0.0",
      milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
      ...overrides,
    };
  }

  it("resolves HEAD to the real current commit", () => {
    const result = assembleReleaseCandidate(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.identity.candidateCommit).toBe(headCommit);
  });

  it("verifies a milestone tag that really points at the declared closure commit", () => {
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const result = assembleReleaseCandidate(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.milestones[0]?.evidenceStatus).toBe("verified");
    expect(result.candidate.milestones[0]?.tagCommit).toBe(headCommit);
  });

  it("treats an undeclared/unresolvable milestone tag as missing evidence, not fabricated verification", () => {
    const result = assembleReleaseCandidate(baseRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.milestones[0]?.tagCommit).toBeNull();
    expect(result.candidate.milestones[0]?.evidenceStatus).toBe("missing");
  });

  it("detects that the intended release tag already exists as a real conflict", () => {
    execFileSync("git", ["tag", "v1.0.0"], { cwd: dir });
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const outcome = assessReleaseCandidate(
      baseRequest({
        ciCommit: headCommit,
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
        declaredNotApplicable: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.assessment.readiness.integrity).toBe("blocked");
    expect(outcome.assessment.readiness.blockingFindings.some((f) => f.id === "RELEASE-READINESS-TAG-CONFLICT")).toBe(true);
  });

  it("full assessment reaches 'ready' when every fact is real, verified, and declared", () => {
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const outcome = assessReleaseCandidate(
      baseRequest({
        ciCommit: headCommit,
        ciRunIdentity: "run-1",
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
        releaseNotesDigest: "sha256:bbbb",
        declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Milestone status is null (no .aiqt/ project here) -- honest "unknown", so this stays a warning, not "ready".
    expect(outcome.assessment.readiness.integrity).toBe("ready_with_warnings");
    expect(outcome.assessment.readiness.warnings.some((w) => w.id === "RELEASE-READINESS-MILESTONE-STATUS-UNKNOWN")).toBe(true);
    expect(outcome.assessment.readiness.blockingFindings).toEqual([]);
    expect(outcome.assessment.provenance.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("fails closed when required identity is missing, before any Git call matters", () => {
    const outcome = assessReleaseCandidate(baseRequest({ repositoryIdentity: "" }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.blockingFindings.some((f) => f.id === "RELEASE-IDENTITY-MISSING-REPOSITORY")).toBe(true);
  });
});

describe("release-governance-service: assessReleaseDecision (WU40-02) folds risk/approval into the same evidence snapshot", () => {
  let dir: string;
  let headCommit: string;

  beforeEach(() => {
    dir = makeTempDir("aiqt-release-decision-");
    headCommit = initGitFixtureRepo(dir);
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
  });

  afterEach(() => {
    removeDir(dir);
  });

  const bestSignals: ReleaseRiskSignals = {
    regressionExposureLevel: "low",
    blastRadiusLevel: "low",
    testConfidenceLevel: "high",
    operationalComplexityLevel: "low",
    breakingChangesDeclared: false,
    migrationDeclared: false,
    rollbackDeclared: true,
    dogfoodMaturityLevel: "proven",
    knownLimitationsDeclared: true,
  };

  it("a low-risk decision reports agent approval permitted and a not_created draft state", () => {
    const outcome = assessReleaseDecision({
      cwd: dir,
      repositoryIdentity: "example/widget",
      packageVersion: "1.0.0",
      intendedReleaseTag: "v1.0.0",
      milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
      ciCommit: headCommit,
      ciStatus: "verified",
      validationEvidenceDigest: "sha256:aaaa",
      securityEvidenceStatus: "verified",
      declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      riskSignals: bestSignals,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.decision.risk?.status).toBe("green");
    expect(outcome.decision.approval?.authority).toBe("agent_approval_permitted");
    expect(outcome.decision.approval?.humanApprovedBy).toBeNull();
    expect(outcome.decision.draft.status).toBe("not_created");
    expect(outcome.decision.provenance.approvalAuthorityDecision).toBe("agent_approval_permitted");
  });

  it("omitting risk signals falls back to the maximally-conservative unknown defaults, never a fabricated low score", () => {
    const outcome = assessReleaseDecision({
      cwd: dir,
      repositoryIdentity: "example/widget",
      packageVersion: "1.0.0",
      intendedReleaseTag: "v1.0.0",
      milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.decision.risk).not.toBeNull();
    expect(outcome.decision.risk?.status).not.toBe("green");
    expect(outcome.decision.approval?.authority).not.toBe("agent_approval_permitted");
  });
});
