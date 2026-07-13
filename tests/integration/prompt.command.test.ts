import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

async function makeReadyProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

async function makeInProgressProject(dir: string) {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
  runPlan(contextFor(dir), { fromFile: planPath });
  runNext(contextFor(dir));
}

describe("aiqt prompt", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "update" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("fails with exit code 3 on an unsupported prompt kind", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPrompt(contextFor(dir), { kind: "bogus" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    expect(result.nextRecommendedCommand).toBeNull();
  });

  it("prompt update succeeds on a bare initialized project", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPrompt(contextFor(dir), { kind: "update" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    const data = result.data as { prompt: string; promptKind: string };
    expect(data.promptKind).toBe("update");
    expect(data.prompt).toContain('"project"');
  });

  it("prompt plan blocks with exit code 2 and recommends aiqt update when context is not ready", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedCommand).toBe("aiqt update");
  });

  it("prompt plan succeeds when context is ready and the graph is empty", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain('"milestones"');
  });

  it("prompt plan blocks with exit code 2 once a work graph already exists", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, "valid-plan.json")));
    runPlan(contextFor(dir), { fromFile: planPath });
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  });

  it("prompt checkpoint blocks with exit code 2 and recommends aiqt next when no work unit is in progress", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "checkpoint" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt next");
  });

  it("prompt checkpoint succeeds when a work unit is in progress", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "checkpoint" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("WU001");
  });

  it("writes the prompt file only under .aiqt/inputs/ when --out is supplied", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "plan", out: ".aiqt/inputs/plan.prompt.md" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.changedFiles).toHaveLength(1);
    expect(existsSync(join(dir, ".aiqt", "inputs", "plan.prompt.md"))).toBe(true);
    const data = result.data as { wroteFile: boolean; outputPath: string | null };
    expect(data.wroteFile).toBe(true);
    expect(data.outputPath).toBe(".aiqt/inputs/plan.prompt.md");
  });

  it("does not overwrite an existing --out file by default", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    runPrompt(contextFor(dir), { kind: "plan", out: ".aiqt/inputs/plan.prompt.md" });
    const before = readFileSync(join(dir, ".aiqt", "inputs", "plan.prompt.md"), "utf8");

    const result = runPrompt(contextFor(dir), { kind: "plan", out: ".aiqt/inputs/plan.prompt.md" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedCommand).toBe("aiqt prompt plan --out <different-path>");
    expect(readFileSync(join(dir, ".aiqt", "inputs", "plan.prompt.md"), "utf8")).toBe(before);
  });

  it("fails with exit code 3 and no mutation when --out is outside .aiqt/inputs/", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "update", out: "update.prompt.md" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    expect(existsSync(join(dir, "update.prompt.md"))).toBe(false);
  });

  it("never mutates project.json, state.json, or runlog.jsonl", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const stateBefore = readState(dir);
    const runlogBefore = readRunlogLines(dir).length;
    runPrompt(contextFor(dir), { kind: "update" });
    runPrompt(contextFor(dir), { kind: "plan", out: ".aiqt/inputs/plan.prompt.md" });
    expect(readState(dir)).toEqual(stateBefore);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("creates no markdown files outside .aiqt/inputs/", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    runPrompt(contextFor(dir), { kind: "plan", out: ".aiqt/inputs/plan.prompt.md" });
    for (const forbidden of ["AIQT.md", "AGENTS.md", "CLAUDE.md", "docs", ".milestones", ".tasks"]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
  });
});
