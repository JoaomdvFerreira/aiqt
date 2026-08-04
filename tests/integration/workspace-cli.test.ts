import { describe, it, expect, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { spawnSync, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";

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

function initGitRepo(dir: string): void {
  initGitFixtureRepo(dir);
}

function commitAiqtState(dir: string, message = "aiqt state"): void {
  execFileSync("git", ["add", ".aiqt"], { cwd: dir });
  execFileSync("git", ["commit", "--quiet", "-m", message], { cwd: dir });
}

function seedWorkUnit(dir: string, overrides: { id: string; mode: "isolated" | "shared" | "none"; assignmentKey?: string; status?: string }): void {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const workspaceAssignment: Record<string, unknown> =
    overrides.mode === "none"
      ? { mode: "none", access: "read_only" }
      : { mode: overrides.mode, assignmentKey: overrides.assignmentKey ?? "wu-key", access: "read_write" };
  state.workGraph.workUnits.push({
    id: overrides.id,
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["true"],
    status: overrides.status ?? "ready",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
    executionMetadata: {
      workspaceAssignment,
      parallelPolicy: { mode: "eligible_if_no_conflict", resourceClaims: [] },
    },
  });
  state.workGraph.milestones.push({
    id: "M001",
    title: "M",
    objective: "O",
    status: "ready",
    workUnitIds: [overrides.id],
  });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("aiqt workspace (M25-WU06)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("is listed under --help", () => {
    dir = makeTempDir();
    const res = runCli(["--help"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("workspace");
  });

  it("status exits 0 on a bare project with no managed workspaces", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["workspace", "status", "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.totalWorkspaces).toBe(0);
  });

  it("prepare requires an explicit work-unit id (missing argument is a commander parse error)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["workspace", "prepare"], dir);
    expect(res.status).not.toBe(0);
  });

  it("prepare exits 3 for an unknown work unit id", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["workspace", "prepare", "WU999", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("prepare exits 3 for a work unit whose mode is 'none'", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "none" });
    const res = runCli(["workspace", "prepare", "WU001", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("prepare exits 3 for a work unit with a prohibited status (planned)", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "isolated", status: "planned" });
    const res = runCli(["workspace", "prepare", "WU001", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("isolated: preview reports the plan with exit 0 and creates nothing", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "isolated", assignmentKey: "wu-1" });
    commitAiqtState(dir);

    const res = runCli(["workspace", "prepare", "WU001", "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.outcome).toBe("would_create");
    expect(existsSync(data.workspacePath)).toBe(false);

    const statusAfter = JSON.parse(runCli(["workspace", "status", "--json"], dir).stdout);
    expect(statusAfter.data.totalWorkspaces).toBe(0);
  });

  it("isolated: full lifecycle -- prepare, status, release, idempotent recover preview", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "isolated", assignmentKey: "wu-1" });
    commitAiqtState(dir);

    const prepareRes = runCli(["workspace", "prepare", "WU001", "--json"], dir);
    expect(prepareRes.status).toBe(0);
    const prepareData = JSON.parse(prepareRes.stdout).data;
    expect(prepareData.outcome).toBe("created");
    expect(existsSync(prepareData.workspacePath)).toBe(true);
    commitAiqtState(dir, "state after prepare");

    const statusRes = runCli(["workspace", "status", "--work-unit", "WU001", "--json"], dir);
    expect(statusRes.status).toBe(0);
    const statusData = JSON.parse(statusRes.stdout).data;
    expect(statusData.prepared).toBe(true);
    expect(statusData.inspection.clean).toBe(true);

    const releaseRes = runCli(["workspace", "release", "WU001", "--json"], dir);
    expect(releaseRes.status).toBe(0);
    expect(JSON.parse(releaseRes.stdout).data.outcome).toBe("released");
    expect(existsSync(prepareData.workspacePath)).toBe(false);

    // Branch survives release.
    const branches = execFileSync("git", ["branch", "--list", prepareData.branchName], { cwd: dir, encoding: "utf8" });
    expect(branches).toContain(prepareData.branchName.split("/").pop());

    const recoverRes = runCli(["workspace", "recover", "--json"], dir);
    expect(recoverRes.status).toBe(0);
    expect(JSON.parse(recoverRes.stdout).data.items).toEqual([]);
  });

  it("isolated: apply blocks with exit 2 when the repository is dirty", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "isolated", assignmentKey: "wu-1" });
    commitAiqtState(dir);
    writeFileSync(join(dir, "dirty.txt"), "uncommitted\n");

    const res = runCli(["workspace", "prepare", "WU001", "--json"], dir);
    expect(res.status).toBe(2);
  });

  it("release is a no-op (exit 0) for a work unit with no active binding", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "isolated", assignmentKey: "wu-1" });
    commitAiqtState(dir);

    const res = runCli(["workspace", "release", "WU001", "--json"], dir);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).data.outcome).toBe("no_op");
  });

  it("shared: prepare resolves to the implementation root itself, with no directory or branch created", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedWorkUnit(dir, { id: "WU001", mode: "shared", assignmentKey: "team-a" });
    commitAiqtState(dir);

    const res = runCli(["workspace", "prepare", "WU001", "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.providerId).toBe("shared-repository@1");
    expect(data.workspacePath).toBe(dir);

    const branches = execFileSync("git", ["branch", "--list"], { cwd: dir, encoding: "utf8" });
    expect(branches.trim()).toBe("* main");
  });

  it("recover --apply exits 0 with nothing pending", () => {
    dir = makeTempDir();
    initGitRepo(dir);
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const res = runCli(["workspace", "recover", "--apply", "--json"], dir);
    expect(res.status).toBe(0);
  });
});
