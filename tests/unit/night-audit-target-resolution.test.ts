import { describe, it, expect } from "vitest";
import { deriveReviewCandidates, computeScopeChangeFacts, computeRecentDefectSignalScopeKeys, HIGH_CHURN_LINE_THRESHOLD } from "../../src/workflow/night-audit-target-resolution.js";
import type { NightAuditCoverageEntry } from "../../src/schema/night-audit.schema.js";
import type { DefectRecord } from "../../src/schema/defect.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";
const SHA = "a".repeat(40);

describe("deriveReviewCandidates", () => {
  it("always includes repository_structure at scope '.' regardless of what exists", () => {
    const candidates = deriveReviewCandidates("/repo", () => false);
    expect(candidates).toContainEqual({ domain: "repository_structure", scope: "." });
  });

  it("includes only scopes that exist on disk", () => {
    const candidates = deriveReviewCandidates("/repo", (p) => p.endsWith("src"));
    expect(candidates.some((c) => c.domain === "code_quality" && c.scope === "src")).toBe(true);
    expect(candidates.some((c) => c.domain === "tests" && c.scope === "tests")).toBe(false);
  });

  it("never duplicates a (domain, scope) pair", () => {
    const candidates = deriveReviewCandidates("/repo", () => true);
    const keys = candidates.map((c) => `${c.domain}::${c.scope}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

function coverageEntry(overrides: Partial<NightAuditCoverageEntry> = {}): NightAuditCoverageEntry {
  return { domain: "code_quality", scope: "src", lastReviewedCommit: SHA, lastReviewedAt: NOW, outcomeSummary: "ok", findingsProduced: false, ...overrides };
}

describe("computeScopeChangeFacts", () => {
  it("never consults a candidate with no existing coverage entry (never-reviewed has no 'since' baseline)", () => {
    const facts = computeScopeChangeFacts("/repo", [{ domain: "code_quality", scope: "src" }], [], () => {
      throw new Error("must not be called for a candidate with no coverage entry");
    });
    expect(facts.changedScopeKeys.size).toBe(0);
  });

  it("marks a scope changed when the diff reports a file under it", () => {
    const facts = computeScopeChangeFacts("/repo", [{ domain: "code_quality", scope: "src" }], [coverageEntry()], () => "5\t2\tsrc/a.ts\n");
    expect(facts.changedScopeKeys.has("code_quality::src")).toBe(true);
  });

  it("ignores a changed file outside the candidate's scope", () => {
    const facts = computeScopeChangeFacts("/repo", [{ domain: "code_quality", scope: "src" }], [coverageEntry()], () => "5\t2\tdocs/a.md\n");
    expect(facts.changedScopeKeys.has("code_quality::src")).toBe(false);
  });

  it("marks high churn once total changed lines under the scope reach the threshold", () => {
    const line = `${HIGH_CHURN_LINE_THRESHOLD}\t0\tsrc/a.ts\n`;
    const facts = computeScopeChangeFacts("/repo", [{ domain: "code_quality", scope: "src" }], [coverageEntry()], () => line);
    expect(facts.highChurnScopeKeys.has("code_quality::src")).toBe(true);
  });

  it("does not mark high churn below the threshold", () => {
    const facts = computeScopeChangeFacts("/repo", [{ domain: "code_quality", scope: "src" }], [coverageEntry()], () => "1\t1\tsrc/a.ts\n");
    expect(facts.highChurnScopeKeys.has("code_quality::src")).toBe(false);
  });

  it("treats a diff it could not compute as unchanged, never fabricated as changed", () => {
    const facts = computeScopeChangeFacts(
      "/repo",
      [{ domain: "code_quality", scope: "src" }],
      [coverageEntry()],
      () => {
        throw new Error("commit not reachable");
      },
    );
    expect(facts.changedScopeKeys.size).toBe(0);
  });

  it("handles the root scope '.' by matching every path", () => {
    const facts = computeScopeChangeFacts("/repo", [{ domain: "repository_structure", scope: "." }], [coverageEntry({ domain: "repository_structure", scope: "." })], () => "1\t0\tanything/at/all.ts\n");
    expect(facts.changedScopeKeys.has("repository_structure::.")).toBe(true);
  });
});

function defect(overrides: Partial<DefectRecord> = {}): DefectRecord {
  return {
    defectId: "DEF-001",
    title: "t",
    summary: "s",
    sourceKind: "review_finding",
    evidenceRefs: [{ evidenceRefId: "E1", sourceKind: "review_finding", locator: "x", capturedAt: NOW }],
    fingerprint: "sha256:" + "1".repeat(64),
    severity: "medium",
    confidence: "probable",
    status: "candidate",
    freshness: { state: "current", evaluatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("computeRecentDefectSignalScopeKeys", () => {
  it("marks a candidate scope whose affectedFiles overlap a recently-updated defect", () => {
    const keys = computeRecentDefectSignalScopeKeys([{ domain: "code_quality", scope: "src" }], [defect({ affectedFiles: ["src/a.ts"], updatedAt: NOW })], NOW);
    expect(keys.has("code_quality::src")).toBe(true);
  });

  it("ignores a defect updated outside the recency window", () => {
    const old = "2026-01-01T00:00:00.000Z";
    const keys = computeRecentDefectSignalScopeKeys([{ domain: "code_quality", scope: "src" }], [defect({ affectedFiles: ["src/a.ts"], updatedAt: old })], NOW);
    expect(keys.has("code_quality::src")).toBe(false);
  });

  it("ignores a defect with no affectedFiles", () => {
    const keys = computeRecentDefectSignalScopeKeys([{ domain: "code_quality", scope: "src" }], [defect({ updatedAt: NOW })], NOW);
    expect(keys.has("code_quality::src")).toBe(false);
  });
});
