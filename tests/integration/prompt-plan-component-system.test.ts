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

describe("aiqt prompt plan: M14 component-system enforcement", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("requires a shadcn/ui setup/integration work unit when shadcn/ui is declared", async () => {
    dir = makeTempDir();
    await makeReadyProject(
      dir,
      "Build a Next.js and React marketplace with a booking flow.",
      ["shadcn/ui", "Tailwind"],
    );
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).toContain("Component-system enforcement (shadcn/ui):");
    expect(data.prompt).toContain("shadcn/ui setup or integration work unit");
    expect(data.prompt).toContain("components.json or equivalent shadcn/ui configuration exists.");
    expect(data.prompt).toContain("No duplicate hand-rolled Button/Input/Card primitives exist unless justified.");
  });

  it("does not inject shadcn/ui enforcement when no component-system preference is declared", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir, "Build a product with a dashboard and an onboarding flow.", []);
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("Component-system enforcement (shadcn/ui):");
  });

  it("does not inject shadcn/ui enforcement for a project that explicitly prefers custom primitives only", async () => {
    dir = makeTempDir();
    await makeReadyProject(
      dir,
      "Build a Next.js and React marketplace with a booking flow. This project uses custom Tailwind primitives only, no shadcn.",
      [],
    );
    const result = runPrompt(contextFor(dir), { kind: "plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { prompt: string };
    expect(data.prompt).not.toContain("Component-system enforcement (shadcn/ui):");
  });
});
