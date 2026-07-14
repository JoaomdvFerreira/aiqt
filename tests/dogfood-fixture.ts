import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { runInit } from "../src/cli/commands/init.command.js";
import { runUpdate } from "../src/cli/commands/update.command.js";
import { runPlan } from "../src/cli/commands/plan.command.js";
import { runNext } from "../src/cli/commands/next.command.js";
import { runCheckpoint } from "../src/cli/commands/checkpoint.command.js";
import { normalizeInitOptions } from "../src/cli/options.js";
import { ExitCode } from "../src/core/output/exit-codes.js";
import { contextFor } from "./helpers.js";

export const DOGFOOD_ACKNOWLEDGE_KEY = "checkpoint:WU003:acceptanceCriteriaResult:partial";

const PLAN_INPUT = {
  milestones: [{ clientKey: "m1", title: "Foundation", objective: "Build the marketplace foundation." }],
  workUnits: [
    {
      clientKey: "wu1",
      milestoneClientKey: "m1",
      title: "Unit 1",
      objective: "First bounded unit.",
      scope: ["Implement unit 1"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Unit 1 works"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu2",
      milestoneClientKey: "m1",
      title: "Unit 2",
      objective: "Second bounded unit.",
      scope: ["Implement unit 2"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Unit 2 works"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu3",
      milestoneClientKey: "m1",
      title: "Unit 3 (Clerk auth integration)",
      objective: "Wire up live authentication verification.",
      scope: ["Integrate Clerk auth"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Live Clerk verification passes"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

const DONE_PAYLOAD = {
  summary: "Implemented the bounded unit.",
  completed: ["Implemented the unit."],
  notCompleted: [],
  filesChanged: ["src/example.ts"],
  validationResult: "passed",
  acceptanceCriteriaResult: "passed",
  validationCommands: [{ command: "pnpm test", result: "passed" }],
  acceptanceCriteria: [{ criterion: "Works", result: "passed" }],
  issues: [],
  notes: [],
};

/**
 * Build the completed Natural Medicine Marketplace dogfood regression state
 * (M9 §13.3): projectStatus=review, all 3 work units done, 0
 * ready/planned/in_progress/needs_review, and WU003's latest checkpoint has
 * acceptanceCriteriaResult=partial despite the unit being done.
 *
 * WU003 is checkpointed as targetStatus-omitted/partial first (which lands
 * at needs_review through the normal completion gate -- AIQT never allows
 * targetStatus="done" with a non-passed acceptance result through aiqt
 * checkpoint itself). It is then promoted to done by patching state.json
 * directly, mirroring the documented real-world path for this scenario:
 * resolving a needs_review unit outside AIQT (aiqt checkpoint amend is
 * explicitly out of M9 scope, and no historical checkpoint is rewritten --
 * only the work unit/milestone/project status fields are patched).
 */
export async function buildDogfoodTerminalState(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship the marketplace MVP", targetUser: ["Client", "Professional"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "dogfood-plan.json");
  writeFileSync(planPath, JSON.stringify(PLAN_INPUT));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  // WU001, WU002: clean done checkpoints.
  for (let i = 0; i < 2; i++) {
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const cpResult = runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD });
    expect(cpResult.exitCode).toBe(ExitCode.Success);
  }

  // WU003: partial acceptance result -> lands at needs_review via the
  // completion gate (targetStatus omitted).
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  const partialPayload = {
    ...DONE_PAYLOAD,
    acceptanceCriteriaResult: "partial",
    acceptanceCriteria: [{ criterion: "Live Clerk verification passes", result: "partial" }],
    notes: ["Live Clerk verification requires user-owned setup."],
  };
  const cpResult = runCheckpoint(contextFor(dir), { input: partialPayload });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const wu3 = state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU003");
  expect(wu3.status).toBe("needs_review");
  wu3.status = "done";
  wu3.updatedAt = state.lastUpdatedAt;
  const milestone = state.workGraph.milestones.find((m: { id: string }) => m.id === wu3.milestoneId);
  milestone.status = "done";
  state.projectStatus = "review";
  state.currentWorkUnitId = null;
  state.currentMilestoneId = null;
  state.nextRecommendedCommand = "aiqt review";
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
