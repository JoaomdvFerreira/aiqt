import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runGraphValidate } from "../../src/cli/commands/graph-validate.command.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildFinancasCorte0Fixture, FINANCAS_CORTE1_EXTENSION } from "../financas-fixture.js";

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

describe("M17 §19.4/Appendix B: financas-pessoais dogfood regression fixture", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("matches the observed Corte 0 completion state: 12 milestones, 21 work units, WU001-WU014 done, WU015 ready", async () => {
    dir = makeTempDir();
    await buildFinancasCorte0Fixture(dir);
    const state = readState(dir);
    expect(state.workGraph.milestones).toHaveLength(12);
    expect(state.workGraph.workUnits).toHaveLength(21);

    for (let i = 1; i <= 14; i++) {
      const id = `WU${String(i).padStart(3, "0")}`;
      expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === id).status).toBe("done");
    }
    expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU015").status).toBe("ready");
    expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU016").status).toBe("planned");
  });

  it("A45: preview reports the extension without mutation", async () => {
    dir = makeTempDir();
    await buildFinancasCorte0Fixture(dir);
    const extPath = join(dir, "corte-1-plan.json");
    writeFileSync(extPath, JSON.stringify(FINANCAS_CORTE1_EXTENSION));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");

    const preview = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU015",
      fromFile: extPath,
      preview: true,
    });
    expect(preview.exitCode).toBe(ExitCode.Success);
    const data = preview.data as {
      preview: boolean;
      mutationPerformed: boolean;
      placeholderFinalStatus: string;
      completedWorkUnitsModified: number;
      completedMilestonesModified: number;
      cyclesIntroduced: number;
    };
    expect(data.preview).toBe(true);
    expect(data.mutationPerformed).toBe(false);
    expect(data.placeholderFinalStatus).toBe("replanned");
    expect(data.completedWorkUnitsModified).toBe(0);
    expect(data.completedMilestonesModified).toBe(0);
    expect(data.cyclesIntroduced).toBe(0);

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
  });

  it("A45: applying the extension replans WU015 and details Corte 1 without disturbing Corte 0 or later placeholders", async () => {
    dir = makeTempDir();
    await buildFinancasCorte0Fixture(dir);
    const extPath = join(dir, "corte-1-plan.json");
    writeFileSync(extPath, JSON.stringify(FINANCAS_CORTE1_EXTENSION));

    const result = runPlan(contextFor(dir), {
      extend: true,
      replacePlaceholder: "WU015",
      fromFile: extPath,
    });
    expect(result.exitCode).toBe(ExitCode.Success);

    const state = readState(dir);

    // WU001-WU014 unchanged/done.
    for (let i = 1; i <= 14; i++) {
      const id = `WU${String(i).padStart(3, "0")}`;
      expect(state.workGraph.workUnits.find((wu: { id: string }) => wu.id === id).status).toBe("done");
    }

    // WU015 replanned, preserved, never selectable again.
    const wu15 = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU015");
    expect(wu15.status).toBe("replanned");
    expect(wu15.replanReason).toBe(FINANCAS_CORTE1_EXTENSION.extension.reason);

    // First detailed Corte 1 entry is ready; the rest are planned/blocked.
    const entry = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Budget model");
    expect(entry.status).toBe("ready");
    const middle = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Budget CRUD");
    expect(middle.status).toBe("planned");
    const exit = state.workGraph.workUnits.find((wu: { title: string }) => wu.title === "Budget report");
    expect(exit.status).toBe("planned");

    // Corte 2 placeholder (WU016) does not become ready prematurely.
    const wu16 = state.workGraph.workUnits.find((wu: { id: string }) => wu.id === "WU016");
    expect(wu16.status).toBe("planned");

    // currentWorkUnitId stays null -- no packet is auto-generated for the
    // extension. lastAgentPacket still mirrors the last real aiqt next call
    // (WU014's checkpoint), not any new/placeholder work unit.
    expect(state.currentWorkUnitId).toBeNull();
    expect(state.lastAgentPacket?.workUnitId).toBe("WU014");
  });

  it("full review/graph validation passes after the extension, with only intentional roadmap warnings", async () => {
    dir = makeTempDir();
    await buildFinancasCorte0Fixture(dir);
    const extPath = join(dir, "corte-1-plan.json");
    writeFileSync(extPath, JSON.stringify(FINANCAS_CORTE1_EXTENSION));
    expect(
      runPlan(contextFor(dir), { extend: true, replacePlaceholder: "WU015", fromFile: extPath }).exitCode,
    ).toBe(ExitCode.Success);

    const graphResult = runGraphValidate(contextFor(dir, true));
    expect(graphResult.exitCode).toBe(ExitCode.Success);
    const graphData = graphResult.data as { blockingErrors: unknown[] };
    expect(graphData.blockingErrors).toHaveLength(0);

    const reviewResult = runReviewCommand(contextFor(dir, true), {});
    expect(reviewResult.exitCode).not.toBe(ExitCode.InvalidInput);
  });
});
