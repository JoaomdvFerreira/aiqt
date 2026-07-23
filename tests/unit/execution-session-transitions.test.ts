import { describe, it, expect } from "vitest";
import { isValidSessionStatusTransition } from "../../src/workflow/execution-session-transitions.js";
import { isTerminalSessionStatus, ExecutionSessionStatusSchema } from "../../src/schema/execution-session.schema.js";
import type { ExecutionSessionStatus } from "../../src/schema/execution-session.schema.js";

const ALL_STATUSES = ExecutionSessionStatusSchema.options;

describe("isValidSessionStatusTransition (M26 §4.1)", () => {
  it("allows planned -> running", () => {
    expect(isValidSessionStatusTransition("planned", "running")).toBe(true);
  });

  it("allows planned -> failed (startup failure before first iteration)", () => {
    expect(isValidSessionStatusTransition("planned", "failed")).toBe(true);
  });

  it("allows planned -> cancelled (deliberate cancellation, distinct from startup failure)", () => {
    expect(isValidSessionStatusTransition("planned", "cancelled")).toBe(true);
  });

  it("prohibits stale -> completed", () => {
    expect(isValidSessionStatusTransition("stale", "completed")).toBe(false);
  });

  it("allows stale -> running, paused, blocked, failed, cancelled", () => {
    expect(isValidSessionStatusTransition("stale", "running")).toBe(true);
    expect(isValidSessionStatusTransition("stale", "paused")).toBe(true);
    expect(isValidSessionStatusTransition("stale", "blocked")).toBe(true);
    expect(isValidSessionStatusTransition("stale", "failed")).toBe(true);
    expect(isValidSessionStatusTransition("stale", "cancelled")).toBe(true);
  });

  it("rejects every transition out of a terminal status (failed/completed/cancelled)", () => {
    const terminals: ExecutionSessionStatus[] = ["failed", "completed", "cancelled"];
    for (const from of terminals) {
      for (const to of ALL_STATUSES) {
        expect(isValidSessionStatusTransition(from, to)).toBe(false);
      }
    }
  });

  it("rejects a self-transition for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(isValidSessionStatusTransition(status, status)).toBe(false);
    }
  });

  it("running allows paused/blocked/failed/completed/cancelled/stale", () => {
    for (const to of ["paused", "blocked", "failed", "completed", "cancelled", "stale"] as const) {
      expect(isValidSessionStatusTransition("running", to)).toBe(true);
    }
  });

  it("running does not allow a direct transition back to planned", () => {
    expect(isValidSessionStatusTransition("running", "planned")).toBe(false);
  });
});

describe("isTerminalSessionStatus (M26 §3.1)", () => {
  it("classifies failed/completed/cancelled as terminal", () => {
    expect(isTerminalSessionStatus("failed")).toBe(true);
    expect(isTerminalSessionStatus("completed")).toBe(true);
    expect(isTerminalSessionStatus("cancelled")).toBe(true);
  });

  it("classifies planned/running/paused/blocked/stale as non-terminal", () => {
    expect(isTerminalSessionStatus("planned")).toBe(false);
    expect(isTerminalSessionStatus("running")).toBe(false);
    expect(isTerminalSessionStatus("paused")).toBe(false);
    expect(isTerminalSessionStatus("blocked")).toBe(false);
    expect(isTerminalSessionStatus("stale")).toBe(false);
  });
});
