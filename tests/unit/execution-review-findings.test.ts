import { describe, it, expect } from "vitest";
import { collectExecutionFindings } from "../../src/workflow/execution-review-findings.js";
import type { StateModel } from "../../src/schema/state.schema.js";
import type { ExecutionSession } from "../../src/schema/execution-session.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: "sha256:" + "a".repeat(64),
    protocolVersion: "long-running-execution-protocol@1",
    sessionClientKey: "client-1",
    provider: { providerId: "example.provider" },
    workUnitId: "WU001",
    packetId: "PKT-001",
    workspaceRef: { mode: "none" },
    status: "running",
    budgetState: "not_configured",
    iterations: [],
    decisions: [],
    rollbackRecords: [],
    commitRefs: [],
    evidenceRefs: [],
    statusTransitions: [],
    eventReceipts: [],
    createdAt: T1,
    updatedAt: T1,
    lastActivityAt: T1,
    ...overrides,
  };
}

function stateWith(sessions: ExecutionSession[], overrides: Partial<StateModel> = {}): StateModel {
  const base = buildInitialStateModel(T1);
  return {
    ...base,
    workGraph: {
      ...base.workGraph,
      workUnits: [
        {
          id: "WU001",
          milestoneId: "M001",
          title: "T",
          objective: "O",
          scope: [],
          outOfScope: [],
          acceptanceCriteria: [],
          agentContextRefs: [],
          suggestedFiles: [],
          validationCommands: [],
          status: "in_progress",
          dependencies: [],
          createdAt: T1,
          updatedAt: T1,
        },
      ],
    },
    executionSessions: sessions,
    ...overrides,
  };
}

describe("collectExecutionFindings (M26 §5.4)", () => {
  it("returns no findings when there are no sessions", () => {
    expect(collectExecutionFindings(buildInitialStateModel(T1), [])).toEqual([]);
  });

  it("flags a broken work-unit reference", () => {
    const s = session({ workUnitId: "WU999" });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey === `execution:${s.id}:broken-work-unit-reference`)).toBe(true);
  });

  it("flags a broken packet reference when knownPacketIds is non-empty and does not include it", () => {
    const s = session();
    const findings = collectExecutionFindings(stateWith([s]), ["PKT-999"]);
    expect(findings.some((f) => f.findingKey === `execution:${s.id}:broken-packet-reference`)).toBe(true);
  });

  it("does not flag a broken packet reference when knownPacketIds is empty (unavailable, not proven broken)", () => {
    const s = session();
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey.includes("broken-packet-reference"))).toBe(false);
  });

  it("flags a broken workspace reference for a managed ref with no matching workspace", () => {
    const s = session({ workspaceRef: { mode: "managed", workspaceId: "WS-999", workspaceBindingId: "WSB-999", workspaceGeneration: 1 } });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey === `execution:${s.id}:broken-workspace-reference`)).toBe(true);
  });

  it("flags a broken evidence reference", () => {
    const s = session({ evidenceRefs: ["EVID-999"] });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey.includes("broken-evidence-reference:EVID-999"))).toBe(true);
  });

  it("flags multiple non-terminal sessions for one packet", () => {
    const a = session({ id: "sha256:" + "1".repeat(64) });
    const b = session({ id: "sha256:" + "2".repeat(64) });
    const findings = collectExecutionFindings(stateWith([a, b]), []);
    expect(findings.filter((f) => f.findingKey.includes("multiple-non-terminal-sessions"))).toHaveLength(2);
  });

  it("flags a terminal session with a running iteration (defensive/structurally-unexpected)", () => {
    const s = session({
      status: "completed",
      terminalAt: T1,
      iterations: [
        {
          id: "XI-001",
          providerIterationKey: "iter-1",
          sequence: 1,
          status: "running",
          startedAt: T1,
          commitRefs: [],
          evidenceRefs: [],
        },
      ],
    });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey === `execution:${s.id}:terminal-with-running-iteration`)).toBe(true);
  });

  it("flags a stale session (non-blocking)", () => {
    const s = session({ status: "stale" });
    const findings = collectExecutionFindings(stateWith([s]), []);
    const finding = findings.find((f) => f.findingKey === `execution:${s.id}:stale`);
    expect(finding).toBeDefined();
    expect(finding!.blocking).toBe(false);
  });

  it("flags an open decision (non-blocking)", () => {
    const s = session({
      decisions: [
        { id: "XD-001", providerDecisionKey: "d1", status: "open", title: "Pick one", question: "Which?", options: [], requestedAt: T1 },
      ],
    });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey.includes("open-decision:XD-001"))).toBe(true);
  });

  it("flags a budget stop condition (non-blocking)", () => {
    const s = session({ budgetState: "exceeded" });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey.includes("budget-stop:exceeded"))).toBe(true);
  });

  it("flags a terminal session awaiting checkpoint", () => {
    const s = session({ status: "completed", terminalAt: T1 });
    const findings = collectExecutionFindings(stateWith([s]), []);
    expect(findings.some((f) => f.findingKey === `execution:${s.id}:terminal-awaiting-checkpoint`)).toBe(true);
  });

  it("does not flag terminal-awaiting-checkpoint once a checkpoint exists for the packet", () => {
    const s = session({ status: "completed", terminalAt: T1 });
    const state = stateWith([s], {
      checkpoints: [
        {
          id: "C001",
          workUnitId: "WU001",
          packetId: "PKT-001",
          summary: "done",
          completed: [],
          notCompleted: [],
          filesChanged: [],
          issues: [],
          validationResult: "passed",
          acceptanceCriteriaResult: "passed",
          validationCommands: [],
          acceptanceCriteria: [],
          finalWorkUnitStatus: "done",
          nextRecommendation: "aiqt next",
          createdAt: T1,
        },
      ],
    });
    const findings = collectExecutionFindings(state, []);
    expect(findings.some((f) => f.findingKey.includes("terminal-awaiting-checkpoint"))).toBe(false);
  });

  it("flags provider-reported rollback as a low-severity, non-blocking advisory", () => {
    const s = session({
      rollbackRecords: [{ id: "XR-001", providerRollbackKey: "r1", reportedAt: T1 }],
    });
    const findings = collectExecutionFindings(stateWith([s]), []);
    const finding = findings.find((f) => f.findingKey === `execution:${s.id}:rollback-reported`);
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.blocking).toBe(false);
    expect(finding!.message.toLowerCase()).toContain("unverified");
  });
});
