import { describe, it, expect } from "vitest";
import { buildReleaseCandidate, computeMilestoneEvidenceStatus, computeReleaseCandidateId, type ReleaseIntentInput } from "../../src/workflow/release-candidate.js";

const baseInput: ReleaseIntentInput = {
  repositoryIdentity: "example/widget",
  packageVersion: "1.2.0",
  schemaVersion: null,
  intendedReleaseTag: "v1.2.0",
  candidateCommit: "abc1234def5678",
  baseRelease: "v1.1.0",
  milestones: [
    {
      milestoneId: "m1",
      title: "Milestone One",
      status: "done",
      tag: "m1-tag",
      tagCommit: "abc1234def5678",
      closureCommit: "abc1234def5678",
    },
  ],
};

describe("buildReleaseCandidate: explicit intent required, fails closed on missing identity", () => {
  it("builds a candidate when identity and at least one milestone are present", () => {
    const result = buildReleaseCandidate(baseInput, () => "2026-01-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.candidateId).toBe(computeReleaseCandidateId("v1.2.0", "abc1234def5678"));
    expect(result.candidate.milestones).toHaveLength(1);
    expect(result.candidate.milestones[0]?.evidenceStatus).toBe("verified");
  });

  it("fails closed when repositoryIdentity is empty", () => {
    const result = buildReleaseCandidate({ ...baseInput, repositoryIdentity: "  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockingFindings.some((f) => f.id === "RELEASE-IDENTITY-MISSING-REPOSITORY")).toBe(true);
  });

  it("fails closed when packageVersion is not a valid semver", () => {
    const result = buildReleaseCandidate({ ...baseInput, packageVersion: "not-a-version" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockingFindings.some((f) => f.id === "RELEASE-IDENTITY-INVALID-PACKAGE-VERSION")).toBe(true);
  });

  it("fails closed when no milestones are included -- milestone completion alone can never create a candidate", () => {
    const result = buildReleaseCandidate({ ...baseInput, milestones: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockingFindings.some((f) => f.id === "RELEASE-CANDIDATE-NO-MILESTONES")).toBe(true);
  });

  it("fails closed when the candidate commit is not an unambiguous reference", () => {
    const result = buildReleaseCandidate({ ...baseInput, candidateCommit: "not a sha" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blockingFindings.some((f) => f.id === "RELEASE-IDENTITY-INVALID-COMMIT")).toBe(true);
  });

  it("supports multi-milestone candidates, preserving each milestone's own evidence", () => {
    const result = buildReleaseCandidate({
      ...baseInput,
      milestones: [
        baseInput.milestones[0]!,
        { milestoneId: "m2", title: "Milestone Two", status: "done", tag: null, tagCommit: null, closureCommit: null },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.milestones).toHaveLength(2);
    expect(result.candidate.milestones[1]?.evidenceStatus).toBe("missing");
  });
});

describe("computeMilestoneEvidenceStatus: never upgrades unverifiable facts to verified", () => {
  it("verified only when tag resolves and matches the declared closure commit", () => {
    expect(computeMilestoneEvidenceStatus({ milestoneId: "m", title: null, status: null, tag: "t", tagCommit: "abc", closureCommit: "abc" })).toBe("verified");
  });
  it("partial when tag resolves but closure commit is undeclared", () => {
    expect(computeMilestoneEvidenceStatus({ milestoneId: "m", title: null, status: null, tag: "t", tagCommit: "abc", closureCommit: null })).toBe("partial");
  });
  it("partial when tag resolves but mismatches the declared closure commit", () => {
    expect(computeMilestoneEvidenceStatus({ milestoneId: "m", title: null, status: null, tag: "t", tagCommit: "abc", closureCommit: "def" })).toBe("partial");
  });
  it("missing when a tag is declared but does not resolve", () => {
    expect(computeMilestoneEvidenceStatus({ milestoneId: "m", title: null, status: null, tag: "t", tagCommit: null, closureCommit: "abc" })).toBe("missing");
  });
  it("missing when no tag is declared at all", () => {
    expect(computeMilestoneEvidenceStatus({ milestoneId: "m", title: null, status: null, tag: null, tagCommit: null, closureCommit: null })).toBe("missing");
  });
});
