import { describe, it, expect, afterEach } from "vitest";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt prompt driver: M13 design-system guidance", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("instructs the external agent to establish a design system before UI work for a UI-heavy idea", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), {
      kind: "driver",
      idea: "Build a Next.js and React marketplace with a booking flow using shadcn/ui and Tailwind.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Design-system guidance:");
    expect(data.prompt).toMatch(/Do not jump directly into UI implementation/);
    expect(data.prompt).toContain("design-system foundation work before feature screens");
  });

  it("does not add design-system guidance for a CLI/backend idea", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), {
      kind: "driver",
      idea: "A command-line tool that renames files in bulk.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("Design-system guidance:");
  });

  it("works before aiqt init (no .aiqt/ directory)", () => {
    dir = makeTempDir();
    const result = runPrompt(contextFor(dir), {
      kind: "driver",
      idea: "Build a SaaS dashboard with an onboarding flow using React and shadcn/ui.",
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Design-system guidance:");
  });
});
