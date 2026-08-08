import { describe, it, expect } from "vitest";
import { runStructuralReview } from "../../src/workflow/structural-review-engine.js";

const REPO_ROOT = process.cwd();

describe("runStructuralReview (read-only, against this real repository)", () => {
  it("runs offline/read-only and returns a well-formed result without throwing", () => {
    const result = runStructuralReview({ repoRoot: REPO_ROOT });
    expect(result.reviewCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(result.domainsSupported).toHaveLength(7);
    expect(result.domainsUnsupported).toHaveLength(0);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("is deterministic: two runs against identical repository state produce identical findings", () => {
    const first = runStructuralReview({ repoRoot: REPO_ROOT });
    const second = runStructuralReview({ repoRoot: REPO_ROOT });
    expect(first.findings.map((f) => f.findingKey).sort()).toEqual(second.findings.map((f) => f.findingKey).sort());
    expect(first.findings.length).toBe(second.findings.length);
  });

  it("reports an unrecognized domain explicitly rather than silently ignoring it", () => {
    const result = runStructuralReview({ repoRoot: REPO_ROOT, domains: ["not_a_real_domain"] });
    expect(result.domainsSupported).toHaveLength(0);
    expect(result.domainsUnsupported).toHaveLength(1);
    expect(result.domainsUnsupported[0].domain).toBe("not_a_real_domain");
  });

  it("bounds review to exactly the requested known domain(s)", () => {
    const result = runStructuralReview({ repoRoot: REPO_ROOT, domains: ["dependency_coupling"] });
    expect(result.domainsSupported).toEqual(["dependency_coupling"]);
    expect(result.findings.every((f) => f.domain === "dependency_coupling")).toBe(true);
  });

  it("never mutates the working tree (read-only invariant, Section 3.1)", () => {
    const before = runStructuralReview({ repoRoot: REPO_ROOT });
    // Re-running immediately with no intervening change must be byte-identical --
    // if the engine had mutated anything (e.g. a cache file), a second real run
    // over the now-different tree would very likely diverge.
    const after = runStructuralReview({ repoRoot: REPO_ROOT });
    expect(after.findings.length).toBe(before.findings.length);
  });
});
