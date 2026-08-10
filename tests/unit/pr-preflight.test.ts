import { describe, it, expect } from "vitest";
import { evaluatePrPreflight, type PrPreflightObservations } from "../../src/workflow/pr-preflight.js";
import { MAX_PR_REVIEWERS } from "../../src/schema/pull-request-integration.schema.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** A repository/remote/provider state in which every gate passes. Each test perturbs exactly one fact. */
function healthy(overrides: Partial<PrPreflightObservations> = {}): PrPreflightObservations {
  return {
    targetIsAiqtRepository: false,
    insideWorkTree: true,
    worktreeClean: true,
    untrackedFileCount: 0,
    currentBranch: "feature/x",
    sourceBranch: "feature/x",
    baseBranch: "main",
    sourceHeadSha: SHA_A,
    plannedSha: null,
    remoteName: "origin",
    remoteIdentity: "acme/widget",
    remoteDefaultBranch: "main",
    remoteBasePresence: "present",
    remoteSourcePresence: "absent",
    remoteSourceSha: null,
    remoteSourceIsAncestorOfPlanned: null,
    providerIdentity: "acme/widget",
    credentialsAvailable: true,
    baseProtection: "unprotected",
    requireProtectedBase: false,
    reviewers: [],
    createMode: "draft",
    ...overrides,
  };
}

function ids(findings: { id: string }[]): string[] {
  return findings.map((f) => f.id);
}

describe("M47-WU02 preflight: a clean, correctly-configured state passes every gate", () => {
  it("allows push and create with no blocking findings", () => {
    const result = evaluatePrPreflight(healthy());
    expect(result.blocking).toEqual([]);
    expect(result.pushAllowed).toBe(true);
    expect(result.createAllowed).toBe(true);
  });
});

describe("M47-WU02 preflight: repository and working-tree gates (build spec Sec 8.1-8.3)", () => {
  it("blocks when the target is the AIQT product repository itself", () => {
    const result = evaluatePrPreflight(healthy({ targetIsAiqtRepository: true }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-SELF-MANAGEMENT");
    expect(result.pushAllowed).toBe(false);
  });

  it("blocks when the path is not a Git working tree", () => {
    expect(ids(evaluatePrPreflight(healthy({ insideWorkTree: false })).blocking)).toContain("PR-PREFLIGHT-NOT-A-REPOSITORY");
  });

  it("blocks a dirty working tree", () => {
    const result = evaluatePrPreflight(healthy({ worktreeClean: false }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-WORKTREE-DIRTY");
    expect(result.pushAllowed).toBe(false);
  });

  it("blocks when cleanliness could not be determined at all (unknown is never treated as clean)", () => {
    expect(ids(evaluatePrPreflight(healthy({ worktreeClean: null })).blocking)).toContain("PR-PREFLIGHT-WORKTREE-UNKNOWN");
  });

  it("blocks untracked files", () => {
    expect(ids(evaluatePrPreflight(healthy({ untrackedFileCount: 2 })).blocking)).toContain("PR-PREFLIGHT-UNTRACKED-FILES");
  });
});

describe("M47-WU02 preflight: branch gates (build spec Sec 8.4-8.6)", () => {
  it("blocks when the source branch is not the checked-out branch", () => {
    expect(ids(evaluatePrPreflight(healthy({ currentBranch: "main" })).blocking)).toContain("PR-PREFLIGHT-SOURCE-NOT-CHECKED-OUT");
  });

  it("blocks a detached HEAD (empty current branch is never assumed to be the source branch)", () => {
    expect(ids(evaluatePrPreflight(healthy({ currentBranch: "" })).blocking)).toContain("PR-PREFLIGHT-SOURCE-NOT-CHECKED-OUT");
  });

  it("blocks source == base", () => {
    expect(ids(evaluatePrPreflight(healthy({ sourceBranch: "main", currentBranch: "main" })).blocking)).toContain("PR-PREFLIGHT-SOURCE-EQUALS-BASE");
  });

  it("blocks pushing the remote default branch even when a different base was requested", () => {
    const result = evaluatePrPreflight(healthy({ sourceBranch: "trunk", currentBranch: "trunk", baseBranch: "release", remoteDefaultBranch: "trunk" }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-SOURCE-IS-DEFAULT-BRANCH");
  });
});

describe("M47-WU02 preflight: exact-SHA binding (build spec Sec 8.6)", () => {
  it("blocks when the source branch resolves to no commit", () => {
    expect(ids(evaluatePrPreflight(healthy({ sourceHeadSha: null })).blocking)).toContain("PR-PREFLIGHT-HEAD-UNRESOLVED");
  });

  it("blocks an abbreviated SHA", () => {
    expect(ids(evaluatePrPreflight(healthy({ sourceHeadSha: "abc1234" })).blocking)).toContain("PR-PREFLIGHT-HEAD-NOT-EXACT");
  });

  it("blocks when local HEAD moved away from the plan's bound SHA", () => {
    const result = evaluatePrPreflight(healthy({ plannedSha: SHA_A, sourceHeadSha: SHA_B }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-HEAD-MOVED");
    expect(result.pushAllowed).toBe(false);
  });

  it("accepts a plan whose bound SHA still matches local HEAD", () => {
    expect(evaluatePrPreflight(healthy({ plannedSha: SHA_A, sourceHeadSha: SHA_A })).blocking).toEqual([]);
  });
});

describe("M47-WU02 preflight: remote and provider identity (build spec Sec 8.7, Sec 9)", () => {
  it("blocks when the remote is missing or is not a GitHub remote", () => {
    expect(ids(evaluatePrPreflight(healthy({ remoteIdentity: null })).blocking)).toContain("PR-PREFLIGHT-REMOTE-IDENTITY-UNRESOLVED");
  });

  it("blocks with an actionable finding when credentials are unavailable", () => {
    const result = evaluatePrPreflight(healthy({ credentialsAvailable: false, providerIdentity: null }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-MISSING-CREDENTIALS");
    expect(result.blocking.find((f) => f.id === "PR-PREFLIGHT-MISSING-CREDENTIALS")?.suggestedAction).toMatch(/--token-env/);
  });

  it("blocks when identity could not be verified -- 'could not verify' is never 'verified'", () => {
    expect(ids(evaluatePrPreflight(healthy({ providerIdentity: null })).blocking)).toContain("PR-PREFLIGHT-IDENTITY-UNVERIFIED");
  });

  it("blocks when the remote points at a different repository than the provider reports", () => {
    const result = evaluatePrPreflight(healthy({ remoteIdentity: "acme/widget", providerIdentity: "evil/widget" }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-IDENTITY-MISMATCH");
  });

  it("accepts a case-only difference in owner/repo (GitHub identities are case-insensitive)", () => {
    expect(evaluatePrPreflight(healthy({ remoteIdentity: "ACME/Widget" })).blocking).toEqual([]);
  });
});

describe("M47-WU02 preflight: remote branch state and fast-forward-only (build spec Sec 8.8-8.10)", () => {
  it("blocks a missing remote base branch", () => {
    expect(ids(evaluatePrPreflight(healthy({ remoteBasePresence: "absent" })).blocking)).toContain("PR-PREFLIGHT-REMOTE-BASE-MISSING");
  });

  it("blocks an unverifiable remote base branch", () => {
    expect(ids(evaluatePrPreflight(healthy({ remoteBasePresence: "unverifiable" })).blocking)).toContain("PR-PREFLIGHT-REMOTE-BASE-UNVERIFIABLE");
  });

  it("allows an absent remote source branch (the create-style push case)", () => {
    expect(evaluatePrPreflight(healthy({ remoteSourcePresence: "absent" })).blocking).toEqual([]);
  });

  it("blocks an unverifiable remote source branch -- it is never treated as absent", () => {
    const result = evaluatePrPreflight(healthy({ remoteSourcePresence: "unverifiable" }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-REMOTE-SOURCE-UNVERIFIABLE");
    expect(result.pushAllowed).toBe(false);
  });

  it("allows a behind remote source branch (fast-forward)", () => {
    const result = evaluatePrPreflight(healthy({ remoteSourcePresence: "present", remoteSourceSha: SHA_B, remoteSourceIsAncestorOfPlanned: true }));
    expect(result.blocking).toEqual([]);
    expect(result.pushAllowed).toBe(true);
  });

  it("blocks a diverged or ahead remote source branch, with no force option offered", () => {
    const result = evaluatePrPreflight(healthy({ remoteSourcePresence: "present", remoteSourceSha: SHA_B, remoteSourceIsAncestorOfPlanned: false }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-NOT-FAST-FORWARD");
    const message = result.blocking.find((f) => f.id === "PR-PREFLIGHT-NOT-FAST-FORWARD")!;
    expect(message.suggestedAction).toMatch(/no force or force-with-lease/i);
  });

  it("blocks when fast-forward safety could not be computed because the remote commit is not local", () => {
    const result = evaluatePrPreflight(healthy({ remoteSourcePresence: "present", remoteSourceSha: SHA_B, remoteSourceIsAncestorOfPlanned: null }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-FAST-FORWARD-UNVERIFIABLE");
  });

  it("reports a remote already at the planned SHA as a no-op warning, not a block", () => {
    const result = evaluatePrPreflight(healthy({ remoteSourcePresence: "present", remoteSourceSha: SHA_A, remoteSourceIsAncestorOfPlanned: true }));
    expect(result.blocking).toEqual([]);
    expect(result.remoteAlreadyAtPlannedSha).toBe(true);
    expect(ids(result.warnings)).toContain("PR-PREFLIGHT-REMOTE-ALREADY-AT-PLANNED-SHA");
  });
});

describe("M47-WU02 preflight: protection policy is honest (build spec Sec 11)", () => {
  it("permits create when protection is required and verifiably protected", () => {
    expect(evaluatePrPreflight(healthy({ requireProtectedBase: true, baseProtection: "protected" })).createAllowed).toBe(true);
  });

  for (const evidence of ["unprotected", "unverifiable", "unsupported"] as const) {
    it(`blocks create when protection is required but evidence is "${evidence}"`, () => {
      const result = evaluatePrPreflight(healthy({ requireProtectedBase: true, baseProtection: evidence }));
      expect(ids(result.blocking)).toContain("PR-PREFLIGHT-BASE-NOT-PROTECTED");
      expect(result.createAllowed).toBe(false);
      // A protection requirement is a create-time gate: the push itself is
      // still permitted, since pushing a source branch does not touch the
      // protected base.
      expect(result.pushAllowed).toBe(true);
    });
  }

  it("reports unverifiable protection as a warning, never as unprotected, when protection is not required", () => {
    const result = evaluatePrPreflight(healthy({ baseProtection: "unverifiable" }));
    expect(result.blocking).toEqual([]);
    expect(ids(result.warnings)).toContain("PR-PREFLIGHT-PROTECTION-UNVERIFIABLE");
    expect(ids(result.warnings)).not.toContain("PR-PREFLIGHT-BASE-UNPROTECTED");
  });
});

describe("M47-WU02 preflight: reviewers and create intent", () => {
  it("blocks a reviewer set beyond the bound", () => {
    const many = Array.from({ length: MAX_PR_REVIEWERS + 1 }, (_, i) => `user${i}`);
    const result = evaluatePrPreflight(healthy({ reviewers: many }));
    expect(ids(result.blocking)).toContain("PR-PREFLIGHT-TOO-MANY-REVIEWERS");
    // Reviewer assignment is a create-time concern; the push is unaffected.
    expect(result.pushAllowed).toBe(true);
    expect(result.createAllowed).toBe(false);
  });

  it("surfaces explicit ready intent as a warning so it is never silent", () => {
    expect(ids(evaluatePrPreflight(healthy({ createMode: "ready" })).warnings)).toContain("PR-PREFLIGHT-READY-INTENT");
  });

  it("draft mode produces no ready warning", () => {
    expect(ids(evaluatePrPreflight(healthy()).warnings)).not.toContain("PR-PREFLIGHT-READY-INTENT");
  });
});
