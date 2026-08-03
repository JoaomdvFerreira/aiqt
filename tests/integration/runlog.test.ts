import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { readRunlogEventIds } from "../../src/state/runlog-store.js";
import { removeDir, contextFor, copyFixture, makeTempDir } from "../helpers.js";

describe("runlog health", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("warns (not blocks) on a malformed runlog line when project/state are valid", () => {
    dir = copyFixture("malformed-runlog");
    const result = runStatus(contextFor(dir, true));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("warning");
    const runlogWarning = result.warnings.find((w) => w.area === "runlog");
    expect(runlogWarning).toBeDefined();
    expect(runlogWarning?.severity).toBe("medium");
  });

  it("exposes runlogHealth counts under data", () => {
    // Runlog health reporting lives under aiqt status as of M4: aiqt next
    // became the full packet-generation engine and no longer exposes
    // runlogHealth in its data shape (see M4 spec section 15.2).
    dir = copyFixture("malformed-runlog");
    const result = runStatus(contextFor(dir, true));
    const data = result.data as Record<string, unknown>;
    const health = data.runlogHealth as {
      totalLines: number;
      validLines: number;
      malformedLines: number;
      malformedLineNumbers: number[];
    };
    expect(health.totalLines).toBe(3);
    expect(health.validLines).toBe(2);
    expect(health.malformedLines).toBe(1);
    expect(health.malformedLineNumbers).toEqual([3]);
  });

  it("reads the project.initialized event from an initialized project", () => {
    dir = copyFixture("initialized-project");
    const result = runStatus(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("reserves event ids found in malformed final lines so the next id cannot collide", () => {
    dir = makeTempDir();
    const runlogPath = join(dir, "runlog.jsonl");
    writeFileSync(
      runlogPath,
      [
        JSON.stringify({
          id: "EVT-001",
          type: "project.initialized",
          timestamp: "2026-01-01T00:00:00.000Z",
          actor: "aiqt",
          summary: "ok",
          relatedIds: ["PROJECT-001"],
          data: {},
        }),
        '{"id":"EVT-999","type":"checkpoint.created"',
      ].join("\n") + "\n",
    );

    expect(readRunlogEventIds(runlogPath)).toEqual(["EVT-001", "EVT-999"]);
  });
});
