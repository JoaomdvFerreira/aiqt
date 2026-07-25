import { describe, it, expect } from "vitest";
import { ArtifactKindSchema, TrustLevelSchema, TRUST_LEVEL_ORDER } from "../../src/schema/evidence.schema.js";

/**
 * M28-WU01 Gate H: pins the exact evidence taxonomy/trust values this
 * audit confirmed against source, so a future accidental change to
 * ArtifactKindSchema/TrustLevelSchema is caught immediately rather than
 * silently invalidating M28's Gate H conclusion.
 */
describe("M28-WU01: Gate H evidence-semantics audit pins", () => {
  it("ArtifactReference.kind is exactly the seven confirmed canonical values", () => {
    expect(ArtifactKindSchema.options).toEqual(["log", "report", "screenshot", "test_result", "ci_run", "diff", "other"]);
  });

  it("trust levels are exactly the four confirmed canonical values, in ordinal order", () => {
    expect(TrustLevelSchema.options).toEqual(["unverified", "self_reported", "repository_local", "platform_verified"]);
    expect(TRUST_LEVEL_ORDER).toEqual({ unverified: 0, self_reported: 1, repository_local: 2, platform_verified: 3 });
  });
});
