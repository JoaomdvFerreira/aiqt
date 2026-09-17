import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheckpointAmend } from "../../src/cli/commands/checkpoint-amend.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildCheckpointAmendmentFixtureState } from "../m12-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): Array<{ type: string; data: Record<string, unknown> }> {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt checkpoint amend", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C001",
      acceptance: "passed",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 for an unknown checkpoint", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C999",
      acceptance: "passed",
      reason: "Doesn't exist.",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("CHECKPOINT-AMEND-UNKNOWN-CHECKPOINT");
  });

  it("fails with exit code 3 when neither --acceptance nor --validation is supplied", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const result = runCheckpointAmend(contextFor(dir), { checkpointId: "C003", reason: "y" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("CHECKPOINT-AMEND-MISSING-FIELD");
  });

  it("fails with exit code 3 for an empty reason", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C003",
      acceptance: "passed",
      reason: "   ",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("CHECKPOINT-AMEND-MISSING-REASON");
  });

  it("fails with exit code 3 for an invalid --acceptance value", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C003",
      acceptance: "not-a-real-value",
      reason: "y",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues[0].id).toBe("CHECKPOINT-AMEND-INVALID-ACCEPTANCE");
  });

  it("WU003-style: removes the active partial-checkpoint blocker on a done work unit, preserving audit data, without reopening the work unit", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);

    const before = runReviewCommand(contextFor(dir), {});
    const beforeFindings = (before.data as { findings: Array<{ findingKey: string }> }).findings;
    expect(
      beforeFindings.some((f) => f.findingKey === "checkpoint:WU003:acceptanceCriteriaResult:partial"),
    ).toBe(true);

    const runlogBefore = readRunlogLines(dir).length;
    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C003",
      acceptance: "passed",
      reason: "Role escalation edge case accepted as a documented limitation.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitStatusBefore: string; workUnitStatusAfter: string; changed: boolean };
    expect(data.changed).toBe(true);
    expect(data.workUnitStatusBefore).toBe("done");
    expect(data.workUnitStatusAfter).toBe("done");

    const state = readState(dir);
    expect(state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU003").status).toBe("done");
    expect(state.checkpointAmendments).toHaveLength(1);
    expect(state.checkpointAmendments[0]).toMatchObject({
      checkpointId: "C003",
      workUnitId: "WU003",
      acceptanceCriteriaResult: "passed",
    });
    // Original checkpoint is never rewritten.
    const originalCheckpoint = state.checkpoints.find((c: { id: string }) => c.id === "C003");
    expect(originalCheckpoint.acceptanceCriteriaResult).toBe("partial");

    const after = runReviewCommand(contextFor(dir), {});
    const afterFindings = (after.data as { findings: Array<{ findingKey: string }> }).findings;
    expect(
      afterFindings.some((f) => f.findingKey === "checkpoint:WU003:acceptanceCriteriaResult:partial"),
    ).toBe(false);

    const runlogLines = readRunlogLines(dir);
    // M29 §3.1: an amendment that changes the effective result also triggers
    // a post-success advisory re-evaluation (no active policy here, so it
    // records a "not_configured" observation) -- one extra event beyond the
    // pre-M29 checkpoint.amended event.
    expect(runlogLines).toHaveLength(runlogBefore + 2);
    expect(runlogLines[runlogLines.length - 1].type).toBe("evidence_gate.advisory_observation_recorded");
    expect(runlogLines[runlogLines.length - 2].type).toBe("checkpoint.amended");
  });

  it("needs_review checkpoint amendment to passed/passed transitions the work unit to done", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);

    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C002",
      acceptance: "passed",
      validation: "passed",
      reason: "Live Clerk verification accepted as complete.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitStatusBefore: string; workUnitStatusAfter: string };
    expect(data.workUnitStatusBefore).toBe("needs_review");
    expect(data.workUnitStatusAfter).toBe("done");

    const state = readState(dir);
    expect(state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU002").status).toBe("done");
  });

  it("does not transition to done when only --acceptance passes but validation stays non-passed", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);

    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C002",
      acceptance: "passed",
      reason: "Only acceptance improves; validation unresolved.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { workUnitStatusAfter: string };
    expect(data.workUnitStatusAfter).toBe("needs_review");
  });

  it("reconciles a completed recorded unfinished-work item without rewriting the checkpoint", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const initialState = readState(dir);
    const checkpoint = initialState.checkpoints.find((item: { id: string }) => item.id === "C002");
    checkpoint.notCompleted = ["C010 external review follow-up"];
    writeFileSync(statePath, JSON.stringify(initialState, null, 2));

    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C002",
      acceptance: "passed",
      validation: "passed",
      resolvedNotCompleted: "C010 external review follow-up",
      resolutionEvidenceReference: "review:C010",
      reason: "External review completed C010.",
    });

    expect(result.exitCode).toBe(ExitCode.Success);
    expect((result.data as { workUnitStatusAfter: string }).workUnitStatusAfter).toBe("done");
    const persisted = readState(dir);
    expect(persisted.checkpoints.find((item: { id: string }) => item.id === "C002").notCompleted).toEqual(["C010 external review follow-up"]);
    expect(persisted.checkpointAmendments.at(-1)).toMatchObject({
      resolvedNotCompleted: "C010 external review follow-up",
      resolutionEvidenceReference: "review:C010",
    });
    expect(readRunlogLines(dir).at(-2).data).toMatchObject({
      resolvedNotCompleted: "C010 external review follow-up",
      resolutionEvidenceReference: "review:C010",
    });
  });

  it("rejects an unknown unfinished-work reconciliation and idempotently ignores a duplicate", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = readState(dir);
    state.checkpoints.find((item: { id: string }) => item.id === "C002").notCompleted = ["review follow-up"];
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const unknown = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C002",
      resolvedNotCompleted: "not recorded",
      reason: "Should reject.",
    });
    expect(unknown.exitCode).toBe(ExitCode.InvalidInput);
    expect(unknown.blockingIssues[0].id).toBe("CHECKPOINT-AMEND-UNKNOWN-NOT-COMPLETED");

    const first = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C002",
      resolvedNotCompleted: "review follow-up",
      reason: "Resolved.",
    });
    expect((first.data as { changed: boolean }).changed).toBe(true);
    const eventCount = readRunlogLines(dir).length;
    const duplicate = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C002",
      resolvedNotCompleted: "review follow-up",
      reason: "Retry.",
    });
    expect((duplicate.data as { changed: boolean }).changed).toBe(false);
    expect(readRunlogLines(dir)).toHaveLength(eventCount);
  });

  it("is idempotent: re-applying the same effective value returns exit 0 with changed:false and appends no runlog event", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    runCheckpointAmend(contextFor(dir), {
      checkpointId: "C003",
      acceptance: "passed",
      reason: "First amendment.",
    });
    const runlogAfterFirst = readRunlogLines(dir).length;

    const second = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C003",
      acceptance: "passed",
      reason: "Second attempt, same value.",
    });
    expect(second.exitCode).toBe(ExitCode.Success);
    expect((second.data as { changed: boolean }).changed).toBe(false);
    expect(readRunlogLines(dir)).toHaveLength(runlogAfterFirst);
  });

  it("blocks with exit code 2 when the owning work unit's status is not done or needs_review", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = readState(dir);
    // WU001 is done with checkpoint C001; force it into a non-amendable
    // status to exercise the transition-table block (mirrors dogfood-fixture's
    // documented direct-patch pattern for reaching otherwise-unreachable states).
    const wu1 = state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU001");
    wu1.status = "ready";
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C001",
      acceptance: "passed",
      reason: "Should be blocked.",
    });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.blockingIssues[0].id).toBe("CHECKPOINT-AMEND-STATUS-NOT-AMENDABLE");
  });

  it("manage reflects the amended checkpoint after the amendment", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const before = runManage(contextFor(dir));
    const beforeBlockers = (before.data as { releaseBlockers: string[] }).releaseBlockers;
    expect(beforeBlockers.some((b) => b.includes("checkpoint:WU003:acceptanceCriteriaResult:partial"))).toBe(
      true,
    );

    runCheckpointAmend(contextFor(dir), {
      checkpointId: "C003",
      acceptance: "passed",
      reason: "Accepted.",
    });

    const after = runManage(contextFor(dir));
    const afterBlockers = (after.data as { releaseBlockers: string[] }).releaseBlockers;
    expect(afterBlockers.some((b) => b.includes("checkpoint:WU003:acceptanceCriteriaResult:partial"))).toBe(
      false,
    );
  });

  it("does not use exit code 10 for any error case", async () => {
    dir = makeTempDir();
    await buildCheckpointAmendmentFixtureState(dir);
    const missingReason = runCheckpointAmend(contextFor(dir), { checkpointId: "C003", acceptance: "passed" });
    const unknownCheckpoint = runCheckpointAmend(contextFor(dir), {
      checkpointId: "C999",
      acceptance: "passed",
      reason: "y",
    });
    expect(missingReason.exitCode).not.toBe(10);
    expect(unknownCheckpoint.exitCode).not.toBe(10);
  });
});
