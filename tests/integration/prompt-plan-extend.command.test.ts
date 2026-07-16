import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const BASE_PLAN = {
  milestones: [{ clientKey: "m1", title: "Completed upstream work", objective: "Foundational work." }],
  workUnits: [
    {
      clientKey: "wu1",
      milestoneClientKey: "m1",
      title: "First unit",
      objective: "First unit objective.",
      scope: ["Scope"],
      outOfScope: ["Out of scope"],
      acceptanceCriteria: ["Criterion"],
      agentContextRefs: [],
      suggestedFiles: ["src/"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

async function makeReadyProjectWithGraph(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, JSON.stringify(BASE_PLAN));
  expect(runPlan(contextFor(dir), { fromFile: planPath }).exitCode).toBe(ExitCode.Success);
}

describe("aiqt prompt plan --extend --refine-work-unit", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("renders refinement guidance naming the target and the preview-first workflow", async () => {
    dir = makeTempDir();
    await makeReadyProjectWithGraph(dir);
    const result = runPrompt(contextFor(dir), { kind: "plan", extend: true, refineWorkUnit: "WU001" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string; operation: string };
    expect(data.operation).toBe("refine");
    expect(data.prompt).toContain("WU001");
    expect(data.prompt).toContain("entryWorkUnitClientKeys");
    expect(data.prompt).toContain("exitWorkUnitClientKeys");
    expect(data.prompt).toMatch(/--preview/);
    expect(data.prompt).toContain("aiqt import plan --stdin --extend --refine-work-unit WU001");
  });

  it("still works via the deprecated --replace-placeholder alias", async () => {
    dir = makeTempDir();
    await makeReadyProjectWithGraph(dir);
    const result = runPrompt(contextFor(dir), { kind: "plan", extend: true, replacePlaceholder: "WU001" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.warnings.some((w) => w.id === "PLAN-EXTEND-DEPRECATED-ALIAS")).toBe(true);
  });

  it("rejects both target flags supplied together, exit 3", async () => {
    dir = makeTempDir();
    await makeReadyProjectWithGraph(dir);
    const result = runPrompt(contextFor(dir), {
      kind: "plan",
      extend: true,
      refineWorkUnit: "WU001",
      replacePlaceholder: "WU001",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("returns exit 2 and recommends ordinary aiqt plan when the graph is empty", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPrompt(contextFor(dir), { kind: "plan", extend: true, refineWorkUnit: "WU001" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("does not mutate state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await makeReadyProjectWithGraph(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runPrompt(contextFor(dir), { kind: "plan", extend: true, refineWorkUnit: "WU001" });
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });
});

describe("aiqt prompt plan --extend (append, no target)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("renders append guidance when no refinement target is supplied", async () => {
    dir = makeTempDir();
    await makeReadyProjectWithGraph(dir);
    const result = runPrompt(contextFor(dir), { kind: "plan", extend: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string; operation: string };
    expect(data.operation).toBe("append");
    expect(data.prompt).toMatch(/append/i);
    expect(data.prompt).toContain("aiqt import plan --stdin --extend --preview");
  });

  it("returns exit 2 and recommends ordinary aiqt plan when the graph is empty", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPrompt(contextFor(dir), { kind: "plan", extend: true });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt plan");
  });

  it("does not mutate state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    await makeReadyProjectWithGraph(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runPrompt(contextFor(dir), { kind: "plan", extend: true });
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });
});
