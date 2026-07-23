import { describe, it, expect } from "vitest";
import {
  ExecutionSessionSchema,
  ExecutionWorkspaceRefSchema,
  ExecutionProviderRefSchema,
  ExecutionIterationSchema,
  ExecutionDecisionSchema,
  MAX_OPEN_DECISIONS_PER_SESSION,
  MAX_SERIALIZED_SESSION_BYTES,
} from "../../src/schema/execution-session.schema.js";
import { StateModelSchema } from "../../src/schema/state.schema.js";
import { buildInitialStateModel } from "../../src/state/workflow-state-store.js";

const T1 = "2026-01-01T00:00:00.000Z";

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "sha256:" + "a".repeat(64),
    protocolVersion: "long-running-execution-protocol@1",
    sessionClientKey: "client-1",
    provider: { providerId: "example.provider" },
    workUnitId: "WU001",
    packetId: "PKT-001",
    workspaceRef: { mode: "none" },
    status: "planned",
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

describe("ExecutionProviderRefSchema (M26 §2)", () => {
  it("accepts a valid namespaced provider id", () => {
    expect(ExecutionProviderRefSchema.safeParse({ providerId: "acme.coding-agent/v2" }).success).toBe(true);
  });

  it("rejects an uppercase provider id", () => {
    expect(ExecutionProviderRefSchema.safeParse({ providerId: "Acme.Agent" }).success).toBe(false);
  });

  it("rejects a provider id starting with a separator", () => {
    expect(ExecutionProviderRefSchema.safeParse({ providerId: "-acme" }).success).toBe(false);
  });

  it("accepts an unknown but syntactically valid provider id as opaque metadata", () => {
    expect(ExecutionProviderRefSchema.safeParse({ providerId: "totally-unknown-vendor" }).success).toBe(true);
  });
});

describe("ExecutionWorkspaceRefSchema (M26 §3.2)", () => {
  it("accepts mode 'none' with no workspace fields", () => {
    expect(ExecutionWorkspaceRefSchema.safeParse({ mode: "none" }).success).toBe(true);
  });

  it("rejects mode 'none' with a workspaceId set", () => {
    const result = ExecutionWorkspaceRefSchema.safeParse({ mode: "none", workspaceId: "WS-001" });
    expect(result.success).toBe(false);
  });

  it("accepts mode 'managed' with all three fields", () => {
    const result = ExecutionWorkspaceRefSchema.safeParse({
      mode: "managed",
      workspaceId: "WS-001",
      workspaceBindingId: "WSB-001",
      workspaceGeneration: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects mode 'managed' missing workspaceGeneration", () => {
    const result = ExecutionWorkspaceRefSchema.safeParse({
      mode: "managed",
      workspaceId: "WS-001",
      workspaceBindingId: "WSB-001",
    });
    expect(result.success).toBe(false);
  });
});

describe("ExecutionSessionSchema (M26 §3.1)", () => {
  it("accepts a minimal valid planned session with workspace mode none", () => {
    expect(ExecutionSessionSchema.safeParse(baseSession()).success).toBe(true);
  });

  it("requires terminalAt when status is terminal", () => {
    const result = ExecutionSessionSchema.safeParse(baseSession({ status: "completed" }));
    expect(result.success).toBe(false);
  });

  it("accepts a terminal session with terminalAt set", () => {
    const result = ExecutionSessionSchema.safeParse(baseSession({ status: "completed", terminalAt: T1 }));
    expect(result.success).toBe(true);
  });

  it("rejects terminalAt set on a non-terminal session", () => {
    const result = ExecutionSessionSchema.safeParse(baseSession({ status: "running", terminalAt: T1 }));
    expect(result.success).toBe(false);
  });

  it("rejects more than one running iteration", () => {
    const iteration = (seq: number, status = "running") => ({
      id: `XI-00${seq}`,
      providerIterationKey: `iter-${seq}`,
      sequence: seq,
      status,
      startedAt: T1,
      commitRefs: [],
      evidenceRefs: [],
    });
    const result = ExecutionSessionSchema.safeParse(
      baseSession({ status: "running", iterations: [iteration(1), iteration(2)] }),
    );
    expect(result.success).toBe(false);
  });

  it(`rejects more than ${MAX_OPEN_DECISIONS_PER_SESSION} open decisions`, () => {
    const decision = (n: number) => ({
      id: `XD-${n}`,
      providerDecisionKey: `dec-${n}`,
      status: "open",
      title: "t",
      question: "q",
      options: [],
      requestedAt: T1,
    });
    const decisions = Array.from({ length: MAX_OPEN_DECISIONS_PER_SESSION + 1 }, (_, i) => decision(i));
    const result = ExecutionSessionSchema.safeParse(baseSession({ decisions }));
    expect(result.success).toBe(false);
  });

  it("rejects a session exceeding the serialized-size cap", () => {
    // 100 iterations (the per-session max) each carrying two 2000-char
    // bounded-text summaries comfortably exceeds the 262144-byte cap.
    const iterations = Array.from({ length: 100 }, (_, i) => ({
      id: `XI-${i}`,
      providerIterationKey: `iter-${i}`,
      sequence: i + 1,
      status: "completed",
      objectiveSummary: "o".repeat(2000),
      resultSummary: "r".repeat(2000),
      startedAt: T1,
      finishedAt: T1,
      commitRefs: [],
      evidenceRefs: [],
    }));
    const oversized = baseSession({ iterations });
    expect(JSON.stringify(oversized).length).toBeGreaterThan(MAX_SERIALIZED_SESSION_BYTES);
    const result = ExecutionSessionSchema.safeParse(oversized);
    expect(result.success).toBe(false);
  });

  it("accepts a session comfortably under the serialized-size cap", () => {
    expect(JSON.stringify(baseSession()).length).toBeLessThan(MAX_SERIALIZED_SESSION_BYTES);
    expect(ExecutionSessionSchema.safeParse(baseSession()).success).toBe(true);
  });

  it("rejects an unknown field (strict schema)", () => {
    const result = ExecutionSessionSchema.safeParse(baseSession({ unknownField: "x" }));
    expect(result.success).toBe(false);
  });

  it("rejects a protocolVersion other than the fixed literal", () => {
    const result = ExecutionSessionSchema.safeParse(baseSession({ protocolVersion: "some-other-protocol@1" }));
    expect(result.success).toBe(false);
  });
});

describe("ExecutionIterationSchema / ExecutionDecisionSchema (M26 §3.4)", () => {
  it("accepts a minimal valid iteration", () => {
    const result = ExecutionIterationSchema.safeParse({
      id: "XI-001",
      providerIterationKey: "iter-1",
      sequence: 1,
      status: "running",
      startedAt: T1,
      commitRefs: [],
      evidenceRefs: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a minimal valid decision", () => {
    const result = ExecutionDecisionSchema.safeParse({
      id: "XD-001",
      providerDecisionKey: "dec-1",
      status: "open",
      title: "Pick a library",
      question: "Which HTTP client?",
      options: ["axios", "fetch"],
      requestedAt: T1,
    });
    expect(result.success).toBe(true);
  });
});

describe("State/executionSessions additivity (M26 §3)", () => {
  it("StateModelSchema accepts state with no executionSessions field at all", () => {
    const state = buildInitialStateModel(T1);
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.executionSessions).toBeUndefined();
  });

  it("StateModelSchema accepts state with a populated executionSessions array", () => {
    const state = { ...buildInitialStateModel(T1), executionSessions: [baseSession()] };
    const parsed = StateModelSchema.safeParse(state);
    expect(parsed.success).toBe(true);
  });
});
