import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNextPreview } from "../../src/cli/commands/next-preview.command.js";
import { runValidationSelect } from "../../src/cli/commands/validation-select.command.js";
import { runValidationExplain } from "../../src/cli/commands/validation-explain.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");

async function makePlannedProject(dir: string): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
}

/**
 * M41-WU03 (build spec Sec 9): `aiqt validation select`/`explain` against
 * a real planned project -- exercises the exact same
 * buildExecutionGuidanceForWorkUnit path `next --preview` uses.
 */
describe("aiqt validation select / explain", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails closed (exit 3) when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runValidationSelect(contextFor(dir), { workUnit: "WU-1" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("requires --work-unit (exit 10, needs_input)", () => {
    dir = makeTempDir();
    const result = runValidationSelect(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
    expect(result.requiresHumanInput).toBe(true);
  });

  it("reports a clear not-found error for an unknown Work Unit id", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const result = runValidationSelect(contextFor(dir), { workUnit: "does-not-exist" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.blockingIssues.some((i) => i.id === "VALIDATION-WORK-UNIT-NOT-FOUND")).toBe(true);
  });

  it("select and explain agree with next --preview's own guidance for the same Work Unit (one shared owner, no drift)", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);

    const preview = runNextPreview(contextFor(dir));
    expect(preview.exitCode).toBe(ExitCode.Success);
    const workUnitId = (preview.data as { executionGuidance?: { workUnitId: string } })?.executionGuidance?.workUnitId;
    expect(typeof workUnitId).toBe("string");

    const select = runValidationSelect(contextFor(dir), { workUnit: workUnitId });
    expect(select.status).toBe("passed");
    const selectData = select.data as { requiredNow: unknown; testImpact: { selectionVersion: string } | null };
    expect(selectData.testImpact).not.toBeNull();

    const explain = runValidationExplain(contextFor(dir), { workUnit: workUnitId });
    expect(explain.status).toBe("passed");
    const explainData = explain.data as { testImpact: unknown; explain: string };
    expect(explainData.testImpact).toEqual(selectData.testImpact);
    expect(explainData.explain).toContain("Test Impact Selection");
  });

  it("never mutates workflow state (read-only)", async () => {
    dir = makeTempDir();
    await makePlannedProject(dir);
    const preview = runNextPreview(contextFor(dir));
    const workUnitId = (preview.data as { executionGuidance?: { workUnitId: string } })?.executionGuidance?.workUnitId;

    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runValidationSelect(contextFor(dir), { workUnit: workUnitId });
    runValidationExplain(contextFor(dir), { workUnit: workUnitId });
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });
});
