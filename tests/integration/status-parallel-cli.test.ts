import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// M34-WU02: this file spawns real subprocesses (CLI and/or git); see
// docs/engineering/m34-validation-workload-policy.md Sec 6.1 for the
// measured justification. Uses the shared class constant, not a locally
// hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

function seedTwoWorkUnits(dir: string, secondHasMetadata: boolean): void {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.workGraph.workUnits.push({
    id: "WU001",
    milestoneId: "M001",
    title: "T1",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
    executionMetadata: {
      workspaceAssignment: { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
      parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
    },
  });
  state.workGraph.workUnits.push({
    id: "WU002",
    milestoneId: "M001",
    title: "T2",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
    ...(secondHasMetadata
      ? {
          executionMetadata: {
            workspaceAssignment: { mode: "isolated", assignmentKey: "wu-2", access: "read_write" },
            parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
          },
        }
      : {}),
  });
  state.workGraph.milestones.push({
    id: "M001",
    title: "M",
    objective: "O",
    status: "ready",
    workUnitIds: ["WU001", "WU002"],
  });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("aiqt status --parallel (M24-WU06)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("does not add a parallelStatus key to plain `aiqt status --json`", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, true);
    const res = runCli(["status", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.parallelStatus).toBeUndefined();
  });

  it("plain `aiqt status` output is unaffected by the new flag existing", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const withoutFlag = runCli(["status"], dir);
    expect(withoutFlag.status).toBe(0);
    expect(withoutFlag.stdout).toContain("AIQT status: passed");
  });

  it("--parallel --json reports the full parallelStatus envelope with exit 0", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, true);
    const res = runCli(["status", "--parallel", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.parallelStatus.advisory).toBe(true);
    expect(parsed.data.parallelStatus.readyWorkUnitIds.sort()).toEqual(["WU001", "WU002"]);
    expect(parsed.data.parallelStatus.recommendedBatch.length).toBeGreaterThan(0);
    expect(parsed.data.parallelStatus.metadataCoverage).toEqual({ complete: 2, missing: 0, invalid: 0 });
  });

  it("--parallel (human mode) includes every required section and the advisory disclaimer", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, true);
    const res = runCli(["status", "--parallel"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Parallel execution advisory");
    expect(res.stdout).toContain("Active Work Units");
    expect(res.stdout).toContain("Recommended batch");
    expect(res.stdout).toContain("Manual review");
    expect(res.stdout).toContain("Excluded Work Units and reasons");
    expect(res.stdout).toContain("Advisory only -- no workspace was created and no Work Unit was started.");
  });

  it("reports missing metadata coverage without failing, when a work unit has no executionMetadata", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, false);
    const res = runCli(["status", "--parallel", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.parallelStatus.metadataCoverage.missing).toBe(1);
  });

  it("reports an empty advisory (exit 0) when there are no ready work units", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["status", "--parallel", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.parallelStatus.readyWorkUnitIds).toEqual([]);
    expect(parsed.data.parallelStatus.recommendedBatch).toEqual([]);
  });

  it("exits 3 for a broken dependency reference", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, true);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.workGraph.dependencies.push({ id: "DEP-001", fromId: "WU001", toId: "WU-DOES-NOT-EXIST", type: "blocks", reason: null });
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    const res = runCli(["status", "--parallel", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 for structurally invalid execution metadata in canonical state (hand-edited, bypassing the schema)", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, true);
    const statePath = join(dir, ".aiqt", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.workGraph.workUnits[0].executionMetadata = {
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: {
        mode: "serialized",
        resourceClaims: [{ domain: "repository", key: "project", access: "exclusive" }],
      },
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    const res = runCli(["status", "--parallel", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("performs zero state/runlog mutation", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedTwoWorkUnits(dir, true);
    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");
    expect(runCli(["status", "--parallel", "--json"], dir).status).toBe(0);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
  });
});
