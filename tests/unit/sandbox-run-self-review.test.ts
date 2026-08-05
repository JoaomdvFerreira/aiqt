import { describe, it, expect } from "vitest";
import { reviewSandboxRun } from "../../src/workflow/sandbox-run-self-review.js";

describe("M38-WU04 sandbox-run-self-review", () => {
  it("no findings when at least one file changed", () => {
    const result = reviewSandboxRun({ filesChanged: ["README.md"] });
    expect(result.findings).toEqual([]);
    expect(result.hasUnresolvedCriticalFindings).toBe(false);
  });

  it("a 'no files changed' finding when the changed-file list is empty", () => {
    const result = reviewSandboxRun({ filesChanged: [] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatch(/no diff/i);
    expect(result.hasUnresolvedCriticalFindings).toBe(true);
  });
});
