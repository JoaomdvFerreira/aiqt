import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

async function makeInProgressProject(dir: string) {
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
  runPlan(contextFor(dir), { fromFile: planPath });
  runNext(contextFor(dir));
}

describe("aiqt prompt checkpoint: M15 source-control/risk reporting guidance", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("asks the agent to report source-control and risk details in existing checkpoint fields", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "checkpoint" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Source control report:");
    expect(data.prompt).toContain("Implementation root:");
    expect(data.prompt).toContain("Commit created: yes/no");
    expect(data.prompt).toContain("Tag created: yes/no");
    expect(data.prompt).toContain("Risk report:");
    expect(data.prompt).toContain("Risk score: <0-100>/100");
    expect(data.prompt).toContain("AIQT severity: low|medium|high|critical");
    expect(data.prompt).toMatch(/does not execute Git\/GitHub commands/i);
  });

  it("does not introduce a new checkpoint JSON field", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "checkpoint" });
    const data = result.data as { prompt: string };
    // The exact CHECKPOINT_JSON_SHAPE fields, unchanged from pre-M15.
    for (const field of [
      '"summary"',
      '"completed"',
      '"notCompleted"',
      '"filesChanged"',
      '"validationResult"',
      '"acceptanceCriteriaResult"',
      '"validationCommands"',
      '"acceptanceCriteria"',
      '"issues"',
      '"targetStatus"',
      '"notes"',
    ]) {
      expect(data.prompt).toContain(field);
    }
  });
});
