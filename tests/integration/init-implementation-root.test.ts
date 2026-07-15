import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

describe("aiqt init: M16 --implementation-root", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("defaults implementationRoot to the control root without needing stored existingRepositoryPath", () => {
    dir = makeTempDir();
    const result = runInit(contextFor(dir, true), normalizeInitOptions({}));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.existingRepositoryPath).toBeNull();

    const data = result.data as { roots: { controlRoot: string; implementationRoot: string; sameRoot: boolean } };
    expect(data.roots.sameRoot).toBe(true);
    expect(data.roots.implementationRoot).toBe(data.roots.controlRoot);
    expect(data.roots.controlRoot).toBe(resolve(dir));
  });

  it("writes existingRepositoryPath when --implementation-root is supplied", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "..", "split-app");
    const result = runInit(contextFor(dir, true), normalizeInitOptions({ implementationRoot: implRoot }));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.existingRepositoryPath).toBe(implRoot);

    const data = result.data as { roots: { implementationRoot: string; sameRoot: boolean } };
    expect(data.roots.sameRoot).toBe(false);
    expect(data.roots.implementationRoot).toBe(resolve(dir, implRoot));
  });

  it("does not inspect Git or create a .git directory when --implementation-root is supplied", () => {
    dir = makeTempDir();
    const implRoot = join(dir, "app-repo");
    runInit(contextFor(dir), normalizeInitOptions({ implementationRoot: implRoot }));
    // aiqt init never inspects/creates Git repositories (M16 §11).
    expect(() => readFileSync(join(implRoot, ".git"))).toThrow();
  });
});
