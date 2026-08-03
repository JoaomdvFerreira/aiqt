import { describe, expect, it, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runGuidanceCommand } from "../../src/services/guidance-service.js";
import { runReviewCommand } from "../../src/cli/commands/review.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runGraphRepair } from "../../src/cli/commands/graph-repair.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

async function makePlannedProject(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
}

describe("M32 public workflow recommendation parity", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("aligns status/start/continue/review/manage/next on dangling-pointer repair and graph repair clears it", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.currentWorkUnitId = "WU999";
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const commands = {
      status: runStatus(contextFor(dir)),
      start: runGuidanceCommand(contextFor(dir), "start"),
      continue: runGuidanceCommand(contextFor(dir), "continue"),
      review: runReviewCommand(contextFor(dir)),
      manage: runManage(contextFor(dir)),
      next: runNext(contextFor(dir)),
    };

    expect(Object.fromEntries(Object.entries(commands).map(([name, result]) => [name, result.nextRecommendedCommand]))).toEqual({
      status: "aiqt graph repair --apply",
      start: "aiqt graph repair --apply",
      continue: "aiqt graph repair --apply",
      review: "aiqt graph repair --apply",
      manage: "aiqt graph repair --apply",
      next: "aiqt graph repair --apply",
    });
    expect(commands.next.exitCode).toBe(ExitCode.WorkflowBlocked);

    const repair = runGraphRepair(contextFor(dir), { apply: true });
    expect(repair.exitCode).toBe(ExitCode.Success);
    expect(JSON.parse(readFileSync(statePath, "utf8")).currentWorkUnitId).toBeNull();
  });
});
