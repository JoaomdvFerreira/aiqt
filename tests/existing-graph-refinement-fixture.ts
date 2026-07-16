import { writeFileSync } from "node:fs";
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

function wu(clientKey: string, milestoneClientKey: string, title: string) {
  return {
    clientKey,
    milestoneClientKey,
    title,
    objective: `${title}.`,
    scope: [`Implement ${title}.`],
    outOfScope: ["Nothing outside this unit's scope."],
    acceptanceCriteria: [`${title} is complete.`],
    agentContextRefs: [],
    suggestedFiles: ["src/"],
    validationCommands: ["pnpm test"],
  };
}

const COMPLETED_MILESTONES = [
  { clientKey: "m1", title: "Upstream area A", objective: "First completed area of work." },
  { clientKey: "m2", title: "Upstream area B", objective: "Second completed area of work." },
  { clientKey: "m3", title: "Upstream area C", objective: "Third completed area of work." },
  { clientKey: "m4", title: "Upstream area D", objective: "Fourth completed area of work." },
  { clientKey: "m5", title: "Upstream closeout", objective: "Final completed closeout work." },
];

const FUTURE_MILESTONES = [
  { clientKey: "m6", title: "Refinable future work", objective: "Placeholder for the next detailed cut of work." },
  { clientKey: "m7", title: "Further future work 1", objective: "Placeholder for a later cut of work." },
  { clientKey: "m8", title: "Further future work 2", objective: "Placeholder for a later cut of work." },
  { clientKey: "m9", title: "Further future work 3", objective: "Placeholder for a later cut of work." },
  { clientKey: "m10", title: "Further future work 4", objective: "Placeholder for a later cut of work." },
  { clientKey: "m11", title: "Further future work 5", objective: "Placeholder for a later cut of work." },
  { clientKey: "m12", title: "Further future work 6", objective: "Placeholder for a later cut of work." },
];

const COMPLETED_WORK_UNITS = [
  wu("wu1", "m1", "Complete area A step 1"),
  wu("wu2", "m1", "Complete area A step 2"),
  wu("wu3", "m1", "Complete area A step 3"),
  wu("wu4", "m2", "Complete area B step 1"),
  wu("wu5", "m2", "Complete area B step 2"),
  wu("wu6", "m2", "Complete area B step 3"),
  wu("wu7", "m3", "Complete area C step 1"),
  wu("wu8", "m3", "Complete area C step 2"),
  wu("wu9", "m3", "Complete area C step 3"),
  wu("wu10", "m4", "Complete area D step 1"),
  wu("wu11", "m4", "Complete area D step 2"),
  wu("wu12", "m4", "Complete area D step 3"),
  wu("wu13", "m5", "Final QA pass"),
  wu("wu14", "m5", "Upstream closeout"),
];

const FUTURE_WORK_UNITS = [
  wu("wu15", "m6", "Refinable future work unit"),
  wu("wu16", "m7", "Further future work unit 1"),
  wu("wu17", "m8", "Further future work unit 2"),
  wu("wu18", "m9", "Further future work unit 3"),
  wu("wu19", "m10", "Further future work unit 4"),
  wu("wu20", "m11", "Further future work unit 5"),
  wu("wu21", "m12", "Further future work unit 6"),
];

const PLAN_INPUT = {
  milestones: [...COMPLETED_MILESTONES, ...FUTURE_MILESTONES],
  workUnits: [...COMPLETED_WORK_UNITS, ...FUTURE_WORK_UNITS],
  dependencies: [
    { fromClientKey: "wu14", toClientKey: "wu15", type: "blocks" },
    { fromClientKey: "wu15", toClientKey: "wu16", type: "blocks" },
  ],
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
 * M17-RC1 §13.1/§9: a generic "existing graph refinement" regression fixture
 * -- an arbitrary but representative non-empty graph with an upstream
 * completed area of work, one refinable future work unit promoted to
 * "ready" by its real incoming `blocks` dependency being satisfied, one
 * downstream future work unit kept planned/blocked behind its outgoing
 * `blocks` dependency, and further downstream placeholders. Not tied to any
 * consumer project's domain, naming, or fixed roadmap.
 */
export async function buildExistingGraphRefinementFixture(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), {
    objective: "A generic multi-cut project used only to regression-test incremental plan refinement.",
    targetUser: ["internal users"],
  });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "existing-graph-plan.json");
  writeFileSync(planPath, JSON.stringify(PLAN_INPUT));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  for (let i = 0; i < 14; i++) {
    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const cpResult = runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD });
    expect(cpResult.exitCode).toBe(ExitCode.Success);
  }
}

/** A bounded, valid refinement payload replacing the refinable future work unit. */
export const REFINABLE_WORK_UNIT_REFINEMENT = {
  extension: {
    entryWorkUnitClientKeys: ["r-wu1"],
    exitWorkUnitClientKeys: ["r-wu3"],
    reason: "Detail the refinable future work after the completed upstream area finished.",
  },
  milestones: [
    { clientKey: "r-m1", title: "Refinement detail", objective: "Detailed replacement work for the refined unit." },
  ],
  workUnits: [
    wu("r-wu1", "r-m1", "Replacement step 1"),
    wu("r-wu2", "r-m1", "Replacement step 2"),
    wu("r-wu3", "r-m1", "Replacement step 3"),
  ],
  dependencies: [
    { fromClientKey: "r-wu1", toClientKey: "r-wu2", type: "blocks" },
    { fromClientKey: "r-wu2", toClientKey: "r-wu3", type: "blocks" },
  ],
};
