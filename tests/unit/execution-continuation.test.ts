import { describe, it, expect } from "vitest";
import { buildContinuationCapsule } from "../../src/workflow/execution-continuation.js";
import type { Checkpoint } from "../../src/schema/checkpoint.schema.js";

function checkpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: "cp-1",
    workUnitId: "WU-1",
    packetId: null,
    summary: "Did the thing.",
    completed: [],
    notCompleted: [],
    filesChanged: ["src/a.ts"],
    issues: [],
    validationResult: "passed",
    acceptanceCriteriaResult: "passed",
    validationCommands: [],
    acceptanceCriteria: [],
    finalWorkUnitStatus: "done",
    nextRecommendation: "proceed",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("execution-continuation (M39-WU02)", () => {
  it("is deterministic for identical input", () => {
    const input = { directDependencies: [{ workUnitId: "WU-1", checkpoint: checkpoint() }] };
    expect(buildContinuationCapsule(input)).toEqual(buildContinuationCapsule(input));
  });

  it("reuses checkpoint.summary/filesChanged/validationResult verbatim rather than a second source of truth", () => {
    const capsule = buildContinuationCapsule({
      directDependencies: [{ workUnitId: "WU-1", checkpoint: checkpoint({ summary: "Added X.", filesChanged: ["src/a.ts", "src/b.ts"] }) }],
    });
    expect(capsule.previousCheckpointSummary).toContain("Added X.");
    expect(capsule.filesChangedByDependencies).toEqual(["src/a.ts", "src/b.ts"]);
    expect(capsule.dependencyValidationResult).toContain("passed/passed");
  });

  it("carries forward only open issues, never resolved ones", () => {
    const capsule = buildContinuationCapsule({
      directDependencies: [
        {
          workUnitId: "WU-1",
          checkpoint: checkpoint({
            issues: [
              { title: "Open risk", description: null, severity: "medium", status: "open", agentCanFix: true },
              { title: "Resolved risk", description: null, severity: "low", status: "resolved", agentCanFix: true },
            ],
          }),
        },
      ],
    });
    expect(capsule.unresolvedIssueTitles).toEqual(["Open risk"]);
  });

  it("omits unrelated history: a dependency without a checkpoint yet contributes nothing", () => {
    const capsule = buildContinuationCapsule({
      directDependencies: [
        { workUnitId: "WU-1", checkpoint: checkpoint() },
        { workUnitId: "WU-2", checkpoint: null },
      ],
    });
    expect(capsule.previousCheckpointSummary).not.toContain("WU-2");
  });

  it("bounds a long joined summary deterministically rather than growing unbounded", () => {
    const longSummary = "x".repeat(2000);
    const capsule = buildContinuationCapsule({
      directDependencies: [{ workUnitId: "WU-1", checkpoint: checkpoint({ summary: longSummary }) }],
    });
    expect(capsule.previousCheckpointSummary!.length).toBeLessThanOrEqual(500);
  });

  it("is bounded/deterministic and never embeds full source file contents", () => {
    const capsule = buildContinuationCapsule({ directDependencies: [{ workUnitId: "WU-1", checkpoint: checkpoint() }] });
    expect(Object.keys(capsule).sort()).toEqual(
      ["carryForwardRefs", "dependencyValidationResult", "filesChangedByDependencies", "previousCheckpointSummary", "unresolvedIssueTitles"].sort(),
    );
  });

  it("dedupes and sorts carry-forward refs deterministically", () => {
    const capsule = buildContinuationCapsule({ directDependencies: [], carryForwardRefs: ["b", "a", "a"] });
    expect(capsule.carryForwardRefs).toEqual(["a", "b"]);
  });
});
