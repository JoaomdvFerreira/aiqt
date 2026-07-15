import { describe, it, expect, afterEach } from "vitest";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt prompt driver: M15-RC1 repository boundary preflight (F063)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes the Repository Boundary Rule and preflight commands", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver", idea: "Build a small tool" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Repository Boundary Rule:");
    expect(data.prompt).toContain("git rev-parse --show-toplevel");
    expect(data.prompt).toContain("git branch --show-current");
    expect(data.prompt).toMatch(/AIQT control root:/);
  });

  it("works before aiqt init and still includes the repository boundary preflight", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Repository Boundary Rule:");
  });
});
