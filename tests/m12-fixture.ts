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

/**
 * M12 §17: a WU003-style terminal fixture -- WU001 done/clean, WU002
 * needs_review (partial acceptance, awaiting checkpoint amend), WU003 done
 * but with a stale partial acceptance result on its latest checkpoint
 * (patched directly, mirroring dogfood-fixture.ts's documented pattern for
 * reaching an otherwise CLI-unreachable state).
 */
export const M12_NEEDS_REVIEW_WORK_UNIT_ID = "WU002";
export const M12_DONE_STALE_WORK_UNIT_ID = "WU003";

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
      title: "Unit 2 (Clerk auth integration)",
      objective: "Wire up live authentication verification.",
      scope: ["Integrate Clerk auth"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Live Clerk verification passes"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "wu3",
      milestoneClientKey: "m1",
      title: "Unit 3 (user profile roles)",
      objective: "Wire up user profile role management.",
      scope: ["Implement user profile roles"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Role escalation is prevented"],
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

export async function buildCheckpointAmendmentFixtureState(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), {
    objective: "Ship the marketplace MVP",
    targetUser: ["Client", "Professional"],
  });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "m12-plan.json");
  writeFileSync(planPath, JSON.stringify(PLAN_INPUT));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  // WU001: clean done checkpoint.
  let nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  let cpResult = runCheckpoint(contextFor(dir), { input: DONE_PAYLOAD });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  // WU002: partial acceptance -> lands at needs_review via the completion gate.
  nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  cpResult = runCheckpoint(contextFor(dir), {
    input: {
      ...DONE_PAYLOAD,
      validationResult: "partial",
      acceptanceCriteriaResult: "partial",
      acceptanceCriteria: [{ criterion: "Live Clerk verification passes", result: "partial" }],
      notes: ["Live Clerk verification requires user-owned setup."],
    },
  });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const wu2 = state.workGraph.workUnits.find((w: { id: string }) => w.id === "WU002");
  expect(wu2.status).toBe("needs_review");
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  // WU003: partial acceptance, then promoted to done by patching state.json
  // directly (mirrors dogfood-fixture.ts's documented WU003 recovery path --
  // aiqt checkpoint amend is precisely the in-scope replacement for this
  // manual patch, which is why this fixture exists).
  nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  cpResult = runCheckpoint(contextFor(dir), {
    input: {
      ...DONE_PAYLOAD,
      acceptanceCriteriaResult: "partial",
      acceptanceCriteria: [{ criterion: "Role escalation is prevented", result: "partial" }],
      notes: ["Role escalation edge case needs review."],
    },
  });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  const state2 = JSON.parse(readFileSync(statePath, "utf8"));
  const wu3 = state2.workGraph.workUnits.find((w: { id: string }) => w.id === "WU003");
  expect(wu3.status).toBe("needs_review");
  wu3.status = "done";
  wu3.updatedAt = state2.lastUpdatedAt;
  const milestone = state2.workGraph.milestones.find((m: { id: string }) => m.id === wu3.milestoneId);
  milestone.status = "done";
  state2.projectStatus = "review";
  state2.currentWorkUnitId = null;
  state2.currentMilestoneId = null;
  state2.nextRecommendedCommand = "aiqt review";
  writeFileSync(statePath, JSON.stringify(state2, null, 2));
}

const DEPENDENCY_PLAN_INPUT = {
  milestones: [{ clientKey: "m1", title: "Foundation", objective: "Build the marketplace foundation." }],
  workUnits: [
    {
      clientKey: "readiness",
      milestoneClientKey: "m1",
      title: "i18n readiness pass",
      objective: "Prepare i18n readiness for release.",
      scope: ["i18n readiness"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Readiness pass complete"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "profile",
      milestoneClientKey: "m1",
      title: "Public profile work",
      objective: "Build the public profile feature.",
      scope: ["Public profile"],
      outOfScope: ["Nothing else"],
      acceptanceCriteria: ["Profile page renders"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [
    { fromClientKey: "profile", toClientKey: "readiness", type: "relates_to", reason: "Related work." },
  ],
};

export const M12_DEP_ID = "DEP-001";
export const M12_READINESS_WORK_UNIT_ID = "WU001";
export const M12_PROFILE_WORK_UNIT_ID = "WU002";

/**
 * M12 §17: a DEP-031-style fixture -- a relates_to dependency from "profile"
 * (not done) into a late-stage "readiness" work unit, with both work units
 * still "ready" (relates_to never blocks readiness). Used to test that
 * tightening the dependency to "blocks" demotes the readiness work unit back
 * to "planned".
 */
export async function buildDependencyFixtureState(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), {
    objective: "Ship the marketplace MVP",
    targetUser: ["Client", "Professional"],
  });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "m12-dependency-plan.json");
  writeFileSync(planPath, JSON.stringify(DEPENDENCY_PLAN_INPUT));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
}

/**
 * Same as buildDependencyFixtureState, but additionally selects the
 * readiness work unit (WU001) into in_progress via aiqt next, so a
 * dependency update onto it can be tested against the
 * active-execution-invalidation rule.
 */
export async function buildDependencyInProgressFixtureState(dir: string): Promise<void> {
  await buildDependencyFixtureState(dir);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  expect(state.currentWorkUnitId).toBe(M12_READINESS_WORK_UNIT_ID);
}
