import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { assembleReleaseCandidate, assessReleaseCandidate, type ReleaseIntentRequest } from "../../src/services/release-governance-service.js";

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
