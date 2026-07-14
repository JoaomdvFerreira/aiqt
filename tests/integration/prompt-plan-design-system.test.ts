import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPrompt } from "../../src/cli/commands/prompt.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

async function makeReadyProject(dir: string, objective: string, technologyPreferences: string[] = []) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective, targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({
      context: {
        constraints: ["Local files are the source of truth"],
        technologyPreferences,
      },
    }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

describe("aiqt prompt plan: M13 design-system injection", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes the design-system planner and Design System Foundation guidance for a high-confidence UI project", async () => {
    dir = makeTempDir();
    await makeReadyProject(
      dir,
      "Build a Next.js and React marketplace with a booking flow and an onboarding flow.",
      ["shadcn/ui", "Tailwind"],
    );
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("aiqt-design-system-planner");
    expect(data.prompt).toContain("Design System Foundation work:");
    expect(data.prompt).toContain("design-system-foundation");
    expect(data.prompt).toMatch(/must establish/);
  });

  it("uses recommendation language (not a requirement) for a medium-confidence UI project", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir, "Build a product with a dashboard and an onboarding flow.", []);
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("aiqt-design-system-planner");
    expect(data.prompt).toMatch(/Consider establishing/);
    // Medium confidence must not request the Design System Foundation work unit.
    expect(data.prompt).not.toContain("design-system-foundation");
  });

  it("does not inject design-system requirements for a CLI/backend project", async () => {
    dir = makeTempDir();
    await makeReadyProject(
      dir,
      "A command-line tool that renames files in bulk and reads YAML configuration.",
      [],
    );
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("aiqt-design-system-planner");
    expect(data.prompt).not.toContain("Design System Foundation work:");
  });
});
