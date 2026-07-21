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

const NOW = "2026-01-01T00:00:00.000Z";

function manualPayload(overrides: Record<string, unknown> = {}) {
  return {
    format: "manual-evidence-json@1",
    source: { providerId: "human-reviewer" },
    binding: { workUnitId: "WU001", packetId: "PKT-001", implementationRootId: "ROOT-1", capturedAt: NOW },
    reviewer: { independentContext: "declared_independent" },
    results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
    ...overrides,
  };
}

/** Injects a single work unit/milestone directly into state.json so evidence import's M22 reference validation succeeds, without running the full plan/update ceremony. */
function seedWorkUnit(dir: string): void {
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
    validationCommands: ["pnpm test"],
    status: "ready",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
  });
  state.workGraph.milestones.push({
    id: "M001",
    title: "M",
    objective: "O",
    status: "ready",
    workUnitIds: ["WU001"],
  });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe("aiqt evidence import (M23-WU07/WU08)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("is listed under --help", () => {
    dir = makeTempDir();
    const res = runCli(["--help"], dir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("evidence");
  });

  it("exits 10 when neither --from-file nor --stdin is given", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const res = runCli(["evidence", "import", "--json"], dir);
    expect(res.status).toBe(10);
  });

  it("exits 3 when both --from-file and --stdin are given", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(manualPayload()));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--stdin", "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 with no .aiqt/ project", () => {
    dir = makeTempDir();
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(manualPayload()));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 for malformed JSON", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, "{not json");
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 for an unsupported format", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify({ format: "bogus@1" }));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 when the payload fails its format's schema", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify({ format: "manual-evidence-json@1" }));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("exits 3 when a referenced work unit does not exist (M22 owner validation reused)", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(manualPayload()));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
    expect(JSON.parse(res.stderr).summary).toContain("Unknown work unit reference");
  });

  it("exits 3 for an unsafe artifact locator, with zero mutation", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const before = readFileSync(statePath, "utf8");
    const payloadPath = join(dir, "payload.json");
    writeFileSync(
      payloadPath,
      JSON.stringify(manualPayload({ artifacts: [{ artifactId: "A1", kind: "log", locator: "/etc/passwd" }] })),
    );
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("--preview performs zero mutation and reports the plan with exit 0", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir);
    const statePath = join(dir, ".aiqt", "state.json");
    const before = readFileSync(statePath, "utf8");
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(manualPayload()));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--preview", "--json"], dir);
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.data.wouldChangeState).toBe(true);
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });

  it("applies (writes state + runlog), exits 0, and a replay is an idempotent no-op", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(manualPayload()));

    const first = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(first.status).toBe(0);
    const firstData = JSON.parse(first.stdout).data;
    expect(firstData.outcome).toBe("created");
    expect(firstData.evidenceId).toBe("EVID-001");

    const statePath = join(dir, ".aiqt", "state.json");
    const stateAfterFirst = readFileSync(statePath, "utf8");
    const state = JSON.parse(stateAfterFirst);
    expect(state.evidence.records).toHaveLength(1);
    expect(state.evidence.records[0].importProvenance.importIdentityKey).toBe(firstData.importIdentityKey);

    const second = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(second.status).toBe(0);
    const secondData = JSON.parse(second.stdout).data;
    expect(secondData.outcome).toBe("no_op");
    expect(secondData.evidenceId).toBe("EVID-001");
    expect(readFileSync(statePath, "utf8")).toBe(stateAfterFirst);
  });

  it("reads the payload from --stdin", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir);
    const res = spawnSync(process.execPath, [tsxCli, entry, "evidence", "import", "--stdin", "--json"], {
      cwd: dir,
      input: JSON.stringify(manualPayload({ externalId: "ext-stdin-1" })),
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).data.outcome).toBe("created");
  });

  it("rejects the same importIdentityKey with a different payload as a conflict (exit 3, zero mutation)", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir);
    const payloadPath = join(dir, "payload.json");
    const payload = manualPayload({ externalId: "ext-conflict-1" });
    writeFileSync(payloadPath, JSON.stringify(payload));
    expect(runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir).status).toBe(0);

    const statePath = join(dir, ".aiqt", "state.json");
    const before = readFileSync(statePath, "utf8");

    writeFileSync(payloadPath, JSON.stringify({ ...payload, results: { ...payload.results, summary: "a different summary" } }));
    const res = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
    expect(res.status).toBe(3);
    expect(readFileSync(statePath, "utf8")).toBe(before);
  });
});
