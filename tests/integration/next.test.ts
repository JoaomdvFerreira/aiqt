import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

describe("aiqt next", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("recommends aiqt update after a plain init", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt update");
  });

  it("still recommends aiqt update when only the objective is set (no target users)", () => {
    // Under the Milestone 2 planning-readiness rule, an objective alone is
    // not sufficient context: at least one target user and one structural
    // item (requirement/constraint/tech-preference/business-rule/
    // architecture-note) are also required. See planning-readiness.ts and
    // tests/integration/update-next-flow.test.ts for the full "ready" path.
    dir = makeTempDir();
    runInit(
      contextFor(dir),
      normalizeInitOptions({ objective: "Ship it" }),
    );
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.nextRecommendedCommand).toBe("aiqt update");
  });

  it("blocks and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.status).toBe("blocked");
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("does not mutate state", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runNext(contextFor(dir));
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });
});
