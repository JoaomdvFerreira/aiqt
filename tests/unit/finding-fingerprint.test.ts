import { describe, it, expect } from "vitest";
import { computeSourceFingerprint, mintEvidenceIssueKey } from "../../src/workflow/finding-fingerprint.js";

describe("computeSourceFingerprint (M22-WU06 / spec §6.1)", () => {
  it("is stable across repeated calls with identical input", () => {
    const input = { title: "Path traversal", summary: "s", relatedIds: ["WU001"], scopeClaim: "security" as const };
    expect(computeSourceFingerprint(input)).toBe(computeSourceFingerprint(input));
  });

  it("does not depend on relatedIds array order", () => {
    const a = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: ["WU001", "WU002"], scopeClaim: "project" as const });
    const b = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: ["WU002", "WU001"], scopeClaim: "project" as const });
    expect(a).toBe(b);
  });

  it("deduplicates repeated relatedIds", () => {
    const a = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: ["WU001", "WU001"], scopeClaim: "project" as const });
    const b = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: ["WU001"], scopeClaim: "project" as const });
    expect(a).toBe(b);
  });

  it("is insensitive to leading/trailing whitespace and letter case in title/summary", () => {
    const a = computeSourceFingerprint({ title: "  Title Here  ", summary: "Summary text", relatedIds: [], scopeClaim: "governance" as const });
    const b = computeSourceFingerprint({ title: "title here", summary: "summary text", relatedIds: [], scopeClaim: "governance" as const });
    expect(a).toBe(b);
  });

  it("produces a different fingerprint for a different scopeClaim", () => {
    const a = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: [], scopeClaim: "work_unit" as const });
    const b = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: [], scopeClaim: "milestone" as const });
    expect(a).not.toBe(b);
  });

  it("produces a different fingerprint for a different title", () => {
    const a = computeSourceFingerprint({ title: "Title A", summary: "s", relatedIds: [], scopeClaim: "project" as const });
    const b = computeSourceFingerprint({ title: "Title B", summary: "s", relatedIds: [], scopeClaim: "project" as const });
    expect(a).not.toBe(b);
  });

  it("returns a sha256 hex digest", () => {
    const fp = computeSourceFingerprint({ title: "t", summary: "s", relatedIds: [], scopeClaim: "project" as const });
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("mintEvidenceIssueKey (M22-WU06 / spec §6.1/§9)", () => {
  it("is deterministic for the same scope/title/occurrence", () => {
    expect(mintEvidenceIssueKey("security", "SQL injection", 0)).toBe(mintEvidenceIssueKey("security", "SQL injection", 0));
  });

  it("uses the evidence:<scope>:<slug> convention with no occurrence suffix at index 0", () => {
    expect(mintEvidenceIssueKey("security", "SQL injection", 0)).toBe("evidence:security:sql-injection");
  });

  it("appends a stable numeric suffix for occurrence index > 0", () => {
    expect(mintEvidenceIssueKey("security", "SQL injection", 1)).toBe("evidence:security:sql-injection-2");
    expect(mintEvidenceIssueKey("security", "SQL injection", 2)).toBe("evidence:security:sql-injection-3");
  });

  it("produces distinct keys for distinct scopes with the same title", () => {
    expect(mintEvidenceIssueKey("security", "Same title", 0)).not.toBe(mintEvidenceIssueKey("governance", "Same title", 0));
  });

  it("normalizes an empty/symbol-only title to the 'issue' fallback slug, matching checkpointIssueKey's own fallback", () => {
    expect(mintEvidenceIssueKey("project", "!!!", 0)).toBe("evidence:project:issue");
  });
});
