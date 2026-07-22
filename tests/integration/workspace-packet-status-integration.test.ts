import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

function seedWorkUnit(dir: string, mode: "isolated" | "none"): void {
  const statePath = join(dir, ".aiqt", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.workGraph.workUnits.push({
    id: "WU001",
    milestoneId: "M001",
    title: "T",
    objective: "O",
    scope: ["s"],
    outOfScope: ["o"],
    acceptanceCriteria: ["a"],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: ["true"],
    status: "ready",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
    executionMetadata: {
      workspaceAssignment:
        mode === "none" ? { mode: "none", access: "read_only" } : { mode: "isolated", assignmentKey: "wu-1", access: "read_write" },
      parallelPolicy: { mode: "serialized", resourceClaims: [] },
    },
  });
  state.workGraph.milestones.push({ id: "M001", title: "M", objective: "O", status: "ready", workUnitIds: ["WU001"] });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("M25-WU07: handoff packet and status --parallel integration", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("aiqt next's packet includes 'Managed Workspace' with workspacePrepared: false and a stable prepare instruction for an unprepared isolated work unit", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir, "isolated");

    const res = runCli(["next", "--json"], dir);
    expect(res.status).toBe(0);
    const packet = JSON.parse(res.stdout).data.packet as string;
    expect(packet).toContain("## Managed Workspace");
    expect(packet).toContain("workspacePrepared: false");
    expect(packet).toContain("aiqt workspace prepare");
  });

  it("aiqt next's packet states no repository workspace is required for a mode:'none' work unit", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir, "none");

    const res = runCli(["next", "--json"], dir);
    expect(res.status).toBe(0);
    const packet = JSON.parse(res.stdout).data.packet as string;
    expect(packet).toContain("## Managed Workspace");
    expect(packet).toContain("No repository workspace is required");
  });

  it("aiqt status --parallel --json includes bounded workspaceReadiness facts", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir, "isolated");

    const res = runCli(["status", "--parallel", "--json"], dir);
    expect(res.status).toBe(0);
    const data = JSON.parse(res.stdout).data;
    expect(data.parallelStatus.workspaceReadiness).toEqual({
      prepared: 0,
      unprepared: 1,
      recoveryRequired: 0,
      dirty: 0,
      drifted: 0,
    });
  });

  it("aiqt status --parallel (human mode) includes the Workspace readiness section", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir, "isolated");

    const res = runCli(["status", "--parallel"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Workspace readiness");
    expect(res.stdout).toContain("unprepared: 1");
  });
});
