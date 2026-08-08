import { describe, it, expect } from "vitest";
import { selectTestImpactWithFeedback } from "../../src/workflow/test-impact-adaptive-selection.js";
import { selectTestImpact } from "../../src/workflow/test-impact-selection.js";
import { computeMultiWorkUnitSelectionEfficiency } from "../../src/workflow/test-impact-efficiency-evidence.js";
import { composeExecutionGuidance } from "../../src/workflow/execution-guidance.js";
import { renderExecutionGuidanceHuman, renderTestImpactExplain } from "../../src/workflow/execution-guidance-render.js";
import type { TestImpactInput, TestInventorySnapshot, ValidationFeedbackRef } from "../../src/schema/test-impact.schema.js";

/**
 * M41-WU05 (build spec Sec 12, "Required dogfood scenarios"): a
 * disposable, fictional "acme-widgets"-style inventory (never AIQT's own
 * test suite, never AIQT self-managing AIQT). Every scenario asserts
 * real, measured behavior against the real WU41-01..04 implementation --
 * no fabricated outcome.
 */
const inventory: TestInventorySnapshot = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  entries: [
    { path: "tests/unit/auth.test.ts", layer: "unit", domain: "auth", criticality: "Critical" },
    { path: "tests/unit/auth-hardening.test.ts", layer: "unit", domain: "auth", criticality: "Critical" },
    { path: "tests/unit/billing.test.ts", layer: "unit", domain: "billing", criticality: "High-value" },
    { path: "tests/unit/billing-invoices.test.ts", layer: "unit", domain: "billing", criticality: "High-value" },
    { path: "tests/unit/notifications.test.ts", layer: "unit", domain: "notifications", criticality: "Normal" },
    { path: "tests/integration/checkout-flow.test.ts", layer: "integration", domain: "checkout", criticality: "High-value" },
    { path: "tests/unit/catalog.test.ts", layer: "unit", domain: "catalog", criticality: "Normal" },
    { path: "tests/unit/util.test.ts", layer: "unit", domain: "shared", criticality: "Normal" },
  ],
};

function input(overrides: Partial<TestImpactInput> = {}): TestImpactInput {
  return {
    workUnitId: "wu-acme-1",
    scopedFiles: [],
    changedFiles: [],
    explicitValidationCommands: [],
    inventory,
    priorFeedback: [],
    ...overrides,
  };
}

describe("M41-WU05 dogfood: adaptive test selection on a disposable fixture inventory", () => {
  // 1. localized source change selects the directly impacted focused test(s).
  it("scenario 1: a localized auth.ts change selects auth.test.ts and auth-hardening.test.ts, not the whole inventory", () => {
    const result = selectTestImpactWithFeedback(input({ scopedFiles: ["src/auth.ts"] }));
    const ids = result.selection.selectedTargets.map((t) => t.target.id);
    expect(ids).toContain("test_file:tests/unit/auth.test.ts");
    expect(ids).toContain("test_file:tests/unit/auth-hardening.test.ts");
    expect(ids).not.toContain("test_file:tests/unit/billing.test.ts");
    expect(result.selection.escalation).toBe("selected_impacted"); // scoped source evidence (not a changed test itself) -> impacted, not focused
  });

  // 2. changed test file selects itself/its runnable target.
  it("scenario 2: a changed test file selects itself with reason changed_test", () => {
    const result = selectTestImpactWithFeedback(input({ changedFiles: ["tests/unit/billing.test.ts"] }));
    const t = result.selection.selectedTargets.find((s) => s.target.id === "test_file:tests/unit/billing.test.ts");
    expect(t?.reasonCodes).toContain("changed_test");
  });

  // 3. explicit required validation remains selected even if structural impact evidence would omit it.
  it("scenario 3: an explicit validationCommand stays mandatory even when scoped evidence has no test match at all", () => {
    const result = selectTestImpactWithFeedback(
      input({ explicitValidationCommands: ["pnpm typecheck"], scopedFiles: ["src/totally-unrelated-blob.ts"] }),
    );
    expect(result.selection.mandatoryTargetIds).toEqual(["validation_command:pnpm typecheck"]);
    expect(result.selection.selectedTargets[0]?.mandatory).toBe(true);
  });

  // 4. direct/shared dependency change selects multiple impacted tests.
  it("scenario 4: a shared billing.ts change selects both billing.test.ts and billing-invoices.test.ts", () => {
    const result = selectTestImpactWithFeedback(input({ changedFiles: ["src/billing.ts"] }));
    const ids = result.selection.selectedTargets.map((t) => t.target.id);
    expect(ids).toContain("test_file:tests/unit/billing.test.ts");
    expect(ids).toContain("test_file:tests/unit/billing-invoices.test.ts");
  });

  // 5. unsupported/dynamic/ambiguous dependency evidence lowers confidence and broadens.
  it("scenario 5: a dynamic-plugin-loader-style change with no naming-convention match lowers confidence and broadens", () => {
    const result = selectTestImpactWithFeedback(input({ scopedFiles: ["src/dynamic-plugin-loader.ts"] }));
    expect(result.selection.escalation).toBe("broaden_required");
    expect(result.selection.confidence).not.toBe("high");
    expect(result.selection.evidenceGaps.some((g) => g.code === "NO-CONVENTION-MATCH")).toBe(true);
  });

  // 6. test/validation infrastructure change escalates according to M39 broad/full policy.
  it("scenario 6: a change to test infrastructure (tests/workload-timeout-policy.ts) escalates to full_required", () => {
    const result = selectTestImpactWithFeedback(input({ changedFiles: ["tests/workload-timeout-policy.ts"] }));
    expect(result.selection.escalation).toBe("full_required");
    expect(result.selection.recommendedTier).toBe("full");
    expect(result.selection.fullSuiteDeferred).toBe(false);
  });

  // 7. prior relevant failure is promoted in the next bounded selection.
  it("scenario 7: a trusted prior failure for notifications.test.ts is promoted even though nothing else touches it", () => {
    const feedback: ValidationFeedbackRef = {
      targetId: "test_file:tests/unit/notifications.test.ts",
      outcome: "failed",
      workUnitId: "wu-acme-1",
      changeIdentity: "chk-current",
      durationMs: null,
      failureCategory: null,
      evidenceTimestamp: "2026-01-01T00:00:00.000Z",
      evidenceSource: "checkpoint:chk-current",
    };
    const result = selectTestImpactWithFeedback(input({ scopedFiles: ["src/auth.ts"], priorFeedback: [feedback], currentChangeIdentity: "chk-current" }));
    const promoted = result.selection.selectedTargets.find((t) => t.target.id === "test_file:tests/unit/notifications.test.ts");
    expect(promoted).toBeDefined();
    expect(promoted?.reasonCodes).toContain("prior_relevant_failure");
    expect(result.selection.escalation).toBe("broaden_required");
  });

  // 8. stale/mismatched prior feedback is ignored as verified evidence.
  it("scenario 8: the same failure, but from a mismatched change, is rejected and never promoted", () => {
    const feedback: ValidationFeedbackRef = {
      targetId: "test_file:tests/unit/notifications.test.ts",
      outcome: "failed",
      workUnitId: "wu-acme-1",
      changeIdentity: "chk-stale-old-attempt",
      durationMs: null,
      failureCategory: null,
      evidenceTimestamp: "2020-01-01T00:00:00.000Z",
      evidenceSource: "checkpoint:chk-stale-old-attempt",
    };
    const result = selectTestImpactWithFeedback(input({ scopedFiles: ["src/auth.ts"], priorFeedback: [feedback], currentChangeIdentity: "chk-current" }));
    expect(result.trustedFeedbackCount).toBe(0);
    expect(result.rejectedFeedback).toHaveLength(1);
    expect(result.selection.selectedTargets.find((t) => t.target.id === "test_file:tests/unit/notifications.test.ts")).toBeUndefined();
    expect(result.selection.escalation).toBe("selected_impacted"); // scoped source evidence (not a changed test itself) -> impacted, not focused
  });

  // 9. deterministic inputs produce identical selection digest/order.
  it("scenario 9: identical inputs produce an identical selection (digest, order, everything)", () => {
    const req = input({ scopedFiles: ["src/auth.ts"], changedFiles: ["src/billing.ts"], explicitValidationCommands: ["pnpm typecheck"] });
    const a = selectTestImpactWithFeedback(req);
    const b = selectTestImpactWithFeedback({ ...req });
    expect(a.selection).toEqual(b.selection);
    expect(a.selection.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // 10. human/JSON/execution-guidance surfaces agree substantively.
  it("scenario 10: the compact human render, the rich explain render, and the JSON guidance all report the same confidence/escalation", () => {
    const guidance = composeExecutionGuidance({
      workUnitId: "wu-acme-1",
      workUnit: { objective: "Add invoice retry", scope: [], outOfScope: [], acceptanceCriteria: [], suggestedFiles: [], dependencies: [] },
      testImpactInput: input({ changedFiles: ["src/billing.ts"] }),
    });
    const impact = guidance.validation.testImpact;
    expect(impact).not.toBeNull();
    const human = renderExecutionGuidanceHuman(guidance);
    const explain = renderTestImpactExplain(guidance);
    expect(human).toContain(`Test impact: ${impact?.confidence} confidence`);
    expect(human).toContain(`-> ${impact?.escalation}`);
    expect(explain).toContain(`Confidence: ${impact?.confidence}`);
    expect(explain).toContain(`Escalation: ${impact?.escalation}`);
  });

  // 11. multi-WU flow: baseline vs selected/repeated test count, honestly measured.
  it("scenario 11: a 4-WU flow (including a repeated auth touch) demonstrates >=30% reduction vs the naive 'run everything every WU' baseline", () => {
    const flow = [
      { workUnitId: "wu-A", scopedFiles: ["src/auth.ts"] },
      { workUnitId: "wu-B", scopedFiles: ["src/billing.ts"] },
      { workUnitId: "wu-C", scopedFiles: ["src/auth.ts"] }, // repeated domain -- same targets as wu-A, not the whole suite again
      { workUnitId: "wu-D", changedFiles: ["tests/unit/catalog.test.ts"] },
    ];
    const planningStart = performance.now();
    const samples = flow.map((wu) => {
      const result = selectTestImpactWithFeedback(input({ workUnitId: wu.workUnitId, scopedFiles: wu.scopedFiles ?? [], changedFiles: wu.changedFiles ?? [] }));
      return { workUnitId: wu.workUnitId, candidateCount: result.selection.summary.candidateCount, selectedCount: result.selection.summary.selectedCount };
    });
    const planningOverheadMs = performance.now() - planningStart;

    const efficiency = computeMultiWorkUnitSelectionEfficiency(samples);
    console.log(
      `[M41 dogfood] multi-WU selection reduction: ${(efficiency.reductionRatio * 100).toFixed(1)}% ` +
        `(baseline=${efficiency.totalCandidateExecutions}, selected=${efficiency.totalSelectedExecutions}, meetsTarget=${efficiency.meetsThirtyPercentTarget}, ` +
        `planningOverheadMs=${planningOverheadMs.toFixed(2)})`,
    );
    // wu-A and wu-C select the identical target set for the same domain -- a real repeated-selection avoidance signal (never re-selecting the whole suite for a repeated touch).
    const wuASelection = selectTestImpactWithFeedback(input({ workUnitId: "wu-A", scopedFiles: ["src/auth.ts"] })).selection;
    const wuCSelection = selectTestImpactWithFeedback(input({ workUnitId: "wu-C", scopedFiles: ["src/auth.ts"] })).selection;
    expect(wuCSelection.selectedTargets.map((t) => t.target.id)).toEqual(wuASelection.selectedTargets.map((t) => t.target.id));

    expect(efficiency.totalSelectedExecutions).toBeLessThan(efficiency.totalCandidateExecutions);
    expect(efficiency.meetsThirtyPercentTarget).toBe(true);
    expect(planningOverheadMs).toBeLessThan(50); // planning itself must not become the bottleneck it's trying to reduce
  });

  // 12. intentionally seeded in-scope regressions are detected; never traded away for the metric.
  it("scenario 12: a seeded regression in billing-invoices.test.ts is present in every relevant selection across the flow -- never dropped to hit the reduction target", () => {
    const seededRegressionTargetId = "test_file:tests/unit/billing-invoices.test.ts";
    const viaChange = selectTestImpactWithFeedback(input({ changedFiles: ["src/billing.ts"] }));
    expect(viaChange.selection.selectedTargets.map((t) => t.target.id)).toContain(seededRegressionTargetId);

    const viaPriorFailure = selectTestImpactWithFeedback(
      input({
        scopedFiles: ["src/auth.ts"], // an unrelated WU
        priorFeedback: [
          {
            targetId: seededRegressionTargetId,
            outcome: "failed",
            workUnitId: "wu-acme-1",
            changeIdentity: "chk-current",
            durationMs: null,
            failureCategory: "seeded_regression",
            evidenceTimestamp: "2026-01-01T00:00:00.000Z",
            evidenceSource: "checkpoint:chk-current",
          },
        ],
        currentChangeIdentity: "chk-current",
      }),
    );
    expect(viaPriorFailure.selection.selectedTargets.map((t) => t.target.id)).toContain(seededRegressionTargetId);

    // Sanity: raw selectTestImpact (no feedback layer) never accidentally strips a directly-changed test either.
    const raw = selectTestImpact(input({ changedFiles: ["tests/unit/billing-invoices.test.ts"] }));
    expect(raw.selectedTargets.map((t) => t.target.id)).toContain(seededRegressionTargetId);
  });
});
