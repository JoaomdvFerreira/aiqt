import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const UI_HEAVY_PLAN = {
  milestones: [{ clientKey: "m1", title: "Foundation", objective: "Build the marketplace foundation." }],
  workUnits: [
    {
      clientKey: "profile-page",
      milestoneClientKey: "m1",
      title: "Build the user profile page",
      objective: "Implement the profile page component and layout.",
      scope: ["Create the profile page route", "Add a profile form component"],
      outOfScope: ["Do not implement admin dashboard"],
      acceptanceCriteria: ["Profile page renders with the user's data"],
      agentContextRefs: [],
      suggestedFiles: ["src/app/profile/page.tsx", "src/components/ui/profile-form.tsx"],
      validationCommands: ["pnpm test"],
    },
    {
      clientKey: "backend-job",
      milestoneClientKey: "m1",
      title: "Nightly data reconciliation job",
      objective: "Reconcile marketplace ledger entries overnight.",
      scope: ["Write the reconciliation script"],
      outOfScope: ["Do not touch the UI"],
      acceptanceCriteria: ["Job runs and produces a reconciliation report"],
      agentContextRefs: [],
      suggestedFiles: ["src/jobs/reconcile.ts"],
      validationCommands: ["pnpm test"],
    },
  ],
  dependencies: [],
};

async function buildUiHeavyProject(dir: string, planWorkUnitIndex: 0 | 1): Promise<void> {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), {
    objective: "Build a Next.js and React marketplace with a booking flow using shadcn/ui and Tailwind.",
    targetUser: ["Client", "Professional"],
  });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });

  const planPath = join(dir, "plan.json");
  // Only include the requested work unit so aiqt next deterministically selects it.
  const plan = { ...UI_HEAVY_PLAN, workUnits: [UI_HEAVY_PLAN.workUnits[planWorkUnitIndex]] };
  writeFileSync(planPath, JSON.stringify(plan));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt next: M13 Design Guidance packet section", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("adds the Design Guidance section for a UI-related work unit in a UI-heavy project", async () => {
    dir = makeTempDir();
    await buildUiHeavyProject(dir, 0);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { packet: string };
    expect(data.packet).toContain("## Design Guidance");
    expect(data.packet).toContain("Do not introduce a second visual system.");
    expect(data.packet).toContain("Keep this work unit bounded to the selected packet scope.");
  });

  it("does not add the Design Guidance section for a non-UI work unit, even in a UI-heavy project", async () => {
    dir = makeTempDir();
    await buildUiHeavyProject(dir, 1);
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { packet: string };
    expect(data.packet).not.toContain("## Design Guidance");
  });

  it("does not add the Design Guidance section for a UI-shaped work unit in a non-UI-heavy project", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      objective: "A command-line tool that renames files in bulk.",
      targetUser: ["devs"],
    });
    const patchPath = join(dir, "readiness-patch.json");
    writeFileSync(
      patchPath,
      JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
    );
    await runUpdate(contextFor(dir), { fromFile: patchPath });

    const planPath = join(dir, "plan.json");
    const plan = { ...UI_HEAVY_PLAN, workUnits: [UI_HEAVY_PLAN.workUnits[0]] };
    writeFileSync(planPath, JSON.stringify(plan));
    runPlan(contextFor(dir), { fromFile: planPath });

    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { packet: string };
    expect(data.packet).not.toContain("## Design Guidance");
  });

  it("never expands packet scope: Design Guidance appears after Out of Scope and does not duplicate scope content", async () => {
    dir = makeTempDir();
    await buildUiHeavyProject(dir, 0);
    const result = runNext(contextFor(dir));
    const data = result.data as { packet: string };
    const outOfScopeIndex = data.packet.indexOf("## Out of Scope");
    const designGuidanceIndex = data.packet.indexOf("## Design Guidance");
    expect(outOfScopeIndex).toBeGreaterThan(-1);
    expect(designGuidanceIndex).toBeGreaterThan(outOfScopeIndex);
  });
});
