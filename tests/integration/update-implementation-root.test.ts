import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

describe("aiqt update: M16 --implementation-root alias", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("writes existingRepositoryPath via --implementation-root", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), { implementationRoot: "../app" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.existingRepositoryPath).toBe("../app");
  });

  it("still supports --repository-path for backward compatibility", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), { repositoryPath: "../legacy-app" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.existingRepositoryPath).toBe("../legacy-app");
  });

  it("is idempotent when --implementation-root and --repository-path are supplied with the same value", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), {
      implementationRoot: "../app",
      repositoryPath: "../app",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.existingRepositoryPath).toBe("../app");
  });

  it("returns exit code 3 when --implementation-root and --repository-path differ", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), {
      implementationRoot: "../app-a",
      repositoryPath: "../app-b",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    // Neither value should be written on a rejected conflicting update.
    expect(readProject(dir).project.existingRepositoryPath).toBeNull();
  });

  it("can revise the implementation root via --implementation-root after it was already set", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { implementationRoot: "../app-v1" });
    const result = await runUpdate(contextFor(dir), { implementationRoot: "../app-v2" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.existingRepositoryPath).toBe("../app-v2");
  });
});
