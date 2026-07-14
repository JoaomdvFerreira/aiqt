import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { runReviewAcknowledge } from "../../src/cli/commands/review-acknowledge.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDogfoodTerminalState, DOGFOOD_ACKNOWLEDGE_KEY } from "../dogfood-fixture.js";

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
    const exportResult = runExport(contextFor(dir), { target: "final-review" });
    expect(exportResult.exitCode).toBe(ExitCode.Success);
    const content = readFileSync(join(dir, ".aiqt", "exports", "final-review.md"), "utf8");
    expect(content).toContain(DOGFOOD_ACKNOWLEDGE_KEY);
    expect(content).toContain("Development complete: yes");
    expect(content).toContain("Production ready: no");
    expect(content).toContain("## Release Blockers");
  });
});
