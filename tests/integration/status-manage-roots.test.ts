import { describe, it, expect, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt status: M16 root display", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes control root and resolved implementation root in the summary and data (same-root)", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runStatus(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.summary).toContain("AIQT control root:");
    expect(result.summary).toContain("Implementation root:");
    const data = result.data as { roots: { controlRoot: string; implementationRoot: string; sameRoot: boolean } };
    expect(data.roots.controlRoot).toBe(resolve(dir));
    expect(data.roots.implementationRoot).toBe(resolve(dir));
    expect(data.roots.sameRoot).toBe(true);
  });

  it("reflects a configured split-root implementation root", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { repositoryPath: join(dir, "..", "split-app") });
    const result = runStatus(contextFor(dir, true));
    const data = result.data as { roots: { implementationRoot: string; sameRoot: boolean } };
    expect(data.roots.sameRoot).toBe(false);
    expect(data.roots.implementationRoot).toBe(resolve(dir, "..", "split-app"));
  });
});

describe("aiqt manage: M16 root summary", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes a root summary in JSON data", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runManage(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { roots: { controlRoot: string; implementationRoot: string; sameRoot: boolean } };
    expect(data.roots.controlRoot).toBe(resolve(dir));
    expect(data.roots.sameRoot).toBe(true);
  });
});
