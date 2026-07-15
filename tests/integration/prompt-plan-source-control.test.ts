import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

async function makeReadyProject(dir: string, objective: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective, targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

describe("aiqt prompt plan: M15 repository initialization/baseline requirement", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("requires an early repository initialization/baseline work unit when no Git repository exists", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir, "Build a small internal tool.");
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Repository initialization guidance:");
    expect(data.prompt).toContain("repository initialization/baseline work unit");
  });

  it("does not require repository initialization when a .git directory already exists at the control root", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir, "Build a small internal tool.");
    mkdirSync(join(dir, ".git"), { recursive: true });
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("Repository initialization guidance:");
  });

  it("does not require repository initialization when the user explicitly disables source control", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir, "A throwaway prototype with no source control, just for exploration.");
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("Repository initialization guidance:");
  });

  it("keeps existing M13/M14 design/component/working-directory guidance intact", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      objective: "Build a Next.js and React marketplace with a booking flow using shadcn/ui and Tailwind.",
      targetUser: ["Client"],
    });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });

    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("aiqt-design-system-planner");
    expect(data.prompt).toContain("Component-system enforcement (shadcn/ui):");
    expect(data.prompt).toContain("Repository initialization guidance:");
  });
});
