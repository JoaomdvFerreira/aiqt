import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runSkillsPlan } from "../../src/cli/commands/skills-plan.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt skills plan", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runSkillsPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("exits 0 with no supported integrations detected in a bare project", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runSkillsPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.action).toBe("skills");
    const data = result.data as { detectedIntegrations: unknown[]; notDetectedIntegrations: string[] };
    expect(data.detectedIntegrations).toEqual([]);
    expect(data.notDetectedIntegrations).toEqual(["supabase", "clerk", "shadcn-ui"]);
  });

  it("matches the required JSON contract shape and deterministic order when integrations are detected", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    mkdirSync(join(dir, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(dir, "middleware.ts"), "clerk middleware\n");
    writeFileSync(join(dir, "components.json"), "{}");
    mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { "@supabase/supabase-js": "^2.0.0", "@clerk/nextjs": "^5.0.0" },
      }),
    );

    const result = runSkillsPlan(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as {
      detectedIntegrations: Array<{ id: string; displayName: string; confidence: string; evidence: string[]; recommendedSkill: unknown }>;
      notDetectedIntegrations: string[];
      safetyNotes: string[];
    };
    expect(data.detectedIntegrations.map((i) => i.id)).toEqual(["supabase", "clerk", "shadcn-ui"]);
    expect(data.notDetectedIntegrations).toEqual([]);
    expect(data.safetyNotes).toHaveLength(3);
    for (const integration of data.detectedIntegrations) {
      expect(integration).toHaveProperty("id");
      expect(integration).toHaveProperty("displayName");
      expect(integration).toHaveProperty("confidence");
      expect(Array.isArray(integration.evidence)).toBe(true);
      expect(integration.recommendedSkill).toHaveProperty("installCommand");
      expect(integration.recommendedSkill).toHaveProperty("installAutomatically", false);
    }
  });

  it("is deterministic for the same repository state", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
    );
    const first = runSkillsPlan(contextFor(dir));
    const second = runSkillsPlan(contextFor(dir));
    expect(JSON.stringify(first.data)).toBe(JSON.stringify(second.data));
  });

  it("does not mutate state.json, project.json, or runlog.jsonl", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "^2.0.0" } }),
    );
    const stateBefore = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const projectBefore = readFileSync(join(dir, ".aiqt", "project.json"), "utf8");
    const runlogBefore = readRunlogLines(dir).length;

    runSkillsPlan(contextFor(dir));

    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(stateBefore);
    expect(readFileSync(join(dir, ".aiqt", "project.json"), "utf8")).toBe(projectBefore);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("does not write any files under .aiqt/exports/", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    runSkillsPlan(contextFor(dir));
    // init creates .aiqt/exports/ but writes no files into it; skills plan
    // (read-only) must not either.
    const exportsDir = join(dir, ".aiqt", "exports");
    expect(existsSync(exportsDir)).toBe(true);
    expect(readdirSync(exportsDir)).toHaveLength(0);
  });
});
