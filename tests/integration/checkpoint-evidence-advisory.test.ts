import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInit } from "../../src/cli/commands/init.command.js";
import { runUpdate } from "../../src/cli/commands/update.command.js";
import { runPlan } from "../../src/cli/commands/plan.command.js";
import { runNext } from "../../src/cli/commands/next.command.js";
import { runCheckpoint } from "../../src/cli/commands/checkpoint.command.js";
import { runEvidenceGatePolicyImport } from "../../src/cli/commands/evidence-gate-policy-import.command.js";
import { runEvidenceGatePolicyActivate } from "../../src/cli/commands/evidence-gate-policy-activate.command.js";
import { runEvidenceGateAdvisoryRefresh } from "../../src/cli/commands/evidence-gate-advisory-refresh.command.js";
import { normalizeInitOptions } from "../../src/cli/options.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_FIXTURES = join(here, "..", "fixtures", "plans");
const CHECKPOINT_FIXTURES = join(here, "..", "fixtures", "checkpoints");

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".aiqt", "state.json"), "utf8"));
}

function writeState(dir: string, state: unknown) {
  writeFileSync(join(dir, ".aiqt", "state.json"), JSON.stringify(state, null, 2));
}

function readRunlogLines(dir: string): { type: string; data?: Record<string, unknown> }[] {
  const raw = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8").trim();
  return raw.split(/\r?\n/).map((line) => JSON.parse(line));
}

async function makeReadyProject(dir: string) {
  runInit(contextFor(dir), normalizeInitOptions({}));
  await runUpdate(contextFor(dir), { objective: "Ship it", targetUser: ["devs"] });
  const patchPath = join(dir, "readiness-patch.json");
  writeFileSync(patchPath, JSON.stringify({ context: { constraints: ["Local files are the source of truth"] } }));
  await runUpdate(contextFor(dir), { fromFile: patchPath });
}

async function makeInProgressProject(dir: string, planFixture = "valid-plan.json") {
  await makeReadyProject(dir);
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, readFileSync(join(PLAN_FIXTURES, planFixture)));
  const planResult = runPlan(contextFor(dir), { fromFile: planPath });
  expect(planResult.exitCode).toBe(ExitCode.Success);
  const nextResult = runNext(contextFor(dir));
  expect(nextResult.exitCode).toBe(ExitCode.Success);
}

function samplePolicy(version = 1): Record<string, unknown> {
  return {
    protocolVersion: "aiqt-evidence-gate-policy@1",
    policyId: "release-gate",
    version,
    name: "Release Gate",
    targetScopes: ["checkpoint"],
    rules: [
      {
        ruleId: "test-results-present",
        title: "Test results present",
        appliesTo: ["checkpoint"],
        evidenceSelector: { artifactKinds: ["test_result"], minimumTrust: "repository_local", scopeMatch: "exact_target" },
        requirement: { minimumCount: 1 },
        missingDisposition: "fail",
      },
    ],
  };
}

async function importAndActivate(dir: string, policy: Record<string, unknown>) {
  const policyPath = join(dir, "policy.json");
  writeFileSync(policyPath, JSON.stringify(policy));
  const imported = await runEvidenceGatePolicyImport(contextFor(dir), { fromFile: policyPath });
  expect(imported.exitCode).toBe(ExitCode.Success);
  const activated = await runEvidenceGatePolicyActivate(contextFor(dir), {
    policyId: policy.policyId as string,
    version: policy.version as number,
  });
  expect(activated.exitCode).toBe(ExitCode.Success);
}

describe("M29: checkpoint evidence advisory", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  it("parity: no active policy -- checkpoint result is identical to pre-M29, advisory is not_configured", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.currentWorkUnitId).toBeNull();
    const state = readState(dir);
    expect(state.workGraph.workUnits[0].status).toBe("done");
    const advisory = (result.data as Record<string, unknown>).evidenceAdvisory as Record<string, unknown>;
    expect(advisory.status).toBe("not_configured");
    expect(advisory.blocking).toBe(false);
    expect(advisory.refreshCommand).toBeUndefined();
    expect(advisory.configurationCommand).toBe("aiqt evidence gate policy import --from-file <path>");
  }, 20000);

  it("parity: active policy with satisfying evidence -- checkpoint remains successful, advisory reports pass", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    const state = readState(dir);
    state.evidence = {
      records: [
        {
          evidenceId: "EVD-001",
          contractVersion: "1.0",
          provider: { providerId: "human", providerType: "human", trustLevel: "repository_local" },
          // C001 is the deterministic id of the checkpoint this test is about to create (first checkpoint ever).
          workflowBinding: { workUnitId: "WU001", packetId: state.lastAgentPacket.id, checkpointId: "C001", implementationRootId: "ROOT-001" },
          codeBinding: { capturedAt: state.lastUpdatedAt },
          reviewer: { reviewerType: "human", independentContext: "unknown" },
          results: { reviewResult: "passed", validationResult: "passed", acceptanceCriteriaResult: "passed", summary: "ok" },
          sourceFindings: [],
          decisionEscalationIds: [],
          artifactReferences: [{ artifactId: "ART-1", kind: "test_result", locator: "https://example.test/1" }],
          recordedAt: state.lastUpdatedAt,
        },
      ],
      decisionEscalations: [],
    };
    writeState(dir, state);

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    const advisory = (result.data as Record<string, unknown>).evidenceAdvisory as Record<string, unknown>;
    expect(advisory.status).toBe("evaluated");
    expect(advisory.result).toBe("pass");
    expect(advisory.refreshCommand).toBeUndefined();
  }, 20000);

  it("parity: active policy with failing evidence -- checkpoint STILL succeeds (advisory is non-blocking), advisory reports fail with a refreshCommand", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    // No evidence at all -> the single rule's minimumCount is unmet -> fail.

    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.status).toBe("passed");
    expect(result.currentWorkUnitId).toBeNull();
    const state = readState(dir);
    expect(state.workGraph.workUnits[0].status).toBe("done");
    const advisory = (result.data as Record<string, unknown>).evidenceAdvisory as Record<string, unknown>;
    expect(advisory.status).toBe("evaluated");
    expect(advisory.result).toBe("fail");
    expect(advisory.blocking).toBe(false);
    expect(advisory.refreshCommand).toBe("aiqt evidence gate advisory refresh --checkpoint C001");
  }, 20000);

  it("downstream readiness parity: newlyReadyWorkUnitIds is identical regardless of a failing advisory", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir, "valid-plan-with-dependencies.json");
    await importAndActivate(dir, samplePolicy());
    const result = runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as Record<string, unknown>;
    // WU002 depends on WU001; completing WU001 must unblock it exactly as pre-M29, independent of the (failing, unconfigured-evidence) advisory outcome.
    expect(data.newlyReadyWorkUnitIds).toEqual(["WU002"]);
    const advisory = data.evidenceAdvisory as Record<string, unknown>;
    expect(advisory.result).toBe("fail");
  }, 20000);

  it("post-success ordering: the advisory observation event is appended strictly after the checkpoint's own runlog events", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const events = readRunlogLines(dir).map((e) => e.type);
    const checkpointIdx = events.indexOf("checkpoint.created");
    const statusChangedIdx = events.indexOf("work_unit.status_changed");
    const advisoryIdx = events.indexOf("evidence_gate.advisory_observation_recorded");
    expect(checkpointIdx).toBeGreaterThanOrEqual(0);
    expect(statusChangedIdx).toBeGreaterThanOrEqual(0);
    expect(advisoryIdx).toBeGreaterThan(checkpointIdx);
    expect(advisoryIdx).toBeGreaterThan(statusChangedIdx);
  }, 20000);

  it("advisory state write uses the checkpoint's own createdAt as asOf (the Gate-I-verified canonical completion timestamp)", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const state = readState(dir);
    const checkpoint = state.checkpoints[0];
    const advisory = state.checkpointEvidenceAdvisories.find((a: { checkpointId: string }) => a.checkpointId === checkpoint.id);
    expect(advisory.current.asOf).toBe(checkpoint.createdAt);
  }, 20000);

  it("bounded observation history: history never exceeds the max, oldest is pruned first, current always matches the newest", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const state = readState(dir);
    const checkpointId = state.checkpoints[0].id;

    // 12 distinct explicit refreshes (distinct --as-of each time) must
    // produce 12 distinct observationIds but a history capped at 10, with
    // current always equal to the most recent.
    let lastAsOf = "";
    for (let i = 0; i < 12; i++) {
      const asOf = `2026-02-01T00:00:${String(i).padStart(2, "0")}.000Z`;
      lastAsOf = asOf;
      const refreshed = await runEvidenceGateAdvisoryRefresh(contextFor(dir), { checkpointId, asOf });
      expect(refreshed.exitCode).toBe(ExitCode.Success);
    }
    const finalState = readState(dir);
    const advisory = finalState.checkpointEvidenceAdvisories.find((a: { checkpointId: string }) => a.checkpointId === checkpointId);
    expect(advisory.history.length).toBeLessThanOrEqual(10);
    expect(advisory.current.asOf).toBe(lastAsOf);
    expect(advisory.current).toEqual(advisory.history[advisory.history.length - 1]);
    const uniqueIds = new Set(advisory.history.map((o: { observationId: string }) => o.observationId));
    expect(uniqueIds.size).toBe(advisory.history.length);
  }, 30000);

  it("explicit refresh: identical replay (same --as-of) is an idempotent no-op -- no duplicate runlog event", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const state = readState(dir);
    const checkpointId = state.checkpoints[0].id;
    const asOf = "2026-03-01T00:00:00.000Z";

    const first = await runEvidenceGateAdvisoryRefresh(contextFor(dir), { checkpointId, asOf });
    expect(first.exitCode).toBe(ExitCode.Success);
    expect((first.data as Record<string, unknown>).outcome).toBe("refreshed");

    const beforeCount = readRunlogLines(dir).filter((e) => e.type === "evidence_gate.advisory_observation_recorded").length;
    const second = await runEvidenceGateAdvisoryRefresh(contextFor(dir), { checkpointId, asOf });
    expect(second.exitCode).toBe(ExitCode.Success);
    expect((second.data as Record<string, unknown>).outcome).toBe("no_op");
    const afterCount = readRunlogLines(dir).filter((e) => e.type === "evidence_gate.advisory_observation_recorded").length;
    expect(afterCount).toBe(beforeCount);
  }, 20000);

  it("explicit refresh --preview performs complete evaluation with zero mutation", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    await importAndActivate(dir, samplePolicy());
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const before = readFileSync(join(dir, ".aiqt", "state.json"), "utf8");
    const beforeRunlog = readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8");
    const state = readState(dir);
    const checkpointId = state.checkpoints[0].id;

    const result = await runEvidenceGateAdvisoryRefresh(contextFor(dir), { checkpointId, preview: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    expect((result.data as Record<string, unknown>).outcome).toBe("preview");
    expect(readFileSync(join(dir, ".aiqt", "state.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, ".aiqt", "runlog.jsonl"), "utf8")).toBe(beforeRunlog);
  }, 20000);

  it("explicit refresh: unknown checkpoint returns exit 2 (valid operation blocked by bounded state condition)", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = await runEvidenceGateAdvisoryRefresh(contextFor(dir), { checkpointId: "C999" });
    expect(result.exitCode).toBe(ExitCode.WorkflowBlocked);
  }, 20000);

  it("explicit refresh: missing --checkpoint returns exit 10 (required input absent)", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    const result = await runEvidenceGateAdvisoryRefresh(contextFor(dir), {});
    expect(result.exitCode).toBe(ExitCode.HumanInputRequired);
  }, 20000);

  it("explicit refresh: malformed --as-of returns exit 3", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const state = readState(dir);
    const result = await runEvidenceGateAdvisoryRefresh(contextFor(dir), {
      checkpointId: state.checkpoints[0].id,
      asOf: "not-a-timestamp",
    });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  }, 20000);

  it("historical checkpoints without advisory fields remain valid and unaffected by refresh availability", async () => {
    dir = makeTempDir();
    await makeInProgressProject(dir);
    // Simulate a pre-M29 completed checkpoint: no checkpointEvidenceAdvisories key at all in state.
    runCheckpoint(contextFor(dir), { fromFile: join(CHECKPOINT_FIXTURES, "valid-done.json") });
    const state = readState(dir);
    delete state.checkpointEvidenceAdvisories;
    writeState(dir, state);

    const result = await runEvidenceGateAdvisoryRefresh(contextFor(dir), { checkpointId: state.checkpoints[0].id });
    expect(result.exitCode).toBe(ExitCode.Success);
    const finalState = readState(dir);
    expect(finalState.checkpointEvidenceAdvisories).toHaveLength(1);
  }, 20000);

  it("does not add any new process, shell, network, or dynamic-loading imports to the advisory integration module", () => {
    const src = readFileSync(join(here, "..", "..", "src", "workflow", "checkpoint-advisory-integration.ts"), "utf8");
    expect(src).not.toMatch(/child_process|node-fetch|require\(|import\(/);
    const evalSrc = readFileSync(join(here, "..", "..", "src", "workflow", "checkpoint-advisory-evaluation.ts"), "utf8");
    expect(evalSrc).not.toMatch(/child_process|node-fetch|require\(|import\(/);
  });
});
