import { describe, expect, it } from "vitest";
import type { AutonomousRunStatus, AutonomousResultState } from "../../src/schema/autonomous-run.schema.js";
import { AutonomousRunStatusSchema, TERMINAL_RUN_STATUSES } from "../../src/schema/autonomous-run.schema.js";
import {
  isValidRunStatusTransition,
  allowedNextStatuses,
  isValidRunStatus,
  isValidTerminalPairing,
} from "../../src/workflow/autonomous-run-lifecycle.js";

const ALL_STATUSES = AutonomousRunStatusSchema.options;

describe("M36-WU01: autonomous-run lifecycle transition validity", () => {
  it("recognizes every declared status as valid", () => {
    for (const status of ALL_STATUSES) {
      expect(isValidRunStatus(status)).toBe(true);
    }
  });

  it("the documented spine (created -> ... -> reviewing -> completed) is fully valid", () => {
    const spine: AutonomousRunStatus[] = [
      "created",
      "preflight",
      "classified",
      "awaiting_approval",
      "preparing_workspace",
      "executing",
      "validating",
      "reviewing",
      "completed",
    ];
    for (let i = 0; i < spine.length - 1; i++) {
      expect(isValidRunStatusTransition(spine[i], spine[i + 1])).toBe(true);
    }
  });

  it("classified may skip awaiting_approval directly to preparing_workspace (low-risk autonomous path)", () => {
    expect(isValidRunStatusTransition("classified", "preparing_workspace")).toBe(true);
  });

  it("M37-WU03 correction: executing may transition directly to blocked (a command denied mid-execution never reaches validating/reviewing)", () => {
    expect(isValidRunStatusTransition("executing", "blocked")).toBe(true);
  });

  it("rejects a self-transition for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(isValidRunStatusTransition(status, status)).toBe(false);
    }
  });

  it("rejects skipping directly from created to executing", () => {
    expect(isValidRunStatusTransition("created", "executing")).toBe(false);
  });

  it("rejects moving backwards from validating to preparing_workspace", () => {
    expect(isValidRunStatusTransition("validating", "preparing_workspace")).toBe(false);
  });

  it("every terminal status has zero allowed next statuses", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(allowedNextStatuses(status).size).toBe(0);
    }
  });

  it("cancelled and budget_exhausted are reachable from every non-terminal status", () => {
    for (const status of ALL_STATUSES) {
      if (TERMINAL_RUN_STATUSES.has(status)) continue;
      const next = allowedNextStatuses(status);
      const canCancel = next.has("cancelled");
      const canExhaust = next.has("budget_exhausted");
      expect(canCancel || canExhaust, `${status} should reach cancelled or budget_exhausted`).toBe(true);
    }
  });

  it("no transition ever targets 'created' (a run can never return to its own start)", () => {
    for (const status of ALL_STATUSES) {
      expect(allowedNextStatuses(status).has("created")).toBe(false);
    }
  });
});

describe("M36-WU01: result-state / terminal-status pairing invariant", () => {
  const VALID_PAIRS: [AutonomousRunStatus, AutonomousResultState][] = [
    ["completed", "passed"],
    ["blocked", "blocked"],
    ["blocked", "needs_input"],
    ["cancelled", "cancelled"],
    ["budget_exhausted", "budget_exhausted"],
    ["failed", "failed"],
    ["failed", "validation_failed"],
    ["failed", "review_rejected"],
  ];

  it.each(VALID_PAIRS)("status %s pairs validly with result state %s", (status, resultState) => {
    expect(isValidTerminalPairing(status, resultState)).toBe(true);
  });

  it("rejects a non-terminal status paired with any result state", () => {
    expect(isValidTerminalPairing("executing", "passed")).toBe(false);
  });

  it("rejects a mismatched terminal pairing (completed cannot report cancelled)", () => {
    expect(isValidTerminalPairing("completed", "cancelled")).toBe(false);
  });

  it("rejects a mismatched terminal pairing (cancelled cannot report passed)", () => {
    expect(isValidTerminalPairing("cancelled", "passed")).toBe(false);
  });
});
