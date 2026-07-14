import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runExport } from "../../src/cli/commands/export.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

function readProject(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "project.json"), "utf8"));
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

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

async function makeInProgressProject(dir: string, planFixture = "valid-plan.json") {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, planFixture)));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

describe("aiqt export", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runExport(contextFor(dir), { target: "project-plan" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("returns needs_input and exit code 10 when no target is supplied", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runExport(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
    expect(result.status).toBe("needs_input");
    expect(result.requiresHumanInput).toBe(true);
  });

  it("fails with exit code 3 on an unsupported target", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runExport(contextFor(dir), { target: "project-summary" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBeNull();
  });

  it("fails with exit code 3 on an unsupported format", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runExport(contextFor(dir), { target: "project-plan", format: "pdf" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBeNull();
  });

  it("dry-run writes no files and appends no runlog event", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const beforeRunlogLength = readRunlogLines(dir).length;
    const result = runExport(contextFor(dir), { target: "project-plan", dryRun: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.changedFiles).toEqual([]);
    expect(existsSync(join(dir, ".aiqt", "exports", "project-plan.md"))).toBe(false);
    expect(readRunlogLines(dir)).toHaveLength(beforeRunlogLength);
  });

  it("writes project-plan.md and appends exactly one export.generated event", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const beforeRunlogLength = readRunlogLines(dir).length;
    const result = runExport(contextFor(dir), { target: "project-plan" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.changedFiles).toEqual([".aiqt/exports/project-plan.md"]);
    expect(existsSync(join(dir, ".aiqt", "exports", "project-plan.md"))).toBe(true);
    const content = readFileSync(join(dir, ".aiqt", "exports", "project-plan.md"), "utf8");
    expect(content).toContain("# AIQT Project Plan");

    const lines = readRunlogLines(dir) as Array<{ type: string }>;
    expect(lines).toHaveLength(beforeRunlogLength + 1);
    const exportEvents = lines.filter((e) => e.type === "export.generated");
    expect(exportEvents).toHaveLength(1);
  });

  it("never mutates project.json or state.json on a successful export", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const beforeProject = readProject(dir);
    const beforeState = readState(dir);
    runExport(contextFor(dir), { target: "status-report" });
    expect(readProject(dir)).toEqual(beforeProject);
    expect(readState(dir)).toEqual(beforeState);
  });

  it("blocks with exit code 2 when the single requested target (agent-packet) is unavailable", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runExport(contextFor(dir), { target: "agent-packet" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.status).toBe("blocked");
    expect(existsSync(join(dir, ".aiqt", "exports"))).toBeDefined();
  });

  it("writes agent-packet-<packetId>.md once lastAgentPacket exists", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runExport(contextFor(dir), { target: "agent-packet" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const state = readState(dir);
    const expectedFile = `.aiqt/exports/agent-packet-${state.lastAgentPacket.id}.md`;
    expect(result.changedFiles).toEqual([expectedFile]);
  });

  it("export all soft-skips agent-packet when unavailable, with warnings and passing status", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const result = runExport(contextFor(dir), { target: "all" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("warning");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.changedFiles).toEqual(
      expect.arrayContaining([
        ".aiqt/exports/project-plan.md",
        ".aiqt/exports/technical-spec.md",
        ".aiqt/exports/status-report.md",
        ".aiqt/exports/final-review.md",
      ]),
    );
    expect(result.changedFiles.some((f) => f.includes("agent-packet"))).toBe(false);

    const lines = readRunlogLines(dir) as Array<{
      type: string;
      data?: { files?: string[]; skippedTargets?: string[] };
    }>;
    const exportEvent = lines.find((e) => e.type === "export.generated");
    expect(exportEvent).toBeDefined();
    // M9: final-review.md is a 5th always-available target, so export all
    // now writes 4 files when only agent-packet is skipped (was 3 pre-M9).
    expect(exportEvent!.data!.files).toHaveLength(4);
    expect(exportEvent!.data!.skippedTargets).toEqual(["agent-packet"]);
  });

  it("export all after a done checkpoint writes all five targets", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const checkpointResult = runCheckpoint(contextFor(dir), {
      fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json"),
    });
    expect(checkpointResult.exitCode).toBe(ExitCode.Success);
    const result = runExport(contextFor(dir), { target: "all" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    // M9: project-plan, status-report, technical-spec, agent-packet, final-review.
    expect(result.changedFiles).toHaveLength(5);
  });

  it("status-report.md reflects blocking findings from a broken dependency reference", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const state = readState(dir);
    state.workGraph.dependencies.push({
      id: "DEP-999",
      type: "blocks",
      fromId: "WU001",
      toId: "WU999",
      reason: null,
    });
    writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
    const result = runExport(contextFor(dir), { target: "status-report" });
    expect(result.exitCode).toBe(ExitCode.Success);
    const content = readFileSync(join(dir, ".aiqt", "exports", "status-report.md"), "utf8");
    expect(content).toContain("Blocking findings: 1");
  });

  it("creates no files outside .aiqt/exports/", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    runExport(contextFor(dir), { target: "project-plan" });
    for (const forbidden of ["AIQT.md", "AGENTS.md", "CLAUDE.md", "docs", ".milestones", ".tasks"]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
  });

  describe("M9: final-review.md", () => {
    it("aiqt export all generates final-review.md", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      const result = runExport(contextFor(dir), { target: "all" });
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(existsSync(join(dir, ".aiqt", "exports", "final-review.md"))).toBe(true);
    });

    it("includes development completion and production readiness status", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      runExport(contextFor(dir), { target: "all" });
      const content = readFileSync(join(dir, ".aiqt", "exports", "final-review.md"), "utf8");
      expect(content).toContain("## Development Completion Status");
      expect(content).toContain("## Production Readiness Status");
      expect(content).toContain("Development complete: no");
      expect(content).toContain("Production ready: no");
    });

    it("includes release blockers and acknowledged findings sections", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      runExport(contextFor(dir), { target: "all" });
      const content = readFileSync(join(dir, ".aiqt", "exports", "final-review.md"), "utf8");
      expect(content).toContain("## Release Blockers");
      expect(content).toContain("## Acknowledged Findings");
      expect(content).toContain("## User-Action-Required Checklist");
    });

    it("is available even before a work graph exists (like project-plan), generated via aiqt export all", async () => {
      dir = makeTempDir();
      runInit(contextFor(dir), normalizeInitOptions({}));
      const result = runExport(contextFor(dir), { target: "all" });
      expect(result.exitCode).toBe(ExitCode.Success);
      expect(existsSync(join(dir, ".aiqt", "exports", "final-review.md"))).toBe(true);
    });

    it("M10: aiqt export final-review is rejected as an unsupported target", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      const result = runExport(contextFor(dir), { target: "final-review" });
      expect(result.exitCode).toBe(ExitCode.InvalidInput);
      expect(result.status).toBe("failed");
    });
  });

  describe("M9: export quality fixes", () => {
    it("project-plan.md no longer shows a requirement status label", async () => {
      dir = makeTempDir();
      await makeReadyProject(dir);
      const patchPath = join(dir, "req-patch.json");
      writeFileSync(
        patchPath,
        JSON.stringify({
          requirements: [
            {
              title: "Add item",
              description: "Users can add an item",
              priority: "medium",
              type: "functional",
              acceptanceCriteria: ["Works"],
              status: "draft",
            },
          ],
        }),
      );
      await runUpdate(contextFor(dir), { fromFile: patchPath });
      runExport(contextFor(dir), { target: "project-plan" });
      const content = readFileSync(join(dir, ".aiqt", "exports", "project-plan.md"), "utf8");
      expect(content).toContain("Add item - Users can add an item");
      expect(content).not.toContain("(draft)");
    });

    it("agent-packet export clarifies that full packet text is unavailable", async () => {
      dir = makeTempDir();
      await makeInProgressProject(dir);
      runExport(contextFor(dir), { target: "agent-packet" });
      const state = readState(dir);
      const content = readFileSync(
        join(dir, ".aiqt", "exports", `agent-packet-${state.lastAgentPacket.id}.md`),
        "utf8",
      );
      expect(content).toContain("Full packet text is unavailable because it is not stored in canonical state.");
    });
  });
});
