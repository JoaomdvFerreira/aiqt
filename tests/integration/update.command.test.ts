import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { RunlogEventSchema } from "../../src/schema/runlog-event.schema.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "update-input");

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
