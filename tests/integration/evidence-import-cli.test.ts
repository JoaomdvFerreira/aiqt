import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
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
    expect(JSON.parse(res.stdout).summary).toContain("Unknown work unit reference");
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

  /**
   * M23 governance/atomicity micro-closure, Part C: state.json is written
   * via writeStateModel (atomic rename-over-temp-file) BEFORE
   * appendRunlogEvent runs -- there is a real window where the state write
   * succeeds and the runlog append then fails. This test injects that
   * exact failure (making runlog.jsonl read-only after `loadProject`'s own
   * pre-flight health check has already passed against the normal,
   * readable file -- a read-only file still passes that read-only health
   * check, but `appendFileSync` then throws EPERM) and proves the three
   * safety properties that make this window non-corrupting: (1) state.json
   * is left correct and authoritative even though the command reports
   * failure, (2) a retry after the operator restores write access is a
   * true idempotent no-op with zero duplicate EvidenceRecord/ProjectIssue/
   * escalation, and (3) no duplicate runlog event is ever appended. The
   * specific runlog event for the original attempt is NOT reconstructed on
   * retry -- that is the disclosed, accepted
   * "authoritative-state-with-advisory-runlog-gap" model recorded in
   * GOVERNANCE.md, a pre-existing characteristic of every command using
   * this same write-then-append sequence (e.g. graph-repair.command.ts
   * --apply), not unique to or newly introduced by M23.
   */
  it("a runlog-append failure after a successful state write leaves state.json correct, and a retry is a safe idempotent no-op with no duplication", () => {
    dir = makeTempDir();
    expect(runCli(["init"], dir).status).toBe(0);
    seedWorkUnit(dir);
    const payloadPath = join(dir, "payload.json");
    writeFileSync(payloadPath, JSON.stringify(manualPayload({ externalId: "ext-runlog-failure-1" })));

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const stateBefore = readFileSync(statePath, "utf8");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    // Inject the failure: runlog.jsonl is a normal, readable file (so
    // loadProject's inspectRunlogHealth pre-flight check still passes),
    // but is not writable, so appendRunlogEvent's appendFileSync throws.
    chmodSync(runlogPath, 0o444);
    try {
      const failedRun = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
      // errorToResult's generic-Error fallback -> ExitCode.InvalidInput (3).
      expect(failedRun.status).toBe(3);
      const failedResult = JSON.parse(failedRun.stdout);
      expect(failedResult.status).toBe("failed");

      // Property 1: state.json was already written and IS the new
      // evidence, even though the command reported failure.
      const stateAfterFailure = readFileSync(statePath, "utf8");
      expect(stateAfterFailure).not.toBe(stateBefore);
      const parsedState = JSON.parse(stateAfterFailure);
      expect(parsedState.evidence.records).toHaveLength(1);
      expect(parsedState.evidence.records[0].evidenceId).toBe("EVID-001");
      const importedIdentityKey = parsedState.evidence.records[0].importProvenance.importIdentityKey;

      // Resulting runlog: unchanged (the append never landed).
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      // Operator restores write access and retries the identical command.
      chmodSync(runlogPath, 0o644);

      const retryRun = runCli(["evidence", "import", "--from-file", payloadPath, "--json"], dir);
      expect(retryRun.status).toBe(0);
      const retryResult = JSON.parse(retryRun.stdout);
      expect(retryResult.data.outcome).toBe("no_op");
      expect(retryResult.data.evidenceId).toBe("EVID-001");
      expect(retryResult.data.importIdentityKey).toBe(importedIdentityKey);

      // Property 2: retry is a true no-op -- state.json is byte-for-byte
      // unchanged from right after the failed attempt (no duplicate
      // EvidenceRecord/ProjectIssue/escalation was created).
      expect(readFileSync(statePath, "utf8")).toBe(stateAfterFailure);
      const finalState = JSON.parse(readFileSync(statePath, "utf8"));
      expect(finalState.evidence.records).toHaveLength(1);

      // Property 3: no duplicate runlog event was appended on retry -- the
      // no_op path never calls appendRunlogEvent, so the runlog remains
      // exactly as it was left after the failed attempt (unchanged). The
      // original event is not reconstructed; this is the disclosed,
      // accepted model, not a silent data-safety gap.
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);
    } finally {
      // Always restore write access so the temp dir can be cleaned up.
      chmodSync(runlogPath, 0o644);
    }
  });
});
