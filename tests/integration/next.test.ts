import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

// As of M4, aiqt next is the full agent handoff packet engine, not a
// recommendation-only reporter. See tests/integration/next-packet.command.test.ts
// for the packet-generation success path and gate/precondition coverage.
describe("aiqt next (preconditions)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("blocks with exit code 2 and recommends aiqt update after a plain init", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.status).toBe("blocked");
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
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt update");
  });

  it("fails with exit code 3 and recommends aiqt init when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runNext(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.status).toBe("failed");
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("does not mutate state when blocked (empty work graph)", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    runNext(contextFor(dir));
    const after = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    expect(after).toBe(before);
  });

  it("M32: blocks unsafe mutation when currentWorkUnitId is dangling", async () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({ objective: "Ship it", targetUser: "devs" }));
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.workGraph.milestones = [
      { id: "M001", title: "Milestone", objective: "Do it", status: "ready", workUnitIds: ["WU001"] },
    ];
    state.workGraph.workUnits = [
      {
        id: "WU001",
        milestoneId: "M001",
        title: "Work",
        objective: "Do it",
        scope: ["s"],
        outOfScope: [],
        acceptanceCriteria: ["a"],
        agentContextRefs: [],
        suggestedFiles: [],
        validationCommands: ["pnpm test"],
        status: "ready",
        dependencies: [],
        createdAt: state.lastUpdatedAt,
        updatedAt: state.lastUpdatedAt,
      },
    ];
    state.currentWorkUnitId = "WU999";
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const before = readFileSync(statePath, "utf8");
    const result = runNext(contextFor(dir));

    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
    expect(result.nextRecommendedCommand).toBe("aiqt graph repair --apply");
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });
});
