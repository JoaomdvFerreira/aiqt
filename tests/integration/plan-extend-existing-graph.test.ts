import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runGraphValidate } from "../../src/cli/commands/graph-validate.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import {
  buildExistingGraphRefinementFixture,
  REFINABLE_WORK_UNIT_REFINEMENT,
} from "../existing-graph-refinement-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

describe("M17-RC1 §13.1/§9: existing-graph refinement regression fixture", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("matches the fixture's completion state: 12 milestones, 21 work units, upstream work done, target work unit ready", async () => {
    dir = makeTempDir();
    await buildExistingGraphRefinementFixture(dir);
    const state = readState(dir);
    expect(state.workGraph.milestones).toHaveLength(12);
    expect(state.workGraph.workUnits).toHaveLength(21);

    const doneUnits = state.workGraph.workUnits.filter((wu: { status: string }) => wu.status === "done");
    expect(doneUnits).toHaveLength(14);

    const target = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Refinable future work unit",
    );
    expect(target.status).toBe("ready");
    const downstream = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Further future work unit 1",
    );
    expect(downstream.status).toBe("planned");
  });

  it("preview reports the refinement without mutation", async () => {
    dir = makeTempDir();
    await buildExistingGraphRefinementFixture(dir);
    const extPath = join(dir, "refinement.json");
    writeFileSync(extPath, JSON.stringify(REFINABLE_WORK_UNIT_REFINEMENT));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const targetId = JSON.parse(before).workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Refinable future work unit",
    ).id;

    const preview = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: targetId,
      fromFile: extPath,
      preview: true,
    });
    expect(preview.exitCode).toBe(ExitCode.Success);
    const data = preview.data as {
      preview: boolean;
      mutationPerformed: boolean;
      targetFinalStatus: string;
      completedWorkUnitsModified: number;
      completedMilestonesModified: number;
      cyclesIntroduced: number;
    };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);
    expect(data.targetFinalStatus).toBe("replanned");
    expect(data.completedWorkUnitsModified).toBe(0);
    expect(data.completedMilestonesModified).toBe(0);
    expect(data.cyclesIntroduced).toBe(0);

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("applying the refinement replans the target and details the next cut without disturbing completed work or later future work", async () => {
    dir = makeTempDir();
    await buildExistingGraphRefinementFixture(dir);
    const extPath = join(dir, "refinement.json");
    writeFileSync(extPath, JSON.stringify(REFINABLE_WORK_UNIT_REFINEMENT));
    const before = readState(dir);
    const targetId = before.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Refinable future work unit",
    ).id;
    const lastDoneWorkUnitId = before.lastAgentPacket?.workUnitId;

    const result = runPlan(contextFor(dir), {
      extend: true,
      refineWorkUnit: targetId,
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);

    // All previously-done work units remain unchanged/done.
    const doneUnits = state.workGraph.workUnits.filter((wu: { status: string }) => wu.status === "done");
    expect(doneUnits).toHaveLength(14);

    // Target replanned, preserved, never selectable again.
    const target = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === targetId);
    expect(target.status).toBe("replanned");
    expect(target.replanReason).toBe(REFINABLE_WORK_UNIT_REFINEMENT.extension.reason);

    // First detailed replacement entry is ready; the rest are planned/blocked.
    const entry = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Replacement step 1");
    expect(entry.status).toBe("ready");
    const middle = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Replacement step 2");
    expect(middle.status).toBe("planned");
    const exit = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Replacement step 3");
    expect(exit.status).toBe("planned");

    // The next downstream future work unit does not become ready prematurely.
    const downstream = state.workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Further future work unit 1",
    );
    expect(downstream.status).toBe("planned");

    // currentWorkUnitId stays null -- no packet is auto-generated for the
    // refinement. lastAgentPacket still mirrors the last real aiqt next call,
    // not any new/refined work unit.
    expect(state.currentWorkUnitId).toBeNull();
    expect(state.lastAgentPacket?.workUnitId).toBe(lastDoneWorkUnitId);
  });

  it("full review/graph validation passes after the refinement, with only intentional roadmap warnings", async () => {
    dir = makeTempDir();
    await buildExistingGraphRefinementFixture(dir);
    const extPath = join(dir, "refinement.json");
    writeFileSync(extPath, JSON.stringify(REFINABLE_WORK_UNIT_REFINEMENT));
    const targetId = readState(dir).workGraph.workUnits.find(
      (wu: { title: string }) => wu.title === "Refinable future work unit",
    ).id;
    expect(
      runPlan(contextFor(dir), { extend: true, refineWorkUnit: targetId, fromFile: extPath }).exitCode,
    ).toBe(ExitCode.Success);

    const graphResult = runGraphValidate(contextFor(dir, true));
    expect(graphResult.exitCode).toBe(ExitCode.Success);
    const graphData = graphResult.data as { blockingErrors: unknown[] };
    expect(graphData.blockingErrors).toHaveLength(0);

    const reviewResult = runReviewCommand(contextFor(dir, true), {});
    expect(reviewResult.exitCode).not.toBe(ExitCode.InvalidInput);
  });
});
