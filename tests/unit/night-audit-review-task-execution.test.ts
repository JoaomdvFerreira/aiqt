import { describe, it, expect } from "vitest";
import {
  buildReviewTaskContextManifest,
  buildReviewTaskPacket,
  normalizeAuditFindingCandidate,
  upsertCoverageEntry,
  runStructuralCallThrough,
  REVIEW_TASK_MAX_CONTEXT_PATHS,
} from "../../src/workflow/night-audit-review-task-execution.js";
import type { ReviewTask, AuditFindingCandidateInput, NightAuditCoverageEntry } from "../../src/schema/night-audit.schema.js";
import type { RawStructuralReviewResult } from "../../src/workflow/structural-review-engine.js";

const SHA = "e".repeat(40);
const NOW = "2026-08-10T00:00:00.000Z";

function task(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return { taskId: "task-001", domain: "tests", scope: "src/workflow/", repositoryCommit: SHA, ...overrides };
}

describe("buildReviewTaskContextManifest (build spec Sec 5)", () => {
  it("includes safe, in-root paths", () => {
    const manifest = buildReviewTaskContextManifest(task(), ["src/workflow/a.ts", "src/workflow/b.ts"]);
    expect(manifest.items.map((i) => i.path)).toEqual(["src/workflow/a.ts", "src/workflow/b.ts"]);
    expect(manifest.warnings).toHaveLength(0);
  });

  it("excludes an absolute or traversal path and records a warning", () => {
    const manifest = buildReviewTaskContextManifest(task(), ["../outside.ts", "C:\\Windows\\evil.ts"]);
    expect(manifest.items).toHaveLength(0);
    expect(manifest.warnings.length).toBeGreaterThan(0);
  });

  it("deduplicates repeated paths", () => {
    const manifest = buildReviewTaskContextManifest(task(), ["src/workflow/a.ts", "src/workflow/a.ts"]);
    expect(manifest.items).toHaveLength(1);
  });

  it("bounds the manifest at REVIEW_TASK_MAX_CONTEXT_PATHS and warns when more are omitted", () => {
    const many = Array.from({ length: REVIEW_TASK_MAX_CONTEXT_PATHS + 5 }, (_, i) => `src/workflow/f${i}.ts`);
    const manifest = buildReviewTaskContextManifest(task(), many);
    expect(manifest.items).toHaveLength(REVIEW_TASK_MAX_CONTEXT_PATHS);
    expect(manifest.warnings.some((w) => w.includes("bounded"))).toBe(true);
  });
});

describe("buildReviewTaskPacket (build spec Sec 5/13)", () => {
  it("is a bounded, structured handoff -- never mentions modifying files without a read-only instruction", () => {
    const manifest = buildReviewTaskContextManifest(task(), ["src/workflow/a.ts"]);
    const packet = buildReviewTaskPacket(task(), manifest);
    expect(packet.taskId).toBe("task-001");
    expect(packet.expectedResultFormat).toBe("audit-finding-candidates@1");
    expect(packet.instructions.some((i) => i.toLowerCase().includes("read-only"))).toBe(true);
  });
});

describe("normalizeAuditFindingCandidate", () => {
  it("carries domain/reviewCommit/scope from the task, never from the candidate", () => {
    const candidate: AuditFindingCandidateInput = {
      checkId: "check-1",
      title: "Example",
      explanation: "Explanation",
      affectedPaths: ["src/workflow/a.ts"],
      evidence: [{ evidenceId: "ev-1", description: "d", locator: "src/workflow/a.ts:1" }],
      confidence: "strong_signal",
      significance: "medium",
      disposition: "actionable",
      recommendedNextAction: "Fix it.",
    };
    const finding = normalizeAuditFindingCandidate(candidate, task(), "sha256:" + "f".repeat(64));
    expect(finding.domain).toBe("tests");
    expect(finding.reviewCommit).toBe(SHA);
    expect(finding.scope).toBe("src/workflow/");
    expect(finding.findingKey).toBe("sha256:" + "f".repeat(64));
    expect(finding.checkId).toBe("check-1");
  });
});

describe("upsertCoverageEntry (build spec Sec 6)", () => {
  function entry(overrides: Partial<NightAuditCoverageEntry> = {}): NightAuditCoverageEntry {
    return { domain: "tests", scope: "src/workflow/", lastReviewedCommit: SHA, lastReviewedAt: NOW, outcomeSummary: "ok", findingsProduced: false, ...overrides };
  }

  it("adds a new entry when no (domain, scope) match exists", () => {
    const result = upsertCoverageEntry([], entry());
    expect(result).toHaveLength(1);
  });

  it("replaces the existing entry for the same (domain, scope), never appending a duplicate", () => {
    const existing = entry({ outcomeSummary: "stale" });
    const updated = entry({ outcomeSummary: "fresh" });
    const result = upsertCoverageEntry([existing], updated);
    expect(result).toHaveLength(1);
    expect(result[0].outcomeSummary).toBe("fresh");
  });

  it("leaves entries for other (domain, scope) pairs untouched", () => {
    const other = entry({ domain: "documentation", scope: "docs/" });
    const updated = entry({ outcomeSummary: "fresh" });
    const result = upsertCoverageEntry([other], updated);
    expect(result).toHaveLength(2);
  });
});

describe("runStructuralCallThrough (build spec Sec 3/5)", () => {
  it("returns an empty array for a domain with no structural overlap", () => {
    const candidates = runStructuralCallThrough(task({ domain: "documentation" }), "/repo", () => {
      throw new Error("must not be called for a non-overlapping domain");
    });
    expect(candidates).toEqual([]);
  });

  it("maps and scope-filters structural findings for an overlapping domain", () => {
    const fixture: RawStructuralReviewResult = {
      reviewCommit: SHA,
      domainsRequested: ["test_infrastructure"],
      domainsSupported: ["test_infrastructure"],
      domainsUnsupported: [],
      findings: [
        {
          findingKey: "sha256:" + "1".repeat(64),
          domain: "test_infrastructure",
          ruleId: "process-heavy-timeout",
          title: "In-scope finding",
          explanation: "explanation",
          reviewCommit: SHA,
          affectedPaths: ["src/workflow/heavy.test.ts"],
          evidence: [{ evidenceId: "ev-1", description: "d", locator: "src/workflow/heavy.test.ts:1" }],
          confidence: "proven",
          significance: "high",
          reasonCodes: [],
          evidenceGaps: [],
          disposition: "actionable",
          eligibleForIntake: true,
          recommendedNextAction: "Add a timeout.",
          providerSource: "repository-local",
        },
        {
          findingKey: "sha256:" + "2".repeat(64),
          domain: "test_infrastructure",
          ruleId: "process-heavy-timeout",
          title: "Out-of-scope finding",
          explanation: "explanation",
          reviewCommit: SHA,
          affectedPaths: ["src/services/other.test.ts"],
          evidence: [{ evidenceId: "ev-2", description: "d", locator: "src/services/other.test.ts:1" }],
          confidence: "proven",
          significance: "low",
          reasonCodes: [],
          evidenceGaps: [],
          disposition: "actionable",
          eligibleForIntake: true,
          recommendedNextAction: "Add a timeout.",
          providerSource: "repository-local",
        },
      ],
    };

    const candidates = runStructuralCallThrough(task({ domain: "tests", scope: "src/workflow/" }), "/repo", () => fixture);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].checkId).toBe("process-heavy-timeout");
    expect(candidates[0].title).toBe("In-scope finding");
    expect(candidates[0].confidence).toBe("proven");
  });
});
