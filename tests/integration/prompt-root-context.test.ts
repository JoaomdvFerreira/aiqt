import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
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

describe("aiqt prompt driver: M16 root context (F064)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("names the control root and implementation root without requiring manual repetition", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver", idea: "Build a small tool" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("AIQT control root:");
    expect(data.prompt).toContain(resolve(dir));
    expect(data.prompt).toContain("Implementation root:");
    expect(data.prompt).toContain(
      "Run application, Git, validation, and Playwright/browser commands from the implementation root.",
    );
  });

  it("works before aiqt init and still renders the root context block", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("AIQT control root:");
  });
});

describe("aiqt prompt plan: M16 same-root/split-root awareness", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  async function makeReadyProject(dir: string) {
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Build a small internal tool.", targetUser: ["devs"] });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });
  }

  it("reports a same-root project when no existingRepositoryPath is configured", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Root context:");
    expect(data.prompt).toMatch(/same-root project/i);
  });

  it("reports a split-root project when existingRepositoryPath differs from the control root", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    await runUpdate(contextFor(dir), { repositoryPath: join(dir, "..", "split-app") });
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    const data = result.data as { prompt: string };
    expect(data.prompt).toMatch(/split-root project/i);
  });
});

describe("aiqt prompt checkpoint: M16 root context", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("names the resolved implementation root in the source-control report", async () => {
    dir = makeTempDir();
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

    const result = runPrompt(contextFor(dir), { kind: "checkpoint" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain(`- Implementation root: ${resolve(dir)}`);
  });
});

describe("aiqt next: M16 packet root-aware guidance", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("names the resolved implementation root in Source Control Expectations and Required Agent Output", async () => {
    dir = makeTempDir();
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

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { packet: string };
    expect(data.packet).toContain(`Implementation root: ${resolve(dir)}`);
    expect(data.packet).toContain(`Report all file paths relative to the implementation root: ${resolve(dir)}`);
  });
});
