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
 * M11 §17: a Natural Medicine Marketplace-style terminal fixture with real
 * open checkpoint issues -- one agent-fixable (promotable, non-blocking) and
 * one release-blocking-but-not-agent-fixable (promotable, requires human
 * judgement to fix but still eligible for repair-work tracking).
 */
export const M11_AGENT_FIXABLE_ISSUE_KEY =
  "checkpoint:WU002:issue:remaining-form-error-wrappers";
export const M11_RELEASE_BLOCKER_ISSUE_KEY =
  "checkpoint:WU003:issue:user-profile-role-escalation";

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
      title: "Unit 2 (form error wrappers)",
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

const BASE_DONE_PAYLOAD = {
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
 * Build a done/terminal project state where WU002's checkpoint has an open,
 * agent-fixable issue ("remaining form error wrappers") and WU003's
 * checkpoint has an open, non-agent-fixable, release-blocking issue ("user
 * profile role escalation"), plus a clean WU001. All three work units end
 * up "done" so nextRecommendedCommand naturally settles once issue overrides
 * are applied. Mirrors the pattern in dogfood-fixture.ts's
 * buildDogfoodTerminalState.
 */
export async function buildM11FixtureState(dir: string): Promise<void> {
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

  const planPath = join(dir, "m11-plan.json");
  writeFileSync(planPath, JSON.stringify(PLAN_INPUT));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);

  // WU001: clean done checkpoint, no issues.
  let nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  let cpResult = runCheckpoint(contextFor(dir), { input: BASE_DONE_PAYLOAD });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  // WU002: done, but with an open, agent-fixable issue.
  nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  cpResult = runCheckpoint(contextFor(dir), {
    input: {
      ...BASE_DONE_PAYLOAD,
      issues: [
        {
          title: "Remaining form error wrappers",
          description: "A few forms still need consistent error wrapper components.",
          severity: "medium",
          status: "open",
          agentCanFix: true,
        },
      ],
    },
  });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  // WU003: done, but with an open, non-agent-fixable, release-blocking issue.
  nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
  cpResult = runCheckpoint(contextFor(dir), {
    input: {
      ...BASE_DONE_PAYLOAD,
      issues: [
        {
          title: "User profile role escalation",
          description: "A user can escalate their own profile role without authorization checks.",
          severity: "high",
          status: "open",
          agentCanFix: false,
        },
      ],
    },
  });
  expect(cpResult.exitCode).toBe(ExitCode.Success);

  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  expect(state.projectStatus).toBe("review");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
