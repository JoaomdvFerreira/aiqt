import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runManage } from "../../src/cli/commands/manage.command.js";
import { runReviewAcknowledge } from "../../src/cli/commands/review-acknowledge.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { buildDogfoodTerminalState, DOGFOOD_ACKNOWLEDGE_KEY } from "../dogfood-fixture.js";

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

function readRunlogLines(dir: string): unknown[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

describe("aiqt manage", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("fails with exit code 3 when .aiqt/ is missing", () => {
    dir = makeTempDir();
    const result = runManage(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
    expect(result.nextRecommendedCommand).toBe("aiqt init");
  });

  it("succeeds with exit code 0 on a bare initialized project", () => {
    dir = makeTempDir();
    runInit(contextFor(dir), normalizeInitOptions({}));
    const result = runManage(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.action).toBe("manage");
    const data = result.data as {
      projectStatus: string;
      developmentComplete: boolean;
      productionReady: boolean;
      counts: Record<string, number>;
      activeFindings: unknown[];
      acknowledgedFindings: unknown[];
      userActionRequired: unknown[];
      externalVerificationGaps: unknown[];
      agentFixableIssues: unknown[];
    };
    expect(data.developmentComplete).toBe(false);
    expect(data.productionReady).toBe(false);
    expect(Array.isArray(data.activeFindings)).toBe(true);
    expect(Array.isArray(data.acknowledgedFindings)).toBe(true);
    expect(Array.isArray(data.userActionRequired)).toBe(true);
    expect(Array.isArray(data.externalVerificationGaps)).toBe(true);
    expect(Array.isArray(data.agentFixableIssues)).toBe(true);
  });

  it("is deterministic for the same state", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const first = runManage(contextFor(dir));
    const second = runManage(contextFor(dir));
    expect(JSON.stringify(first.data)).toBe(JSON.stringify(second.data));
  });

  it("never mutates state.json or appends runlog events", async () => {
    dir = makeTempDir();
    await makeReadyProject(dir);
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const runlogBefore = readRunlogLines(dir).length;
    runManage(contextFor(dir));
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readRunlogLines(dir)).toHaveLength(runlogBefore);
  });

  it("reports developmentComplete=true and productionReady=false for the acknowledged dogfood terminal state", async () => {
    dir = makeTempDir();
    await buildDogfoodTerminalState(dir);

    const ackResult = runReviewAcknowledge(contextFor(dir), {
      findingKey: DOGFOOD_ACKNOWLEDGE_KEY,
      reason: "Live Clerk verification requires user-owned setup and is accepted as a development-complete limitation.",
    });
    expect(ackResult.exitCode).toBe(ExitCode.Success);

    const result = runManage(contextFor(dir));
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { developmentComplete: boolean; productionReady: boolean; recommendedCommand: string };
    expect(data.developmentComplete).toBe(true);
    expect(data.productionReady).toBe(false);
    // M10 §10.1: release blockers exist -> "aiqt manage", not a direct
    // "aiqt review --mode release" that would just repeat the same blocker.
    expect(data.recommendedCommand).toBe("aiqt manage");
  });
});
