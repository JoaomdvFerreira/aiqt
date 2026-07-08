import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt init", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("creates only the canonical files", () => {
    dir = makeTempDir();
    const result = runInit(contextFor(dir), normalizeInitOptions({}));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");

    const aiqt = join(dir, ".aiqt");
    expect(readdirSync(aiqt).sort()).toEqual([
      "exports",
      "project.json",
      "runlog.jsonl",
      "state.json",
    ]);
    // No stray markdown or extra files.
    const rootEntries = readdirSync(dir);
    expect(rootEntries).toEqual([".aiqt"]);
    for (const forbidden of [
      "AIQT.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs",
      ".milestones",
      ".tasks",
    ]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
    expect(existsSync(join(aiqt, "session.json"))).toBe(false);
  });

  it("returns a valid CommandResult shape for --json", () => {
    dir = makeTempDir();
    const result = runInit(contextFor(dir, true), normalizeInitOptions({}));
    expect(result).toMatchObject({
      status: "passed",
      action: "init",
      projectStatus: "draft",
      requiresHumanInput: false,
      nextRecommendedCommand: "aiqt update",
      exitCode: 0,
    });
    expect(Array.isArray(result.changedFiles)).toBe(true);
  });

  it("stores objective, targetUsers, and preferredAgent from flags", () => {
    dir = makeTempDir();
    runInit(
      contextFor(dir),
      normalizeInitOptions({
        objective: "Build a thing",
        targetUser: "developers",
        agent: "claude-code",
      }),
    );
    const project = JSON.parse(
      readFileSync(join(dir, ".aiqt", "project.json"), "utf8"),
    );
    expect(project.project.objective).toBe("Build a thing");
    expect(project.project.targetUsers).toEqual(["developers"]);
    expect(project.project.preferredAgent).toBe("claude-code");
  });

  it("leaves flag-derived fields empty/null when flags are omitted", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const project = JSON.parse(
      readFileSync(join(dir, ".aiqt", "project.json"), "utf8"),
    );
    expect(project.project.objective).toBe("");
    expect(project.project.targetUsers).toEqual([]);
    expect(project.project.preferredAgent).toBeNull();
  });

  it("blocks with exit code 3 if .aiqt/ already exists", () => {
    dir = makeTempDir();
    const first = runInit(contextFor(dir), normalizeInitOptions({}));
    expect(first.exitCode).toBe(ExitCode.Success);

    const second = runInit(contextFor(dir), normalizeInitOptions({}));
    expect(second.exitCode).toBe(ExitCode.InvalidInput);
    expect(second.status).toBe("failed");
    expect(second.blockingIssues.length).toBeGreaterThan(0);
  });

  it("writes a valid project.initialized runlog event", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const raw = readFileSync(
      join(dir, ".aiqt", "runlog.jsonl"),
      "utf8",
    ).trim();
    const lines = raw.split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(RunlogEventSchema.safeParse(event).success).toBe(true);
    expect(event.type).toBe("project.initialized");
    expect(event.actor).toBe("aiqt");
  });

  it("derives the project name from the folder", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const project = JSON.parse(
      readFileSync(join(dir, ".aiqt", "project.json"), "utf8"),
    );
    expect(project.project.name).toBe(dir.split(/[\\/]/).pop());
  });
});
