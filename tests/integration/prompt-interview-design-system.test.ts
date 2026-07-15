import { describe, it, expect, afterEach } from "vitest";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt prompt interview: M13 design discovery questions", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("asks design discovery questions for a UI-heavy rough idea", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), {
      kind: "interview",
      idea: "Build a Next.js and React marketplace with a booking flow using shadcn/ui and Tailwind.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string; questions: string[] };
    expect(data.prompt).toMatch(/design-system preference/);
    expect(data.prompt).toMatch(/accessibility/i);
    expect(data.prompt).toMatch(/motion/i);
    expect(data.questions.some((q) => /brand or tone/.test(q))).toBe(true);
  });

  it("does not ask design discovery questions for a plain CLI idea", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), {
      kind: "interview",
      idea: "A command-line tool that renames files in bulk.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { questions: string[] };
    expect(data.questions.some((q) => /design-system preference/.test(q))).toBe(false);
  });
});
