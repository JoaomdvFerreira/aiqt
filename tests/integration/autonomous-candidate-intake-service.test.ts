import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import {
  intakeCandidate,
  buildDryRunClassificationReport,
  type IntakeCandidateInput,
} from "../../src/services/autonomous-candidate-intake-service.js";

// M36-WU02: this file spawns real subprocesses (git, via
// runRepositoryPreflight's read-only allowlist calls); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

function baseInput(overrides: Partial<IntakeCandidateInput> = {}): IntakeCandidateInput {
  return {
    rawCandidate: {
      issueId: "ISSUE-1",
      source: "issue",
      repository: "example/repo",
      baseRef: "HEAD",
      objective: "Fix a null check",
      acceptanceCriteria: ["no longer throws"],
    },
    repositoryPath: "/placeholder",
    validationCommandsAvailable: true,
    prohibitedAreaTags: [],
    ...overrides,
  };
}

describe("intakeCandidate (M36-WU02, real disposable repository)", () => {
  let repoDir: string | null = null;

  beforeAll(() => {
    repoDir = makeTempDir("aiqt-intake-");
    initGitFixtureRepo(repoDir);
  });

  afterAll(() => {
    if (repoDir) removeDir(repoDir);
  });

  it("classifies a well-formed candidate against a clean repository as low_risk_autonomous", () => {
    const result = intakeCandidate(baseInput({ repositoryPath: repoDir! }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.safetyAssessment.riskClass).toBe("low_risk_autonomous");
      expect(result.preflight.repositoryDirty).toBe(false);
      expect(result.preflight.baseRefResolvable).toBe(true);
    }
  });

  it("fails closed to invalid_candidate_shape for a malformed rawCandidate, without ever calling preflight", () => {
    const result = intakeCandidate(baseInput({ rawCandidate: { issueId: "" }, repositoryPath: "/does/not/exist/at/all" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_candidate_shape");
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("fails closed to repository_dirty for a non-existent repository path (preflight reports isGitRepository: false)", () => {
    const result = intakeCandidate(baseInput({ repositoryPath: "/definitely/does/not/exist" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preflight.isGitRepository).toBe(false);
      expect(result.safetyAssessment.riskClass).toBe("repository_dirty");
    }
  });

  it("classifies against an unresolvable base ref as insufficient_context", () => {
    const result = intakeCandidate(
      baseInput({
        repositoryPath: repoDir!,
        rawCandidate: { ...(baseInput().rawCandidate as object), baseRef: "refs/heads/does-not-exist" },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.safetyAssessment.riskClass).toBe("insufficient_context");
  });

  it("this module has exactly one intake entry point, and it accepts a single candidate, not a batch (one issue per run, enforced structurally)", () => {
    expect(intakeCandidate.length).toBe(1);
  });
});

describe("buildDryRunClassificationReport (M36-WU02)", () => {
  it("reports canProceedWithoutApproval: true for a low-risk successful intake", () => {
    const report = buildDryRunClassificationReport({
      ok: true,
      candidate: { issueId: "ISSUE-1", source: "issue", repository: "r", baseRef: "HEAD", objective: "x", acceptanceCriteria: ["y"], constraints: [], requestedPermissions: [] },
      preflight: { isGitRepository: true, repositoryDirty: false, baseRefResolvable: true, resolvedBaseCommit: "abc" },
      safetyAssessment: { riskClass: "low_risk_autonomous", prohibitedAreas: [], requiredApprovals: [], commandPolicyProfile: "standard", networkPolicy: "denied", reason: "clean" },
    });
    expect(report.canProceedWithoutApproval).toBe(true);
    expect(report.requiresApproval).toBe(false);
    expect(report.alwaysBlocked).toBe(false);
    expect(report.issueId).toBe("ISSUE-1");
  });

  it("reports requiresApproval: true for a medium-risk successful intake", () => {
    const report = buildDryRunClassificationReport({
      ok: true,
      candidate: { issueId: "ISSUE-2", source: "issue", repository: "r", baseRef: "HEAD", objective: "x", acceptanceCriteria: ["y"], constraints: [], requestedPermissions: ["network"] },
      preflight: { isGitRepository: true, repositoryDirty: false, baseRefResolvable: true, resolvedBaseCommit: "abc" },
      safetyAssessment: { riskClass: "medium_risk_requires_approval", prohibitedAreas: [], requiredApprovals: ["human_operator"], commandPolicyProfile: "none", networkPolicy: "denied", reason: "elevated permission requested" },
    });
    expect(report.canProceedWithoutApproval).toBe(false);
    expect(report.requiresApproval).toBe(true);
    expect(report.alwaysBlocked).toBe(false);
  });

  it("reports alwaysBlocked: true for a high-risk-prohibited successful intake", () => {
    const report = buildDryRunClassificationReport({
      ok: true,
      candidate: { issueId: "ISSUE-3", source: "issue", repository: "r", baseRef: "HEAD", objective: "x", acceptanceCriteria: ["y"], constraints: [], requestedPermissions: [] },
      preflight: { isGitRepository: true, repositoryDirty: false, baseRefResolvable: true, resolvedBaseCommit: "abc" },
      safetyAssessment: { riskClass: "high_risk_prohibited", prohibitedAreas: ["secrets"], requiredApprovals: [], commandPolicyProfile: "none", networkPolicy: "denied", reason: "touches secrets" },
    });
    expect(report.canProceedWithoutApproval).toBe(false);
    expect(report.requiresApproval).toBe(false);
    expect(report.alwaysBlocked).toBe(true);
  });

  it("reports a null riskClass and a descriptive reason for a rejected (ok: false) intake", () => {
    const report = buildDryRunClassificationReport({ ok: false, reason: "invalid_candidate_shape", issues: ["issueId: too short"] });
    expect(report.riskClass).toBeNull();
    expect(report.canProceedWithoutApproval).toBeNull();
    expect(report.reason).toContain("issueId: too short");
  });
});
