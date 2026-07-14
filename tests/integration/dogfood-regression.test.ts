import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { runReviewAcknowledge } from "../../src/cli/commands/review-acknowledge.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDogfoodTerminalState, DOGFOOD_ACKNOWLEDGE_KEY } from "../dogfood-fixture.js";

/** Inject a checkpoint issue into the dogfood fixture's WU001 checkpoint, mirroring a real historical checkpoint record. */
function injectCheckpointIssue(dir: string, issue: { title: string; severity: string; agentCanFix: boolean }) {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const wu001Checkpoint = state.checkpoints.find((c: { workUnitId: string }) => c.workUnitId === "WU001");
  wu001Checkpoint.issues.push({ ...issue, description: null, status: "open" });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * M9 §13.3 regression: the completed Natural Medicine Marketplace dogfood
 * terminal state -- projectStatus=review, all work units done, 0
 * ready/planned/in_progress/needs_review, and a historical WU003 checkpoint
 * with acceptanceCriteriaResult=partial that keeps aiqt review failed
 * forever pre-M9.
 */
describe("M9 dogfood regression: completed Natural Medicine Marketplace terminal state", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("matches the documented terminal state shape", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    expect(state.projectStatus).toBe("review");
    const counts = { ready: 0, planned: 0, in_progress: 0, needs_review: 0, done: 0 };
    for (const wu of state.workGraph.workUnits) {
      counts[wu.status as keyof typeof counts] = (counts[wu.status as keyof typeof counts] ?? 0) + 1;
    }
    expect(counts.done).toBe(3);
    expect(counts.ready).toBe(0);
    expect(counts.planned).toBe(0);
    expect(counts.in_progress).toBe(0);
    expect(counts.needs_review).toBe(0);
    const wu003Checkpoints = state.checkpoints.filter((c: { workUnitId: string }) => c.workUnitId === "WU003");
    expect(wu003Checkpoints[wu003Checkpoints.length - 1].acceptanceCriteriaResult).toBe("partial");
  });

  it("review fails before acknowledgment", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const result = runReviewCommand(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    expect(result.status).toBe("failed");
  });

  it("acknowledging the deterministic dogfood finding key succeeds", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    const result = runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Live Clerk verification requires user-owned setup and is accepted as a development-complete limitation.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("development review passes after acknowledgment", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted development-complete limitation.",
    });
    const result = runReviewCommand(contextFor(dir), { mode: "development" });
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("release review still reports release concerns after acknowledgment", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted development-complete limitation.",
    });
    const result = runReviewCommand(contextFor(dir), { mode: "release" });
    expect(result.exitCode).toBe(ExitCode.ValidationFailed);
    const data = result.data as { productionReady: boolean };
    expect(data.productionReady).toBe(false);
  });

  it("aiqt manage reports developmentComplete=true and productionReady=false", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted development-complete limitation.",
    });
    const result = runManage(contextFor(dir));
    const data = result.data as { developmentComplete: boolean; productionReady: boolean };
    expect(data.developmentComplete).toBe(true);
    expect(data.productionReady).toBe(false);
  });

  it("final-review.md includes the acknowledged finding and release-readiness blockers", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Live Clerk verification requires user-owned setup and is accepted as a development-complete limitation.",
    });
    const exportResult = runExport(contextFor(dir), { target: "all" });
    expect(exportResult.exitCode).toBe(ExitCode.Success);
    const content = readFileSync(join(dir, ".aiqt", "exports", "final-review.md"), "utf8");
    expect(content).toContain(DOGFOOD_ACKNOWLEDGE_KEY);
    expect(content).toContain("Development complete: yes");
    expect(content).toContain("Production ready: no");
    expect(content).toContain("## Release Blockers");
  });
});

/**
 * M10 §14.3 regression: the classification hardening described in the M10
 * spec, layered on top of the same dogfood terminal state.
 */
describe("M10 regression: final-review classification hardening on the dogfood terminal state", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("Release Blockers includes a live smoke-test/deployment/branch-protection/legal checkpoint issue when present", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    injectCheckpointIssue(dir, {
      title: "Branch protection must be enabled and a live smoke test run before deployment",
      severity: "high",
      agentCanFix: false,
    });
    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted development-complete limitation.",
    });

    const result = runManage(contextFor(dir));
    const data = result.data as { releaseBlockers: string[] };
    expect(data.releaseBlockers.some((s) => s.includes("Branch protection"))).toBe(true);
  });

  it("External Verification Gaps includes checkpoint issues, not only review findings", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    injectCheckpointIssue(dir, {
      title: "Verify Resend email delivery in production",
      severity: "medium",
      agentCanFix: false,
    });

    const result = runManage(contextFor(dir));
    const data = result.data as { externalVerificationGaps: string[] };
    // The dogfood WU003 finding-based gap remains present...
    expect(data.externalVerificationGaps.some((s) => s.includes(DOGFOOD_ACKNOWLEDGE_KEY))).toBe(true);
    // ...alongside the newly injected checkpoint-issue-based gap.
    expect(data.externalVerificationGaps.some((s) => s.includes("Resend"))).toBe(true);
  });

  it("user-action-required excludes non-user scope notes even in the completed terminal state", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);
    injectCheckpointIssue(dir, {
      title: "Scope note: secondary locales deferred to a later milestone",
      severity: "low",
      agentCanFix: false,
    });

    const result = runManage(contextFor(dir));
    const data = result.data as { userActionRequired: string[] };
    expect(data.userActionRequired.some((s) => s.includes("Scope note"))).toBe(false);
  });

  it("nextRecommendedCommand stays a single command string (no compound commands) across the terminal/release states", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);

    const beforeAck = runManage(contextFor(dir));
    expect(beforeAck.nextRecommendedCommand).not.toBeNull();
    expect(beforeAck.nextRecommendedCommand).not.toMatch(/&&|;/);
    expect(beforeAck.nextRecommendedCommand!.split(" aiqt ").length).toBe(1);

    runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Accepted development-complete limitation.",
    });
    const afterAck = runManage(contextFor(dir));
    expect(afterAck.nextRecommendedCommand).not.toMatch(/&&|;/);
    expect(afterAck.nextRecommendedCommand!.split(" aiqt ").length).toBe(1);

    const release = runReviewCommand(contextFor(dir), { mode: "release" });
    expect(release.nextRecommendedCommand).not.toMatch(/&&|;/);
  });
});
