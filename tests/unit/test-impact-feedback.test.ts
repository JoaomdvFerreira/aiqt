import { describe, it, expect } from "vitest";
import { filterTrustedFeedback, loadValidationFeedbackFromCheckpoints } from "../../src/workflow/test-impact-feedback.js";
import type { ValidationFeedbackRef } from "../../src/schema/test-impact.schema.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";

function feedback(overrides: Partial<ValidationFeedbackRef> = {}): ValidationFeedbackRef {
  return {
    targetId: "test_file:tests/unit/foo.test.ts",
    outcome: "failed",
    workUnitId: "wu-1",
    changeIdentity: "chk-1",
    durationMs: null,
    failureCategory: null,
    evidenceTimestamp: "2026-01-01T00:00:00.000Z",
    evidenceSource: "checkpoint:chk-1",
    ...overrides,
  };
}

describe("filterTrustedFeedback: stale/mismatched feedback is rejected (build spec Sec 10)", () => {
  it("accepts feedback whose changeIdentity matches the current change", () => {
    const result = filterTrustedFeedback([feedback()], { currentChangeIdentity: "chk-1" });
    expect(result.trusted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects feedback from a mismatched changeIdentity -- never treated as current verified evidence", () => {
    const result = filterTrustedFeedback([feedback({ changeIdentity: "chk-0-old" })], { currentChangeIdentity: "chk-1" });
    expect(result.trusted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toMatch(/mismatched/i);
  });

  it("rejects feedback older than an explicit maxAgeMs window", () => {
    const result = filterTrustedFeedback([feedback({ evidenceTimestamp: "2020-01-01T00:00:00.000Z" })], {
      currentChangeIdentity: "chk-1",
      maxAgeMs: 1000,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(result.trusted).toHaveLength(0);
    expect(result.rejected[0]?.reason).toMatch(/trust window/i);
  });

  it("with no maxAgeMs, any age is accepted as long as the identity matches", () => {
    const result = filterTrustedFeedback([feedback({ evidenceTimestamp: "2020-01-01T00:00:00.000Z" })], { currentChangeIdentity: "chk-1" });
    expect(result.trusted).toHaveLength(1);
  });
});

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "chk-1",
    workUnitId: "wu-1",
    packetId: null,
    summary: "done",
    completed: [],
    notCompleted: [],
    filesChanged: [],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [{ command: "pnpm typecheck", result: "passed", summary: null }],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loadValidationFeedbackFromCheckpoints: real, bounded extraction from the canonical Checkpoint owner", () => {
  it("extracts one feedback ref per validation command, scoped to the requested Work Unit", () => {
    const refs = loadValidationFeedbackFromCheckpoints([checkpoint(), checkpoint({ id: "chk-2", workUnitId: "wu-other" })], "wu-1");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.targetId).toBe("validation_command:pnpm typecheck");
    expect(refs[0]?.outcome).toBe("passed");
    expect(refs[0]?.changeIdentity).toBe("chk-1");
  });

  it("maps a failed validation command to outcome 'failed' with a failure category", () => {
    const refs = loadValidationFeedbackFromCheckpoints([checkpoint({ validationCommands: [{ command: "vitest run tests/unit/foo.test.ts", result: "failed", summary: null }] })], "wu-1");
    expect(refs[0]?.outcome).toBe("failed");
    expect(refs[0]?.failureCategory).toBe("validation_command_failed");
  });

  it("is bounded by maxEntries (checkpoint count, not command count)", () => {
    const checkpoints = Array.from({ length: 30 }, (_, i) => checkpoint({ id: `chk-${i}`, createdAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
    const refs = loadValidationFeedbackFromCheckpoints(checkpoints, "wu-1", 5);
    const distinctChangeIdentities = new Set(refs.map((r) => r.changeIdentity));
    expect(distinctChangeIdentities.size).toBeLessThanOrEqual(5);
  });

  it("never fabricates a duration -- checkpoints carry none, so durationMs is always null from this source", () => {
    const refs = loadValidationFeedbackFromCheckpoints([checkpoint()], "wu-1");
    expect(refs[0]?.durationMs).toBeNull();
  });
});
