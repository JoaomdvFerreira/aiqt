import { describe, it, expect, afterEach } from "vitest";
import { runStatus } from "../../src/cli/commands/status.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { removeDir, contextFor, copyFixture } from "../helpers.js";

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
});
