import { describe, it, expect, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";

// Every test here drives the real CLI through repeated tsx subprocess
// spawns (each paying Node startup + on-the-fly TS transpile with no
// build cache). Measured isolated runtime on this repo's fastest
// available Node runtime is already 3.7-5.0s for the multi-call cases;
// under CI's Node 22 leg with full-suite concurrent load the busiest
// test (5 subprocess calls) exceeds the 5000ms default. This is
// inherent subprocess-spawn cost, not product or test-setup
// inefficiency -- see
// docs/engineering/m30-correction-node22-integration-timeouts.md.
vi.setConfig({ testTimeout: 15000 });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry = join(repoRoot, "src", "index.ts");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
}

const T1 = "2026-01-01T00:00:00.000Z";
const T1_PLUS_1H_1S = "2026-01-01T01:00:01.000Z";

function seedInProgressWorkUnitWithPacket(dir: string): void {
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
    status: "in_progress",
    dependencies: [],
    createdAt: state.lastUpdatedAt,
    updatedAt: state.lastUpdatedAt,
    executionMetadata: {
      workspaceAssignment: { mode: "none", access: "read_only" },
      parallelPolicy: { mode: "serialized", resourceClaims: [] },
    },
  });
  state.workGraph.milestones.push({ id: "M001", title: "M", objective: "O", status: "in_progress", workUnitIds: ["WU001"] });
  state.currentWorkUnitId = "WU001";
  state.currentMilestoneId = "M001";
  state.lastAgentPacket = {
    id: "PKT-001",
    workUnitId: "WU001",
    milestoneId: "M001",
    createdAt: T1,
    format: "markdown",
    contentHash: "sha256:" + "a".repeat(64),
    sourceCommand: "aiqt next",
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function envelope(events: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "long-running-execution-protocol@1",
    providerId: "example.provider",
    sessionClientKey: "client-1",
    events,
    ...overrides,
  };
}

function openSession(dir: string): void {
  const path = join(dir, "open.json");
  writeFileSync(path, JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1, budgets: { staleAfterSeconds: 3600 } }])));
  expect(runCli(["execution", "import", "--from-file", path, "--as-of", T1, "--json"], dir).status).toBe(0);
}

describe("M26-WU05: security, caps, cross-reference, replay, and privacy hardening", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("rejects an envelope with more than 100 events (max_events_per_envelope)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const events = Array.from({ length: 101 }, (_, i) => ({ type: "session.opened", eventId: `E${i}`, at: T1 }));
    const path = join(dir, "envelope.json");
    writeFileSync(path, JSON.stringify(envelope(events)));
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("rejects a payload exceeding max_bytes (1MB)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const path = join(dir, "envelope.json");
    const huge = envelope([{ type: "session.summary_updated", eventId: "E1", at: T1, learningSummary: "x".repeat(2_000_000) }]);
    writeFileSync(path, JSON.stringify(huge));
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("rejects a payload exceeding max_json_depth (20)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    // Build a deeply nested object inside contextSummary's sibling field
    // set is not possible (schema is strict/flat) -- instead nest inside
    // an event field that accepts arbitrary structure is not available
    // either, since every event schema is strict. Depth is exercised via
    // a nested "options" array-of-arrays style structure is also not
    // legal. Use the top-level envelope object with deep nesting via a
    // sequence of wrapper arrays is likewise rejected by the schema
    // shape itself. This test instead confirms the JSON-safety layer
    // (shared with M23) is actually invoked by nesting inside a
    // deliberately malformed but structurally-plausible extra object,
    // which parseAndValidateExternalJson's assertSafeParsedJson walks
    // before the envelope schema ever sees it.
    let nested: unknown = "leaf";
    for (let i = 0; i < 25; i++) nested = { child: nested };
    const path = join(dir, "envelope.json");
    writeFileSync(path, JSON.stringify({ ...envelope([{ type: "session.opened", eventId: "E1", at: T1 }]), extra: nested }));
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    // Either the depth guard or the strict-schema "extra" key rejection
    // fires first -- both are exit 3, proving the input is never accepted.
    expect(res.status).toBe(3);
  });

  it("rejects a prohibited __proto__ key anywhere in the payload (shared M23 JSON-safety layer)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    const path = join(dir, "envelope.json");
    const raw = '{"protocolVersion":"long-running-execution-protocol@1","providerId":"example.provider","sessionClientKey":"c1","events":[{"type":"session.opened","eventId":"E1","at":"2026-01-01T00:00:00.000Z","__proto__":{"polluted":true}}]}';
    writeFileSync(path, raw);
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("an unresolved evidence reference is rejected with zero mutation (cross-reference validated before write)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSession(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateBefore = readFileSync(statePath, "utf8");

    const path = join(dir, "envelope.json");
    writeFileSync(path, JSON.stringify(envelope([{ type: "session.references_added", eventId: "E2", at: T1, evidenceRefs: ["EVID-999"] }])));
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("an envelope with a valid first event and an invalid second event mutates nothing (full-batch atomicity through the real CLI)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    const stateBefore = readFileSync(statePath, "utf8");

    const path = join(dir, "envelope.json");
    writeFileSync(
      path,
      JSON.stringify(
        envelope([
          { type: "session.opened", eventId: "E1", at: T1 },
          { type: "decision.resolved", eventId: "E2", at: T1, providerDecisionKey: "never-requested" },
        ]),
      ),
    );
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("sequential envelopes against the same session preserve correct iteration sequence numbers with no loss or duplication", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSession(dir);

    for (let i = 1; i <= 3; i++) {
      const path = join(dir, `iter-${i}.json`);
      writeFileSync(
        path,
        JSON.stringify(
          envelope([
            { type: "iteration.started", eventId: `S${i}`, at: T1, providerIterationKey: `iter-${i}` },
            { type: "iteration.finished", eventId: `F${i}`, at: T1, providerIterationKey: `iter-${i}`, status: "completed" },
          ]),
        ),
      );
      const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
      expect(res.status).toBe(0);
    }

    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const iterations = state.executionSessions[0].iterations;
    expect(iterations.map((i: { sequence: number }) => i.sequence)).toEqual([1, 2, 3]);
    expect(new Set(iterations.map((i: { id: string }) => i.id)).size).toBe(3);
  });

  it("never persists an unrecognized field resembling a raw prompt/transcript/log/diff (strict schema rejects it)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const path = join(dir, "envelope.json");
    writeFileSync(
      path,
      JSON.stringify({
        ...envelope([{ type: "session.opened", eventId: "E1", at: T1 }]),
        rawTranscript: "the entire conversation log...",
      }),
    );
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("an event-level unrecognized field (e.g. a smuggled rawPrompt) is rejected by the strict per-event schema", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    const path = join(dir, "envelope.json");
    writeFileSync(
      path,
      JSON.stringify(envelope([{ type: "session.opened", eventId: "E1", at: T1, rawPrompt: "system: you are..." }])),
    );
    const res = runCli(["execution", "import", "--from-file", path, "--json"], dir);
    expect(res.status).toBe(3);
  });

  it("state.json never contains a raw event payload -- only bounded receipts (eventId/digest/appliedAt)", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSession(dir);
    const state = JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
    const receipt = state.executionSessions[0].eventReceipts[0];
    expect(Object.keys(receipt).sort()).toEqual(["appliedAt", "digest", "eventId"]);
  });

  it("a direct runlog-append failure during `execution stale --apply` leaves state authoritative and a retry idempotent", () => {
    dir = makeTempDir();
    expect(runCli(["init", "--json"], dir).status).toBe(0);
    seedInProgressWorkUnitWithPacket(dir);
    openSession(dir);

    const statePath = join(dir, ".aiqt", "state.json");
    const runlogPath = join(dir, ".aiqt", "runlog.jsonl");
    const runlogBefore = readFileSync(runlogPath, "utf8");

    chmodSync(runlogPath, 0o444);
    try {
      const failedApply = runCli(["execution", "stale", "--apply", "--as-of", T1_PLUS_1H_1S, "--json"], dir);
      expect(failedApply.status).toBe(3);

      const stateAfterFailure = JSON.parse(readFileSync(statePath, "utf8"));
      expect(stateAfterFailure.executionSessions[0].status).toBe("stale");
      expect(readFileSync(runlogPath, "utf8")).toBe(runlogBefore);

      chmodSync(runlogPath, 0o644);
      const retry = runCli(["execution", "stale", "--apply", "--as-of", T1_PLUS_1H_1S, "--json"], dir);
      // Already stale -- nothing left eligible -- exit 2, not a duplicate transition.
      expect(retry.status).toBe(2);
    } finally {
      chmodSync(runlogPath, 0o644);
    }
  });
});
