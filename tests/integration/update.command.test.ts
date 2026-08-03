import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import * as runlogStore from "../../src/state/runlog-store.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "update-input");

const PROMPT_SHAPE_PATCH = {
  project: {
    objective: "Create a local CLI that manages AI-agent implementation workflow state.",
    targetUsers: ["Human project owner using Claude Code"],
    preferredAgent: "claude-code",
    existingRepositoryPath: ".",
  },
  context: {
    constraints: [
      "Local files are the source of truth",
      "No markdown files are created by default",
    ],
    nonGoals: ["No SaaS backend in MVP", "No autonomous code execution in MVP"],
    technologyPreferences: ["Node.js", "TypeScript", "pnpm", "Vitest"],
    businessRules: ["Human-readable exports are generated only on request"],
    architectureNotes: [
      "project.json stores durable context",
      "state.json stores workflow position and work graph",
    ],
  },
  requirements: [
    {
      title: "Capture project context",
      description: "The update command stores durable project context in project.json.",
      priority: "critical",
      type: "functional",
      acceptanceCriteria: [
        "aiqt update --from-file updates project.json",
        "aiqt update --json returns a deterministic CommandResult",
      ],
      status: "accepted",
    },
  ],
  decisions: [
    {
      decision: "Use aiqt update as the single context mutation command.",
      reason: "Avoids a large command surface with add-requirement/add-decision commands.",
      impact: "Granular actions are handled internally by the update service.",
      status: "decided",
    },
  ],
  assumptions: [
    {
      statement: "The implementation agent runs outside AIQT for MVP.",
      reason: "Deep provider integration is deferred.",
      source: "human",
      status: "active",
    },
  ],
  risks: [
    {
      title: "Overbuilding the planning engine too early",
      description: "M2 could accidentally drift into plan generation.",
      severity: "medium",
      mitigation: "Keep workGraph empty and defer aiqt plan.",
      status: "open",
    },
  ],
  openQuestions: [
    {
      question: "Which planning heuristic should M3 use first?",
      impact: "medium",
      status: "open",
      answer: null,
    },
  ],
  quality: {
    preferredValidationCommands: ["pnpm validate"],
  },
};

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

function recordCounts(project: {
  requirements: unknown[];
  decisions: unknown[];
  assumptions: unknown[];
  risks: unknown[];
  openQuestions: unknown[];
}) {
  return {
    requirements: project.requirements.length,
    decisions: project.decisions.length,
    assumptions: project.assumptions.length,
    risks: project.risks.length,
    openQuestions: project.openQuestions.length,
  };
}

describe("aiqt update", () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("updates project.json objective via --objective", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), { objective: "New objective" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.objective).toBe("New objective");
  });

  it("appends and dedupes target users via repeated --target-user", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { targetUser: ["alice"] });
    const result = await runUpdate(contextFor(dir), { targetUser: ["alice", "bob"] });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(readProject(dir).project.targetUsers).toEqual(["alice", "bob"]);
  });

  it("maps --repository-path to existingRepositoryPath", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { repositoryPath: "." });
    expect(readProject(dir).project.existingRepositoryPath).toBe(".");
  });

  it("ingests a valid --from-file patch, creating records without prompts", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), {
      fromFile: join(FIXTURES, "valid-full.json"),
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const project = readProject(dir);
    expect(project.requirements).toHaveLength(1);
    expect(project.decisions).toHaveLength(1);
    expect(project.assumptions).toHaveLength(1);
    expect(project.risks).toHaveLength(1);
    expect(project.openQuestions).toHaveLength(1);
    expect(readState(dir).nextRecommendedCommand).toBe("aiqt plan");
  });

  it("is a no-op on the second run of the same clientKey patch", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const patchPath = join(FIXTURES, "idempotent-client-key.json");
    const first = await runUpdate(contextFor(dir), { fromFile: patchPath });
    expect((first.data as Record<string, unknown>).noOp).toBe(false);

    const decisionCountAfterFirst = readProject(dir).decisions.length;
    const second = await runUpdate(contextFor(dir), { fromFile: patchPath });
    expect(second.exitCode).toBe(ExitCode.Success);
    expect((second.data as Record<string, unknown>).noOp).toBe(true);
    expect(readProject(dir).decisions).toHaveLength(decisionCountAfterFirst);
  });

  it("is a no-op on repeated prompt-shaped input without record ids or clientKeys", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const patchPath = join(dir, "prompt-shape-update.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(patchPath, JSON.stringify(PROMPT_SHAPE_PATCH, null, 2));

    const first = await runUpdate(contextFor(dir), { fromFile: patchPath });
    expect(first.exitCode).toBe(ExitCode.Success);
    expect((first.data as Record<string, unknown>).noOp).toBe(false);
    const projectAfterFirst = readProject(dir);
    const countsAfterFirst = recordCounts(projectAfterFirst);
    const runlogAfterFirst = readRunlogLines(dir) as Array<{ type: string }>;

    const second = await runUpdate(contextFor(dir), { fromFile: patchPath });

    expect(second.exitCode).toBe(ExitCode.Success);
    expect((second.data as Record<string, unknown>).noOp).toBe(true);
    expect(recordCounts(readProject(dir))).toEqual(countsAfterFirst);
    expect(readRunlogLines(dir)).toHaveLength(runlogAfterFirst.length);
    expect(runlogAfterFirst.filter((e) => e.type === "decision.recorded")).toHaveLength(1);
  });

  it("has direct flags win over --from-file for the objective", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), {
      fromFile: join(FIXTURES, "valid-minimal.json"),
      objective: "Flag wins",
    });
    expect(readProject(dir).project.objective).toBe("Flag wins");
  });

  it("appends a valid project.updated event on successful mutation", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "X" });
    const lines = readRunlogLines(dir);
    const updated = lines.find(
      (e) => (e as { type: string }).type === "project.updated",
    );
    expect(updated).toBeDefined();
    expect(RunlogEventSchema.safeParse(updated).success).toBe(true);
  });

  it("appends one decision.recorded event per newly created decision", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { fromFile: join(FIXTURES, "valid-full.json") });
    const lines = readRunlogLines(dir) as Array<{ type: string }>;
    const decisionEvents = lines.filter((e) => e.type === "decision.recorded");
    expect(decisionEvents).toHaveLength(1);
  });

  it("does not append decision.recorded when an existing decision is updated", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const patchPath = join(FIXTURES, "idempotent-client-key.json");
    await runUpdate(contextFor(dir), { fromFile: patchPath });

    // Modify the fixture-driven decision via a fresh patch with the same clientKey.
    const secondPatch = {
      decisions: [
        {
          clientKey: "decision-idempotent-test",
          decision: "Updated decision text",
        },
      ],
    };
    const tmpPatchPath = join(dir, "second-patch.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tmpPatchPath, JSON.stringify(secondPatch));

    const before = readRunlogLines(dir).length;
    await runUpdate(contextFor(dir), { fromFile: tmpPatchPath });
    const after = readRunlogLines(dir) as Array<{ type: string }>;
    const decisionEvents = after.filter((e) => e.type === "decision.recorded");
    expect(decisionEvents).toHaveLength(1); // only from the first (create) run
    expect(after.length).toBeGreaterThan(before); // project.updated was still appended
  });

  it("does not write files or append runlog on a true no-op update", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { objective: "Same objective" });
    const before = readRunlogLines(dir).length;

    // Re-applying the identical, already-set objective is a genuine no-op.
    const result = await runUpdate(contextFor(dir), { objective: "Same objective" });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect((result.data as Record<string, unknown>).noOp).toBe(true);
    expect(readRunlogLines(dir).length).toBe(before);
  });

  it("surfaces a runlog-gap diagnostic after state is written and retry does not duplicate records", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const patchPath = join(dir, "prompt-shape-update.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(patchPath, JSON.stringify(PROMPT_SHAPE_PATCH, null, 2));
    const runlogBefore = readRunlogLines(dir).length;
    const spy = vi.spyOn(runlogStore, "appendRunlogEvent").mockImplementationOnce(() => {
      throw new Error("simulated append failure");
    });

    const failed = await runUpdate(contextFor(dir), { fromFile: patchPath });
    spy.mockRestore();

    expect(failed.exitCode).toBe(ExitCode.InvalidInput);
    expect(failed.status).toBe("failed");
    expect(failed.summary).toContain("runlog append failed");
    const afterFailure = readProject(dir);
    expect(recordCounts(afterFailure)).toEqual({
      requirements: 1,
      decisions: 1,
      assumptions: 1,
      risks: 1,
      openQuestions: 1,
    });
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);

    const retry = await runUpdate(contextFor(dir), { fromFile: patchPath });

    expect(retry.exitCode).toBe(ExitCode.Success);
    expect((retry.data as Record<string, unknown>).noOp).toBe(true);
    expect(recordCounts(readProject(dir))).toEqual(recordCounts(afterFailure));
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("returns requiresHumanInput and exit code 10 with no flags in non-TTY", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readRunlogLines(dir).length;
    const result = await runUpdate(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
    expect(result.requiresHumanInput).toBe(true);
    expect(readRunlogLines(dir).length).toBe(before);
  });

  it("leaves workGraph unchanged after update", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readState(dir).workGraph;
    await runUpdate(contextFor(dir), { fromFile: join(FIXTURES, "valid-full.json") });
    expect(readState(dir).workGraph).toEqual(before);
  });

  it("creates no markdown files", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    await runUpdate(contextFor(dir), { fromFile: join(FIXTURES, "valid-full.json") });
    for (const forbidden of ["AIQT.md", "AGENTS.md", "CLAUDE.md", "docs"]) {
      expect(existsSync(join(dir, forbidden))).toBe(false);
    }
  });

  it("rejects an invalid-schema --from-file with exit code 3 and no mutation", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readProject(dir);
    const result = await runUpdate(contextFor(dir), {
      fromFile: join(FIXTURES, "invalid-schema.json"),
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    expect(readProject(dir)).toEqual(before);
  });

  it("rejects an unknown record id with exit code 3 and no mutation", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const patchPath = join(dir, "unknown-id-patch.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      patchPath,
      JSON.stringify({ requirements: [{ id: "REQ-999", status: "accepted" }] }),
    );
    const before = readProject(dir);
    const result = await runUpdate(contextFor(dir), { fromFile: patchPath });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(readProject(dir)).toEqual(before);
  });

  it("fails with exit code 3 when --from-file path does not exist", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = await runUpdate(contextFor(dir), {
      fromFile: join(dir, "does-not-exist.json"),
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("fails with exit code 3 when .aiqt/ is missing", async () => {
    dir = makeTempDir();
    const result = await runUpdate(contextFor(dir), { objective: "X" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });
});
