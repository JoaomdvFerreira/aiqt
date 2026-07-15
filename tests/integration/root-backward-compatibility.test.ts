import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { removeDir, contextFor, copyFixture } from "../helpers.js";

describe("M16 backward compatibility: pre-M16 project.json fixtures with existingRepositoryPath: null", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("aiqt status resolves implementationRoot to the control root for an old fixture", () => {
    dir = copyFixture("initialized-project");
    const result = runStatus(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { roots: { controlRoot: string; implementationRoot: string; sameRoot: boolean } };
    expect(data.roots.controlRoot).toBe(resolve(dir));
    expect(data.roots.implementationRoot).toBe(resolve(dir));
    expect(data.roots.sameRoot).toBe(true);
  });

  it("aiqt manage resolves the same root summary for an old fixture", () => {
    dir = copyFixture("initialized-project");
    const result = runManage(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { roots: { sameRoot: boolean } };
    expect(data.roots.sameRoot).toBe(true);
  });
});
