import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runSkillsPlan } from "../../src/cli/commands/skills-plan.command.js";
import { renderSkillsPlanText } from "../../src/services/skills-plan-template.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt skills plan: M13 designAids extension", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("adds designAids as an additive sibling field alongside detectedIntegrations for a UI-heavy project", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      objective: "Build a Next.js and React marketplace with a booking flow using shadcn/ui and Tailwind.",
      targetUser: ["Client"],
    });
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
    );

    const result = runSkillsPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as {
      detectedIntegrations: Array<{ id: string }>;
      notDetectedIntegrations: string[];
      designAids: Array<{ id: string; phase: string; installAutomatically: boolean }>;
      safetyNotes: string[];
    };

    // M10 detection (including the objective's own shadcn/ui mention) is
    // completely unaffected by the M13 extension.
    expect(data.detectedIntegrations.map((i) => i.id)).toEqual(["supabase", "shadcn-ui"]);
    expect(data.notDetectedIntegrations).toEqual(["clerk"]);

    expect(data.designAids.length).toBeGreaterThan(0);
    expect(data.designAids.map((a) => a.id)).toEqual([
      "frontend-design",
      "design-critique",
      "web-design-guidelines",
      "hue",
      "transitions-refine",
    ]);
    for (const aid of data.designAids) {
      expect(aid.installAutomatically).toBe(false);
    }
  });

  it("yields an empty designAids array for a non-UI-heavy project, preserving M10 behavior", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      objective: "A command-line tool that renames files in bulk.",
      targetUser: ["devs"],
    });

    const result = runSkillsPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { designAids: unknown[]; detectedIntegrations: unknown[] };
    expect(data.designAids).toEqual([]);
    expect(data.detectedIntegrations).toEqual([]);
  });

  it("marks design aids as advisory and non-installed in human-readable output", () => {
    const plan = {
      detectedIntegrations: [],
      notDetectedIntegrations: ["supabase", "clerk", "shadcn-ui"] as const,
      designAids: [
        {
          id: "frontend-design" as const,
          phase: "before-ui-implementation",
          recommendedUse: "Use to define visual direction, tokens, layout, and design critique before coding.",
          installAutomatically: false as const,
        },
      ],
      safetyNotes: ["AIQT does not install external skills automatically."],
    };
    const text = renderSkillsPlanText(plan);
    expect(text).toContain("Design Aids (Advisory, Not Installed)");
    expect(text).toContain("Installed automatically: no");
  });

  it("appends no runlog events when designAids are computed", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      objective: "Build a Next.js React dashboard with an onboarding flow.",
      targetUser: ["Client"],
    });
    const runlogBefore = readRunlogLines(dir).length;
    runSkillsPlan(contextFor(dir));
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("is deterministic across repeated calls", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      objective: "Build a Next.js React marketplace with shadcn/ui and a booking flow.",
      targetUser: ["Client"],
    });
    const first = runSkillsPlan(contextFor(dir));
    const second = runSkillsPlan(contextFor(dir));
    expect(JSON.stringify(first.data)).toBe(JSON.stringify(second.data));
  });
});
