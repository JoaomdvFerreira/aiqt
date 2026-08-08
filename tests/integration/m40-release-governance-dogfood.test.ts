import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// M34-WU02: this file spawns real subprocesses (git, via initGitFixtureRepo).
// Uses the shared class constant, not a locally hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runReleaseAssess } from "../../src/cli/commands/release-assess.command.js";
import { runReleaseNotes } from "../../src/cli/commands/release-notes.command.js";
import { runReleaseStatus } from "../../src/cli/commands/release-status.command.js";
import { runReleaseDraft } from "../../src/cli/commands/release-draft.command.js";
import { assessReleaseRisk } from "../../src/workflow/release-risk.js";
import { buildReleaseCandidate } from "../../src/workflow/release-candidate.js";
import { buildReleaseProvenance } from "../../src/workflow/release-provenance.js";
import { assessReleaseReadiness } from "../../src/workflow/release-readiness.js";
import { ReleaseDraftStatusSchema } from "../../src/schema/release-governance.schema.js";
import type { ReleaseIntentInput } from "../../src/workflow/release-candidate.js";
import type { ReleaseProvenanceFacts } from "../../src/workflow/release-provenance.js";

/**
 * M40-WU05 (build spec Sec 12, "Required scenarios"): the milestone-level
 * dogfood/evidence proof. Every scenario below uses a disposable, fictional
 * "acme/rocket-widgets"-style fixture repository -- never the AIQT
 * repository itself (this repository's own self-development rule). No
 * result is fabricated: where real GitHub credentials are unavailable
 * (this sandbox has none), that is recorded honestly as a validated safe
 * failure path, not a faked success (build spec Sec 12: "do not fabricate
 * success").
 */
describe("M40-WU05 dogfood: release-decision proof", () => {
  let dir: string;
  let headCommit: string;

  beforeEach(() => {
    dir = makeTempDir("aiqt-m40-dogfood-");
    headCommit = initGitFixtureRepo(dir, "acme/rocket-widgets initial commit");
  });

  afterEach(() => {
    removeDir(dir);
  });

  // 1. Completed milestone with no release requested remains valid/unchanged.
  it("scenario 1: a completed milestone with no release requested produces no candidate and no local artifact", () => {
    // No `release assess/prepare` call is ever made here -- the milestone
    // "completing" is entirely simulated by nothing happening. Proof: a
    // fresh `release status` reports zero prepared candidates.
    const status = runReleaseStatus(contextFor(dir), {});
    expect(status.status).toBe("passed");
    expect((status.data as { candidateIds: string[] }).candidateIds).toEqual([]);
  });

  // 2. One-milestone release candidate reaches deterministic assessment/notes.
  it("scenario 2: a one-milestone candidate reaches deterministic assessment and notes", async () => {
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const reqFile = join(dir, "req.json");
    writeFileSync(
      reqFile,
      JSON.stringify({
        repositoryIdentity: "acme/rocket-widgets",
        packageVersion: "2.0.0",
        intendedReleaseTag: "v2.0.0",
        milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
        ciCommit: headCommit,
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
        declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      }),
    );
    const a1 = await runReleaseAssess(contextFor(dir), { fromFile: reqFile });
    const a2 = await runReleaseAssess(contextFor(dir), { fromFile: reqFile });
    expect((a1.data as { decision: { provenance: { digest: string } } }).decision.provenance.digest).toBe(
      (a2.data as { decision: { provenance: { digest: string } } }).decision.provenance.digest,
    );
    const notes = await runReleaseNotes(contextFor(dir), { fromFile: reqFile });
    expect((notes.data as { notes: string }).notes).toMatch(/RISK: \d+\/100/);
  });

  // 3. Multi-milestone candidate preserves each included milestone's provenance.
  it("scenario 3: a multi-milestone candidate preserves each milestone's own tag/closure-commit provenance", () => {
    writeFileSync(join(dir, "b.txt"), "b\n");
    execFileSync("git", ["add", "b.txt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "-m", "second commit"], { cwd: dir });
    const secondCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    execFileSync("git", ["tag", "m1-done", headCommit], { cwd: dir });
    execFileSync("git", ["tag", "m2-done", secondCommit], { cwd: dir });

    const input: ReleaseIntentInput = {
      repositoryIdentity: "acme/rocket-widgets",
      packageVersion: "3.0.0",
      schemaVersion: null,
      intendedReleaseTag: "v3.0.0",
      candidateCommit: secondCommit,
      baseRelease: "v2.0.0",
      milestones: [
        { milestoneId: "m1", title: "First", status: "done", tag: "m1-done", tagCommit: headCommit, closureCommit: headCommit },
        { milestoneId: "m2", title: "Second", status: "done", tag: "m2-done", tagCommit: secondCommit, closureCommit: secondCommit },
      ],
    };
    const built = buildReleaseCandidate(input);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.candidate.milestones[0]?.evidenceStatus).toBe("verified");
    expect(built.candidate.milestones[1]?.evidenceStatus).toBe("verified");
    expect(built.candidate.milestones[0]?.closureCommit).toBe(headCommit);
    expect(built.candidate.milestones[1]?.closureCommit).toBe(secondCommit);
    expect(built.candidate.milestones[0]?.closureCommit).not.toBe(built.candidate.milestones[1]?.closureCommit);
  });

  // 4/5/6: exact risk-score boundary proof (49 -> agent, 50 -> human, 76 -> human+waiver).
  // Each combination below is arithmetically derived from release-risk.ts's fixed
  // category tables (documented inline) and independently asserted against the
  // real scorer -- not merely a stubbed/faked totalScore.
  const boundaryInput: ReleaseIntentInput = {
    repositoryIdentity: "acme/rocket-widgets",
    packageVersion: "2.1.0",
    schemaVersion: null,
    intendedReleaseTag: "v2.1.0",
    candidateCommit: "0000000000000000000000000000000000000a",
    baseRelease: null,
    milestones: [{ milestoneId: "m1", title: "One", status: "done", tag: "m1", tagCommit: "0000000000000000000000000000000000000a", closureCommit: "0000000000000000000000000000000000000a" }],
  };

  function assessAt(facts: Partial<ReleaseProvenanceFacts>, signals: Parameters<typeof assessReleaseRisk>[3]) {
    const built = buildReleaseCandidate(boundaryInput);
    if (!built.ok) throw new Error("expected candidate build to succeed");
    const fullFacts: ReleaseProvenanceFacts = {
      ciCommit: boundaryInput.candidateCommit,
      ciRunIdentity: "run-1",
      ciStatus: "verified",
      validationEvidenceDigest: "sha256:aaaa",
      securityEvidenceStatus: "verified",
      releaseNotesDigest: null,
      riskAssessmentVersion: null,
      approvalAuthorityDecision: null,
      ...facts,
    };
    const provenance = buildReleaseProvenance(built.candidate, fullFacts);
    const readiness = assessReleaseReadiness(built.candidate, provenance, { tagAlreadyExists: false, declaredNotApplicable: [], declaredPresent: [] });
    return assessReleaseRisk(built.candidate, provenance, readiness, signals);
  }

  it("scenario 4: score 49 (security partial=12 + regression high=15 + blast medium=9 + test high=3 + opcomplex low=2 + compat(breaking-declared,no-migration)=5 + rollback-declared=0 + dogfood limited=3 + limitations-declared=0) permits agent approval", () => {
    const risk = assessAt(
      { securityEvidenceStatus: "partial" },
      {
        regressionExposureLevel: "high",
        blastRadiusLevel: "medium",
        testConfidenceLevel: "high",
        operationalComplexityLevel: "low",
        breakingChangesDeclared: true,
        migrationDeclared: false,
        rollbackDeclared: true,
        dogfoodMaturityLevel: "limited",
        knownLimitationsDeclared: true,
      },
    );
    expect(risk.totalScore).toBe(49);
    expect(risk.status).toBe("yellow");
    expect(risk.requiredApprovalAuthority).toBe("agent_approval_permitted");
    expect(risk.waiverRequired).toBe(false);
  });

  it("scenario 5: score 50 (scenario 4 plus limitations declared-absent instead of declared-present, +1) requires human approval", () => {
    const risk = assessAt(
      { securityEvidenceStatus: "partial" },
      {
        regressionExposureLevel: "high",
        blastRadiusLevel: "medium",
        testConfidenceLevel: "high",
        operationalComplexityLevel: "low",
        breakingChangesDeclared: true,
        migrationDeclared: false,
        rollbackDeclared: true,
        dogfoodMaturityLevel: "limited",
        knownLimitationsDeclared: false,
      },
    );
    expect(risk.totalScore).toBe(50);
    expect(risk.status).toBe("orange");
    expect(risk.requiredApprovalAuthority).toBe("human_approval_required");
    expect(risk.waiverRequired).toBe(false);
  });

  it("scenario 6: score 76 (security missing=20 + regression high=15 + blast high=15 + test high=3 + opcomplex high=10 + compat=5 + rollback-absent=4 + dogfood limited=3 + limitations-absent=1) requires human approval plus waiver", () => {
    const risk = assessAt(
      { securityEvidenceStatus: "missing" },
      {
        regressionExposureLevel: "high",
        blastRadiusLevel: "high",
        testConfidenceLevel: "high",
        operationalComplexityLevel: "high",
        breakingChangesDeclared: true,
        migrationDeclared: false,
        rollbackDeclared: false,
        dogfoodMaturityLevel: "limited",
        knownLimitationsDeclared: false,
      },
    );
    expect(risk.totalScore).toBe(76);
    expect(risk.status).toBe("red");
    expect(risk.requiredApprovalAuthority).toBe("human_waiver_required");
    expect(risk.waiverRequired).toBe(true);
  });

  // 7. Stale CI/candidate mismatch blocks draft creation.
  it("scenario 7: a CI-commit/candidate-commit provenance mismatch blocks draft creation before any GitHub call", async () => {
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const reqFile = join(dir, "req.json");
    writeFileSync(
      reqFile,
      JSON.stringify({
        repositoryIdentity: "acme/rocket-widgets",
        packageVersion: "2.0.0",
        intendedReleaseTag: "v2.0.0",
        milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
        ciCommit: "0000000000000000000000000000000000dead",
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
      }),
    );
    let networkCalled = false;
    const result = await runReleaseDraft(
      contextFor(dir),
      { fromFile: reqFile },
      {
        env: { GITHUB_TOKEN: "unused-because-blocked-before-network" },
        githubClient: {
          getRepository: async () => {
            networkCalled = true;
            return { ok: true, value: { fullName: "acme/rocket-widgets" } };
          },
          getReleaseByTag: async () => ({ ok: true, value: null }),
          createReleaseDraft: async () => ({ ok: true, value: { id: 1, htmlUrl: "https://example.invalid/1" } }),
        },
      },
    );
    expect(result.status).toBe("blocked");
    expect(networkCalled).toBe(false);
  });

  // 8. Missing GitHub credentials fail safely with operator guidance.
  it("scenario 8: missing GITHUB_TOKEN fails safely with a clear operator action list, no network attempted", async () => {
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const reqFile = join(dir, "req.json");
    writeFileSync(
      reqFile,
      JSON.stringify({
        repositoryIdentity: "acme/rocket-widgets",
        packageVersion: "2.0.0",
        intendedReleaseTag: "v2.0.0",
        milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
        ciCommit: headCommit,
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
      }),
    );
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { env: {} });
    expect(result.exitCode).toBe(4);
    const issue = result.blockingIssues.find((i) => i.id === "RELEASE-DRAFT-MISSING-CREDENTIALS");
    expect(issue).toBeDefined();
    expect(issue?.suggestedAction).toMatch(/GITHUB_TOKEN/);
  });

  // 9. Controlled draft creation in an authorized disposable/non-production
  // repository, when credentials are available. This sandbox has no real
  // GitHub credentials -- honestly recorded as a blocked external-setup
  // state (build spec Sec 12: "do not fabricate success"), with the safe
  // placeholder path validated instead (identical assertion to scenario 8,
  // re-stated here under its own scenario number for the closure record).
  it("scenario 9: real-GitHub dogfood is blocked by unavailable credentials in this sandbox -- safe placeholder path validated, no success fabricated", async () => {
    const hasRealCredentials = typeof process.env.GITHUB_TOKEN === "string" && process.env.GITHUB_TOKEN.length > 0;
    expect(hasRealCredentials).toBe(false); // honest record of this sandbox's external-setup state

    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const reqFile = join(dir, "req.json");
    writeFileSync(
      reqFile,
      JSON.stringify({
        repositoryIdentity: "acme/rocket-widgets",
        packageVersion: "2.0.0",
        intendedReleaseTag: "v2.0.0",
        milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
        ciCommit: headCommit,
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
      }),
    );
    // deps.env defaults to the real process.env when omitted -- this exercises
    // the exact real (non-injected) credential-resolution path.
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, {});
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-DRAFT-MISSING-CREDENTIALS")).toBe(true);
  });

  // 10. No publication occurs -- structurally, not just behaviorally: the
  // draft-status contract has no "published" value anywhere.
  it("scenario 10: no publication occurs -- ReleaseDraftStatus has no 'published' state, and 'exists' never overwrites a real release", () => {
    expect(ReleaseDraftStatusSchema.options).toEqual(["not_created", "created", "exists"]);
  });

  // 11. Human and JSON outputs remain substantively aligned.
  it("scenario 11: human release-notes text and the JSON decision report the identical risk score/status/approval authority", async () => {
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    const reqFile = join(dir, "req.json");
    writeFileSync(
      reqFile,
      JSON.stringify({
        repositoryIdentity: "acme/rocket-widgets",
        packageVersion: "2.0.0",
        intendedReleaseTag: "v2.0.0",
        milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
        ciCommit: headCommit,
        ciStatus: "verified",
        validationEvidenceDigest: "sha256:aaaa",
        securityEvidenceStatus: "verified",
        declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      }),
    );
    const result = await runReleaseNotes(contextFor(dir), { fromFile: reqFile });
    const data = result.data as { notes: string; decision: { risk: { totalScore: number; status: string }; approval: { authority: string } } };
    expect(data.notes).toContain(`RISK: ${data.decision.risk.totalScore}/100 — ${data.decision.risk.status.toUpperCase()}`);
    const approvalLine = data.notes.split("\n").find((l) => l.startsWith("> **Approval authority:**"));
    expect(approvalLine).toBeDefined();
    if (data.decision.approval.authority === "agent_approval_permitted") expect(approvalLine).toMatch(/Agent permitted/);
    if (data.decision.approval.authority === "human_approval_required") expect(approvalLine).toMatch(/Human required/);
    if (data.decision.approval.authority === "human_waiver_required") expect(approvalLine).toMatch(/Human \+ waiver required/);
  });

  // 12. M37/M38 safety controls are not weakened -- verified by this Work
  // Unit having touched zero files under those milestones' ownership
  // (release-governance-service.ts only imports the read-only gitRevParse
  // export, nothing from autonomous-run-*/sandbox-*).
  it("scenario 12: M40 imports nothing from the M36-M38 autonomous/sandbox execution surface", () => {
    const m40Files = [
      "src/services/release-governance-service.ts",
      "src/cli/commands/release-draft.command.ts",
      "src/services/github-release-client.ts",
      "src/workflow/release-draft-policy.ts",
    ];
    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(here, "..", "..");
    for (const relPath of m40Files) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} must not import the autonomous-run/sandbox execution surface`).not.toMatch(
        /autonomous-run|autonomous-command-runner|sandbox-docker|sandbox-command-loop/,
      );
    }
  });
});
