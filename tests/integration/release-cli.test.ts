import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// M34-WU02: this file spawns real subprocesses (git, via initGitFixtureRepo).
// Uses the shared class constant, not a locally hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runReleaseAssess } from "../../src/cli/commands/release-assess.command.js";
import { runReleaseValidate } from "../../src/cli/commands/release-validate.command.js";
import { runReleaseNotes } from "../../src/cli/commands/release-notes.command.js";
import { runReleasePrepare } from "../../src/cli/commands/release-prepare.command.js";
import { runReleaseStatus } from "../../src/cli/commands/release-status.command.js";

/**
 * M40-WU03: CLI-layer coverage against a real Git fixture repository (no
 * .aiqt/ project needed -- these commands never touch canonical AIQT
 * state). Exercises the actual exported command functions directly rather
 * than spawning a subprocess, matching this repository's existing CLI unit
 * test convention.
 */
describe("aiqt release CLI family", () => {
  let dir: string;
  let headCommit: string;
  let reqFile: string;

  beforeEach(() => {
    dir = makeTempDir("aiqt-release-cli-");
    headCommit = initGitFixtureRepo(dir);
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    reqFile = join(dir, "release-request.json");
    const body = {
      repositoryIdentity: "example/widget",
      packageVersion: "1.0.0",
      intendedReleaseTag: "v1.0.0",
      milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
      ciCommit: headCommit,
      ciStatus: "verified",
      validationEvidenceDigest: "sha256:aaaa",
      securityEvidenceStatus: "verified",
      declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      riskSignals: {
        regressionExposureLevel: "low",
        blastRadiusLevel: "low",
        testConfidenceLevel: "high",
        operationalComplexityLevel: "low",
        breakingChangesDeclared: false,
        migrationDeclared: false,
        rollbackDeclared: true,
        dogfoodMaturityLevel: "proven",
        knownLimitationsDeclared: true,
      },
    };
    writeFileSync(reqFile, JSON.stringify(body));
  });

  afterEach(() => {
    removeDir(dir);
  });

  it("release assess: reports risk/approval and passes/warns per readiness", async () => {
    const result = await runReleaseAssess(contextFor(dir), { fromFile: reqFile });
    expect(["passed", "warning"]).toContain(result.status);
    const data = result.data as { decision: { risk: { status: string }; approval: { authority: string } } };
    expect(data.decision.risk.status).toBe("green");
    expect(data.decision.approval.authority).toBe("agent_approval_permitted");
  });

  it("release assess: fails closed (exit 3) with no --from-file/--stdin", async () => {
    const result = await runReleaseAssess(contextFor(dir), {});
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-MISSING-INPUT")).toBe(true);
  });

  it("release assess: rejects conflicting --from-file and --stdin", async () => {
    const result = await runReleaseAssess(contextFor(dir), { fromFile: reqFile, stdin: true });
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-CONFLICTING-INPUT")).toBe(true);
  });

  it("release assess: rejects a nonexistent input file", async () => {
    const result = await runReleaseAssess(contextFor(dir), { fromFile: join(dir, "does-not-exist.json") });
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-FILE-NOT-FOUND")).toBe(true);
  });

  it("release assess: rejects input that fails schema validation", async () => {
    const badFile = join(dir, "bad.json");
    writeFileSync(badFile, JSON.stringify({ repositoryIdentity: "x" }));
    const result = await runReleaseAssess(contextFor(dir), { fromFile: badFile });
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-INPUT-SCHEMA-INVALID")).toBe(true);
  });

  it("release validate: narrower than assess -- no risk field in data", async () => {
    const result = await runReleaseValidate(contextFor(dir), { fromFile: reqFile });
    const data = result.data as Record<string, unknown>;
    expect(data.risk).toBeUndefined();
    expect(data.readiness).toBeDefined();
  });

  it("release notes: JSON and human renderings carry the same underlying decision, risk shown near the top", async () => {
    const result = await runReleaseNotes(contextFor(dir), { fromFile: reqFile });
    const data = result.data as { notes: string; decision: { risk: { totalScore: number; status: string } } };
    expect(data.notes.split("\n").slice(0, 5).join("\n")).toMatch(/RISK: \d+\/100/);
    expect(data.notes).toContain(`RISK: ${data.decision.risk.totalScore}/100 — ${data.decision.risk.status.toUpperCase()}`);
  });

  it("release notes: deterministic for the same evidence snapshot", async () => {
    const r1 = await runReleaseNotes(contextFor(dir), { fromFile: reqFile });
    const r2 = await runReleaseNotes(contextFor(dir), { fromFile: reqFile });
    const d1 = (r1.data as { notes: string }).notes;
    const d2 = (r2.data as { notes: string }).notes;
    expect(d1).toBe(d2);
  });

  it("release prepare: writes local decision JSON and notes markdown, never touches GitHub", async () => {
    const result = await runReleasePrepare(contextFor(dir), { fromFile: reqFile });
    const data = result.data as { evidenceDir: string; decisionPath: string; notesPath: string };
    expect(existsSync(data.decisionPath)).toBe(true);
    expect(existsSync(data.notesPath)).toBe(true);
    const saved = JSON.parse(readFileSync(data.decisionPath, "utf8")) as { draft: { status: string } };
    expect(saved.draft.status).toBe("not_created");
  });

  it("release status: lists prepared candidates, then reports one by id, without mutation", async () => {
    const prepared = await runReleasePrepare(contextFor(dir), { fromFile: reqFile });
    const candidateId = (prepared.data as { decision: { candidate: { candidateId: string } } }).decision.candidate.candidateId;

    const list = runReleaseStatus(contextFor(dir), {});
    expect((list.data as { candidateIds: string[] }).candidateIds.length).toBe(1);

    const one = runReleaseStatus(contextFor(dir), { candidate: candidateId });
    expect(one.status).not.toBe("failed");
    const oneData = one.data as { decision: { candidate: { candidateId: string } } };
    expect(oneData.decision.candidate.candidateId).toBe(candidateId);
  });

  it("release status: reports a clear not-found error for an unprepared candidate", () => {
    const result = runReleaseStatus(contextFor(dir), { candidate: "nonexistent@000000000000" });
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-STATUS-CANDIDATE-NOT-FOUND")).toBe(true);
  });
});
