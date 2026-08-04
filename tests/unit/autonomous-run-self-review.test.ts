import { describe, it, expect } from "vitest";
import { reviewAutonomousRun } from "../../src/workflow/autonomous-run-self-review.js";
import type { AutonomousBudgets, AutonomousDiffSummary } from "../../src/schema/autonomous-run.schema.js";
import type { AutonomousValidationResult } from "../../src/services/autonomous-run-validation-service.js";

/**
 * M36-WU04 (build spec Sec 7 WU36-04 acceptance criterion: "review
 * findings are surfaced"). Pure unit tests -- no I/O, no subprocess.
 */
describe("reviewAutonomousRun (M36-WU04, pure)", () => {
  const budgets: AutonomousBudgets = {
    maxWallClockSeconds: 60,
    maxCommandCount: 10,
    maxRetryCount: 3,
    maxChangedFiles: 5,
    maxDiffLines: 100,
    maxValidationSeconds: 60,
  };

  const cleanDiff: AutonomousDiffSummary = { changedFiles: 1, insertedLines: 2, deletedLines: 1, unexpectedFiles: [] };
  const passedValidation: AutonomousValidationResult = {
    targetedTestsPassed: true,
    authoritativeValidationPassed: null,
    durationSeconds: 1,
    commandsExecuted: ["npm test"],
    blockedReason: null,
  };

  it("produces no findings and a clean verdict for a passing, in-budget, expected-scope run", () => {
    const result = reviewAutonomousRun({ diffSummary: cleanDiff, validation: passedValidation, budgets });
    expect(result.findings).toEqual([]);
    expect(result.hasUnresolvedCriticalFindings).toBe(false);
  });

  it("flags targeted validation not passing", () => {
    const result = reviewAutonomousRun({
      diffSummary: cleanDiff,
      validation: { ...passedValidation, targetedTestsPassed: false },
      budgets,
    });
    expect(result.hasUnresolvedCriticalFindings).toBe(true);
    expect(result.findings[0]).toMatch(/targeted validation did not pass/i);
  });

  it("flags an empty targeted-commands list as not validated, never vacuously passed", () => {
    const notValidated: AutonomousValidationResult = {
      targetedTestsPassed: false,
      authoritativeValidationPassed: null,
      durationSeconds: 0,
      commandsExecuted: [],
      blockedReason: null,
    };
    const result = reviewAutonomousRun({ diffSummary: cleanDiff, validation: notValidated, budgets });
    expect(result.hasUnresolvedCriticalFindings).toBe(true);
  });

  it("flags authoritative validation having failed", () => {
    const result = reviewAutonomousRun({
      diffSummary: cleanDiff,
      validation: { ...passedValidation, authoritativeValidationPassed: false },
      budgets,
    });
    expect(result.findings.some((f) => /authoritative validation.*failed/i.test(f))).toBe(true);
  });

  it("flags a blocked validation with the blocking reason included verbatim", () => {
    const result = reviewAutonomousRun({
      diffSummary: cleanDiff,
      validation: { ...passedValidation, blockedReason: "network command denied" },
      budgets,
    });
    expect(result.findings.some((f) => f.includes("network command denied"))).toBe(true);
  });

  it("flags unexpected files changed outside the declared repair scope, naming them", () => {
    const result = reviewAutonomousRun({
      diffSummary: { ...cleanDiff, unexpectedFiles: ["pnpm-lock.yaml"] },
      validation: passedValidation,
      budgets,
    });
    expect(result.findings.some((f) => f.includes("pnpm-lock.yaml"))).toBe(true);
  });

  it("flags changed-file count over budget", () => {
    const result = reviewAutonomousRun({
      diffSummary: { ...cleanDiff, changedFiles: 6 },
      validation: passedValidation,
      budgets,
    });
    expect(result.findings.some((f) => /changed-file count/i.test(f))).toBe(true);
  });

  it("flags diff-line total (inserted+deleted) over budget", () => {
    const result = reviewAutonomousRun({
      diffSummary: { ...cleanDiff, insertedLines: 80, deletedLines: 30 },
      validation: passedValidation,
      budgets,
    });
    expect(result.findings.some((f) => /diff size/i.test(f))).toBe(true);
  });

  it("flags zero changed files as a no-op repair attempt", () => {
    const result = reviewAutonomousRun({
      diffSummary: { ...cleanDiff, changedFiles: 0 },
      validation: passedValidation,
      budgets,
    });
    expect(result.findings.some((f) => /no files were changed/i.test(f))).toBe(true);
  });

  it("returns findings in a fixed, deterministic order for identical inputs", () => {
    const input = {
      diffSummary: { changedFiles: 0, insertedLines: 0, deletedLines: 0, unexpectedFiles: ["pnpm-lock.yaml"] },
      validation: { ...passedValidation, targetedTestsPassed: false },
      budgets,
    };
    const first = reviewAutonomousRun(input);
    const second = reviewAutonomousRun(input);
    expect(first.findings).toEqual(second.findings);
    expect(first.findings[0]).toMatch(/targeted validation/i);
  });
});
