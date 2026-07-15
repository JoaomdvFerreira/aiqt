import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt prompt driver: M14 operating discipline", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes the Working Directory Discipline block when existingRepositoryPath is configured", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
    const implRoot = join(dir, "app-repo");
    await runUpdate(contextFor(dir), { repositoryPath: implRoot });

    const result = runPrompt(contextFor(dir), { kind: "driver" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("## Working Directory Discipline");
    expect(data.prompt).toContain("AIQT control root:");
    expect(data.prompt).toContain("Implementation root:");
    expect(data.prompt).toContain(implRoot);
    expect(data.prompt).toContain("Do not create nested application folders under the AIQT control root.");
  });

  it("warns (without inventing a path) when no existingRepositoryPath is configured", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });

    const result = runPrompt(contextFor(dir), { kind: "driver" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("## Working Directory Discipline");
    expect(data.prompt).toContain("No existingRepositoryPath is configured");
  });

  it("includes repair-before-reset (recovery discipline) guidance", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver", idea: "Build a small tool" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Recovery discipline");
    expect(data.prompt).toContain("aiqt issue list / update / promote");
    expect(data.prompt).toContain("aiqt graph repair --dry-run");
    expect(data.prompt).toMatch(/last resort/i);
  });

  it("works before aiqt init and still includes recovery discipline guidance", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Recovery discipline");
  });

  it("does not mutate state.json or runlog.jsonl", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
    await runUpdate(contextFor(dir), { repositoryPath: join(dir, "app-repo") });
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runPrompt(contextFor(dir), { kind: "driver" });
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });
});
