import { describe, it, expect, afterEach } from "vitest";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt prompt driver: M15 source-control discipline", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes Source Control Discipline guidance", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver", idea: "Build a small tool" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Source Control Discipline:");
    expect(data.prompt).toContain("main as the default branch");
    expect(data.prompt).toContain(".gitignore");
    expect(data.prompt).toContain("git status");
    expect(data.prompt).toMatch(/self-attested/i);
  });

  it("works before aiqt init and still includes source-control discipline guidance", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), { kind: "driver" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Source Control Discipline:");
  });
});
