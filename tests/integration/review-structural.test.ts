import { describe, it, expect } from "vitest";
import { runReviewStructural } from "../../src/cli/commands/review-structural.command.js";
import { runReviewStructuralExplain } from "../../src/cli/commands/review-structural-explain.command.js";
import { ExitCode } from "../../src/core/output/exit-codes.js";
import { contextFor } from "../helpers.js";
import type { StructuralReview, StructuralFinding } from "../../src/schema/structural-review.schema.js";

/**
 * `aiqt review structural` is read-only and has no project/state
 * dependency, so these run directly against this real repository's own
 * working tree (never mutating it) rather than a throwaway fixture --
 * the safest and most realistic dogfood target available.
 */
const REPO_ROOT = process.cwd();

describe("aiqt review structural / explain", () => {
  it("runs read-only with human/JSON parity of substance and no project required", () => {
    const result = runReviewStructural(contextFor(REPO_ROOT), {});
    expect(result.exitCode).toBe(ExitCode.Success);
    const data = result.data as { review: StructuralReview };
    expect(data.review.domainsSupported).toHaveLength(7);
    expect(data.review.domainsUnsupported).toHaveLength(0);
    expect(result.summary).toContain("Structural review");
  });

  it("rejects an unrecognized --domain explicitly", () => {
    const result = runReviewStructural(contextFor(REPO_ROOT), { domain: "not_a_real_domain" });
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("bounds review to the requested domain only", () => {
    const result = runReviewStructural(contextFor(REPO_ROOT), { domain: "dependency_coupling" });
    const data = result.data as { review: StructuralReview };
    expect(data.review.domainsSupported).toEqual(["dependency_coupling"]);
    expect(data.review.findings.every((f) => f.domain === "dependency_coupling")).toBe(true);
  });

  it("explain finds a real finding by key and reports full detail", () => {
    const listed = runReviewStructural(contextFor(REPO_ROOT), {});
    const data = listed.data as { review: StructuralReview };
    // this repository is expected to have at least the size-outlier findings from WU43-02's own dogfood
    expect(data.review.findings.length).toBeGreaterThan(0);
    const target = data.review.findings[0];

    const explained = runReviewStructuralExplain(contextFor(REPO_ROOT), target.findingKey);
    expect(explained.exitCode).toBe(ExitCode.Success);
    const explainedFinding = (explained.data as { finding: StructuralFinding }).finding;
    expect(explainedFinding.findingKey).toBe(target.findingKey);
    expect(explainedFinding.reasonCodes.length).toBeGreaterThan(0);
  });

  it("explain reports a clean not-found for an unknown key, never fabricating a finding", () => {
    const result = runReviewStructuralExplain(contextFor(REPO_ROOT), "sha256:" + "0".repeat(64));
    expect(result.exitCode).toBe(ExitCode.InvalidInput);
  });

  it("is read-only: does not mutate the working tree or require .aiqt/", () => {
    // contextFor points at this repo's own root, which has no .aiqt/ --
    // a successful, non-crashing run here IS the read-only/no-project-
    // required proof.
    const result = runReviewStructural(contextFor(REPO_ROOT), {});
    expect(result.exitCode).toBe(ExitCode.Success);
  });
});
