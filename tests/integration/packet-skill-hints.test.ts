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

async function makeReadyProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(
    patchPath,
    JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }),
  );
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

function writePlan(dir: string, workUnitTitle: string) {
  const planPath = join(dir, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      milestones: [{ clientKey: "m1", title: "Foundation", objective: "o" }],
      workUnits: [
        {
          clientKey: "wu1",
          milestoneClientKey: "m1",
          title: workUnitTitle,
          objective: "Implement it.",
          scope: ["Implement the unit"],
          outOfScope: ["Nothing else"],
          acceptanceCriteria: ["Works"],
          agentContextRefs: [],
          suggestedFiles: ["src/"],
          validationCommands: ["pnpm test"],
        },
      ],
      dependencies: [],
    }),
  );
  return planPath;
}

describe("agent packet integration skill hints (M10 §12)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("includes a Relevant Skills section when the work unit touches a detected integration", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
    );
    const planPath = writePlan(dir, "Wire up Supabase row-level security policies");
    const planResult = runPlan(contextFor(dir), { fromFile: planPath });
    expect(planResult.exitCode).toBe(ExitCode.Success);

    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const packet = (nextResult.data as { packet: string }).packet;
    expect(packet).toContain("## Relevant Skills");
    expect(packet).toContain("Supabase agent skills may help with migrations, RLS, Storage, and local validation.");
    expect(packet).toContain("Install command: npx skills add supabase/agent-skills");
    expect(packet).toContain("Priority:");
    expect(packet).toContain("1. AIQT packet scope and out-of-scope");
  });

  it("omits the Relevant Skills section when no detected integration is touched", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const planPath = writePlan(dir, "Implement the checkout flow");
    const planResult = runPlan(contextFor(dir), { fromFile: planPath });
    expect(planResult.exitCode).toBe(ExitCode.Success);

    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const packet = (nextResult.data as { packet: string }).packet;
    expect(packet).not.toContain("## Relevant Skills");
  });

  it("omits the Relevant Skills section when an integration is detected but the work unit's own text does not touch it", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
    );
    const planPath = writePlan(dir, "Implement the checkout flow");
    const planResult = runPlan(contextFor(dir), { fromFile: planPath });
    expect(planResult.exitCode).toBe(ExitCode.Success);

    const nextResult = runNext(contextFor(dir));
    expect(nextResult.exitCode).toBe(ExitCode.Success);
    const packet = (nextResult.data as { packet: string }).packet;
    expect(packet).not.toContain("## Relevant Skills");
  });
});
