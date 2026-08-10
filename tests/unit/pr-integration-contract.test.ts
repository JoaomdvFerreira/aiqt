import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  PR_INTEGRATION_SCHEMA_VERSION,
  MAX_PR_REVIEWERS,
  PullRequestIntegrationPlanSchema,
  type PullRequestIntegrationPlan,
  type PullRequestPushRecord,
  type PullRequestRecord,
} from "../../src/schema/pull-request-integration.schema.js";
import {
  generatePrIntegrationId,
  isValidPrIntegrationId,
  isFullCommitSha,
  normalizeReviewers,
  reviewerCountExceedsLimit,
  computePrMetadataDigest,
  computePrWriteBindingDigest,
  writeBindingFactsFromPlan,
  evaluatePlanFreshness,
  describeStaleness,
  type PullRequestWriteBindingFacts,
} from "../../src/workflow/pr-integration-identity.js";
import {
  createIntegrationPlan,
  appendPlanAudit,
  recordPushOutcome,
  recordPullRequest,
  recordCreateAmbiguity,
  recordCreateFailure,
  recordReviewerRequest,
  recordBaseProtection,
  markPlanBlocked,
  recordStaleness,
  hasRecordedRemoteSideEffect,
  evaluatePlanCapability,
} from "../../src/workflow/pr-integration-lifecycle.js";

const NOW = "2026-08-10T00:00:00.000Z";
const LATER = "2026-08-10T01:00:00.000Z";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function baseFacts(overrides: Partial<PullRequestWriteBindingFacts> = {}): PullRequestWriteBindingFacts {
  return {
    provider: "github",
    repositoryRoot: resolve("/tmp/target-repo"),
    remoteName: "origin",
    remoteRepositoryIdentity: "acme/widget",
    baseBranch: "main",
    sourceBranch: "feature/x",
    sourceHeadSha: SHA_A,
    metadataDigest: computePrMetadataDigest({ title: "Add widget", body: "Body." }),
    reviewers: ["octocat"],
    createMode: "draft",
    policy: { requireProtectedBase: false },
    ...overrides,
  };
}

function buildPlan(overrides: Partial<PullRequestWriteBindingFacts> = {}): PullRequestIntegrationPlan {
  return createIntegrationPlan({
    id: "pri-1754784000000-0123abcd",
    now: NOW,
    facts: baseFacts(overrides),
    title: "Add widget",
    body: "Body.",
    portfolioRef: null,
  });
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe("M47-WU01 identity: integration ids are structurally fixed", () => {
  it("generated ids match the accepted pattern", () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidPrIntegrationId(generatePrIntegrationId())).toBe(true);
    }
  });

  it("rejects ids that could traverse out of the integration home", () => {
    for (const bad of ["../escape", "pri-1-0123abcd/../x", "pri-x-0123abcd", "pri-1-ZZZZZZZZ", "", "pri-1-0123abc", "plan-1-0123abcd"]) {
      expect(isValidPrIntegrationId(bad), `"${bad}" should be rejected`).toBe(false);
    }
  });

  it("only a full 40-hex commit SHA is accepted as an exact binding", () => {
    expect(isFullCommitSha(SHA_A)).toBe(true);
    expect(isFullCommitSha(SHA_A.toUpperCase())).toBe(true);
    expect(isFullCommitSha("abc1234")).toBe(false);
    expect(isFullCommitSha("HEAD")).toBe(false);
    expect(isFullCommitSha("refs/heads/main")).toBe(false);
  });
});

describe("M47-WU01 identity: reviewer normalization", () => {
  it("trims, drops empties, de-duplicates case-insensitively, and sorts", () => {
    expect(normalizeReviewers([" Octocat ", "octocat", "", "  ", "alice"])).toEqual(["alice", "Octocat"]);
  });

  it("reviewer order and casing never change the binding digest", () => {
    const a = computePrWriteBindingDigest(baseFacts({ reviewers: ["alice", "Bob"] }));
    const b = computePrWriteBindingDigest(baseFacts({ reviewers: ["BOB", "alice", "alice"] }));
    expect(a).toBe(b);
  });

  it("a genuinely different reviewer set does change the digest", () => {
    const a = computePrWriteBindingDigest(baseFacts({ reviewers: ["alice"] }));
    const b = computePrWriteBindingDigest(baseFacts({ reviewers: ["alice", "bob"] }));
    expect(a).not.toBe(b);
  });

  it("flags a reviewer set beyond the bound", () => {
    const many = Array.from({ length: MAX_PR_REVIEWERS + 1 }, (_, i) => `user${i}`);
    expect(reviewerCountExceedsLimit(many)).toBe(true);
    expect(reviewerCountExceedsLimit(many.slice(0, MAX_PR_REVIEWERS))).toBe(false);
  });
});

describe("M47-WU01 identity: PR metadata digest", () => {
  it("is stable for identical metadata and different for changed title or body", () => {
    const base = computePrMetadataDigest({ title: "T", body: "B" });
    expect(computePrMetadataDigest({ title: "T", body: "B" })).toBe(base);
    expect(computePrMetadataDigest({ title: "T2", body: "B" })).not.toBe(base);
    expect(computePrMetadataDigest({ title: "T", body: "B2" })).not.toBe(base);
  });

  it("is a sha256 digest in the repository's existing prefixed form (no second hashing scheme)", () => {
    expect(computePrMetadataDigest({ title: "T", body: "B" })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Freshness -- the gate every remote write depends on
// ---------------------------------------------------------------------------

describe("M47-WU01 freshness: a plan is fresh only when every write-relevant fact is unchanged", () => {
  it("an unchanged observation is fresh", () => {
    const plan = buildPlan();
    expect(evaluatePlanFreshness(plan, baseFacts())).toEqual({ fresh: true });
  });

  const staleCases: { label: string; override: Partial<PullRequestWriteBindingFacts>; fact: string }[] = [
    { label: "local HEAD moved", override: { sourceHeadSha: SHA_B }, fact: "sourceHeadSha" },
    { label: "source branch changed", override: { sourceBranch: "feature/y" }, fact: "sourceBranch" },
    { label: "base branch changed", override: { baseBranch: "develop" }, fact: "baseBranch" },
    { label: "remote identity changed", override: { remoteRepositoryIdentity: "evil/widget" }, fact: "remoteRepositoryIdentity" },
    { label: "remote name changed", override: { remoteName: "upstream" }, fact: "remoteName" },
    { label: "repository root changed", override: { repositoryRoot: resolve("/tmp/other-repo") }, fact: "repositoryRoot" },
    { label: "title/body digest changed", override: { metadataDigest: computePrMetadataDigest({ title: "New", body: "Body." }) }, fact: "metadataDigest" },
    { label: "reviewers changed", override: { reviewers: ["someone-else"] }, fact: "reviewers" },
    { label: "draft/ready intent changed", override: { createMode: "ready" }, fact: "createMode" },
    { label: "policy requirement changed", override: { policy: { requireProtectedBase: true } }, fact: "policy.requireProtectedBase" },
  ];

  for (const { label, override, fact } of staleCases) {
    it(`${label} makes the plan stale`, () => {
      const plan = buildPlan();
      const freshness = evaluatePlanFreshness(plan, baseFacts(override));
      expect(freshness.fresh).toBe(false);
      if (freshness.fresh) return;
      expect(freshness.changedFacts.map((c) => c.fact)).toContain(fact);
      expect(describeStaleness(freshness.changedFacts)).toContain(fact);
    });
  }

  it("branch names are compared case-sensitively (Git refs are case-sensitive)", () => {
    const plan = buildPlan();
    const freshness = evaluatePlanFreshness(plan, baseFacts({ sourceBranch: "Feature/X" }));
    expect(freshness.fresh).toBe(false);
  });

  it("repository identity is compared case-insensitively (GitHub owner/repo is)", () => {
    const plan = buildPlan();
    expect(evaluatePlanFreshness(plan, baseFacts({ remoteRepositoryIdentity: "ACME/Widget" }))).toEqual({ fresh: true });
  });

  it("a plan file edited in place to keep its fields self-consistent but with a stale digest is still rejected", () => {
    const plan = buildPlan();
    const tampered: PullRequestIntegrationPlan = { ...plan, sourceHeadSha: SHA_B, bindingDigest: plan.bindingDigest };
    const freshness = evaluatePlanFreshness(tampered, { ...baseFacts(), sourceHeadSha: SHA_B });
    expect(freshness.fresh).toBe(false);
    if (freshness.fresh) return;
    expect(freshness.changedFacts.map((c) => c.fact)).toContain("bindingDigest");
  });

  it("the binding digest is version-prefixed and sha256-shaped", () => {
    expect(computePrWriteBindingDigest(baseFacts())).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(PR_INTEGRATION_SCHEMA_VERSION).toBe("1.0.0");
  });

  it("writeBindingFactsFromPlan round-trips to the plan's own stored digest", () => {
    const plan = buildPlan();
    expect(computePrWriteBindingDigest(writeBindingFactsFromPlan(plan))).toBe(plan.bindingDigest);
  });
});

// ---------------------------------------------------------------------------
// Plan shape and lifecycle
// ---------------------------------------------------------------------------

describe("M47-WU01 plan: a freshly prepared plan records no remote side effect", () => {
  it("parses against its own schema and is `prepared` with all side-effect records null", () => {
    const plan = buildPlan();
    expect(PullRequestIntegrationPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.status).toBe("prepared");
    expect(plan.push).toBeNull();
    expect(plan.pullRequest).toBeNull();
    expect(plan.reviewerRequest).toBeNull();
    expect(plan.baseProtection).toBeNull();
    expect(hasRecordedRemoteSideEffect(plan)).toBe(false);
    expect(plan.auditLog.map((e) => e.event)).toEqual(["prepared"]);
  });

  it("rejects an unknown field (the schema is strict, so no silent contract drift)", () => {
    const plan = { ...buildPlan(), autoMerge: true } as unknown;
    expect(PullRequestIntegrationPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("draft is the default create mode captured by prepare", () => {
    expect(buildPlan().createMode).toBe("draft");
  });
});

const verifiedPush: PullRequestPushRecord = {
  attemptedAt: LATER,
  outcome: "verified",
  plannedSha: SHA_A,
  remoteShaAfter: SHA_A,
  remoteBranchPresenceBefore: "absent",
  detail: "Pushed exact planned SHA; remote re-read matches.",
};

const prRecord: PullRequestRecord = {
  number: 7,
  url: "https://github.com/acme/widget/pull/7",
  state: "open",
  isDraft: true,
  headSha: SHA_A,
  baseBranch: "main",
  sourceBranch: "feature/x",
  origin: "created",
  recordedAt: LATER,
};

describe("M47-WU01 lifecycle: a recorded remote side effect is never downgraded", () => {
  it("a verified push moves the plan to push_verified and unlocks create", () => {
    const plan = recordPushOutcome(buildPlan(), verifiedPush, LATER);
    expect(plan.status).toBe("push_verified");
    expect(evaluatePlanCapability(plan)).toMatchObject({ canPush: true, canCreate: true, requiresReconciliation: false });
  });

  it("an ambiguous push forbids every further write until it is reconciled", () => {
    const plan = recordPushOutcome(buildPlan(), { ...verifiedPush, outcome: "ambiguous", remoteShaAfter: null, detail: "Network error after write; remote state unknown." }, LATER);
    expect(plan.status).toBe("push_ambiguous");
    expect(evaluatePlanCapability(plan)).toMatchObject({ canPush: false, canCreate: false, requiresReconciliation: true });
  });

  it("a failed push leaves a prepared plan prepared and records no side effect", () => {
    const plan = recordPushOutcome(buildPlan(), { ...verifiedPush, outcome: "failed", remoteShaAfter: null, detail: "Remote rejected non-fast-forward." }, LATER);
    expect(plan.status).toBe("prepared");
    expect(plan.push?.outcome).toBe("failed");
  });

  it("a later failed push never erases an earlier verified push record", () => {
    const pushed = recordPushOutcome(buildPlan(), verifiedPush, LATER);
    const then = recordPushOutcome(pushed, { ...verifiedPush, outcome: "failed", remoteShaAfter: null, detail: "Later attempt rejected." }, LATER);
    expect(then.push).toEqual(verifiedPush);
    expect(then.status).toBe("push_verified");
  });

  it("blocking a plan that already pushed does not hide the side effect behind `blocked`", () => {
    const pushed = recordPushOutcome(buildPlan(), verifiedPush, LATER);
    const blocked = markPlanBlocked(pushed, LATER, "Policy refused.");
    expect(blocked.status).toBe("push_verified");
    expect(blocked.auditLog.at(-1)?.event).toBe("preflight_blocked");
  });

  it("blocking a plan with no side effect marks it blocked and terminal", () => {
    const blocked = markPlanBlocked(buildPlan(), LATER, "Dirty worktree.");
    expect(blocked.status).toBe("blocked");
    expect(evaluatePlanCapability(blocked)).toMatchObject({ canPush: false, canCreate: false });
  });

  it("staleness blocks a plan with no side effect but preserves a plan that already has one", () => {
    expect(recordStaleness(buildPlan(), LATER, "HEAD moved.").status).toBe("blocked");
    const pushed = recordPushOutcome(buildPlan(), verifiedPush, LATER);
    expect(recordStaleness(pushed, LATER, "HEAD moved.").status).toBe("push_verified");
  });
});

describe("M47-WU01 lifecycle: Pull Request and reviewer side effects", () => {
  it("recording a PR moves the plan to pr_open and forbids a second create", () => {
    const plan = recordPullRequest(recordPushOutcome(buildPlan(), verifiedPush, LATER), prRecord, LATER);
    expect(plan.status).toBe("pr_open");
    expect(evaluatePlanCapability(plan)).toMatchObject({ canCreate: false, canPush: false, requiresReconciliation: false });
  });

  it("a reconciled existing PR is recorded exactly like a created one, with its origin preserved", () => {
    const plan = recordPullRequest(buildPlan(), { ...prRecord, origin: "reconciled" }, LATER);
    expect(plan.pullRequest?.origin).toBe("reconciled");
    expect(plan.auditLog.at(-1)?.event).toBe("pr_reconciled");
  });

  it("an ambiguous create requires reconciliation before any retry", () => {
    const plan = recordCreateAmbiguity(recordPushOutcome(buildPlan(), verifiedPush, LATER), LATER, "Timeout after POST.");
    expect(plan.status).toBe("pr_ambiguous");
    expect(evaluatePlanCapability(plan).requiresReconciliation).toBe(true);
  });

  it("an ambiguous create after the PR is already known never downgrades pr_open", () => {
    const withPr = recordPullRequest(buildPlan(), prRecord, LATER);
    expect(recordCreateAmbiguity(withPr, LATER, "Retry timed out.").status).toBe("pr_open");
  });

  it("a definite create failure records an audit entry without inventing a side effect", () => {
    const plan = recordCreateFailure(recordPushOutcome(buildPlan(), verifiedPush, LATER), LATER, "422 validation failed.");
    expect(plan.pullRequest).toBeNull();
    expect(plan.status).toBe("push_verified");
    expect(plan.auditLog.at(-1)?.event).toBe("pr_create_failed");
  });

  it("a reviewer failure is a typed partial state on an existing PR, never a second PR", () => {
    const withPr = recordPullRequest(buildPlan(), prRecord, LATER);
    const partial = recordReviewerRequest(withPr, { attemptedAt: LATER, outcome: "failed", requested: ["octocat"], confirmed: [], detail: "403 from provider." }, LATER);
    expect(partial.status).toBe("pr_open");
    expect(partial.pullRequest).toEqual(prRecord);
    expect(partial.reviewerRequest?.outcome).toBe("failed");
    expect(evaluatePlanCapability(partial).canCreate).toBe(false);
  });

  it("base protection evidence is recorded verbatim, including unverifiable", () => {
    const plan = recordBaseProtection(buildPlan(), { evidence: "unverifiable", checkedAt: LATER, detail: "403 reading branch protection." }, LATER);
    expect(plan.baseProtection?.evidence).toBe("unverifiable");
  });
});

describe("M47-WU01 lifecycle: audit log", () => {
  it("appends in order and bounds growth without losing the typed side-effect records", () => {
    let plan = recordPullRequest(recordPushOutcome(buildPlan(), verifiedPush, LATER), prRecord, LATER);
    for (let i = 0; i < 500; i++) plan = appendPlanAudit(plan, "validated", LATER, `check ${i}`);
    expect(plan.auditLog.length).toBeLessThanOrEqual(200);
    expect(plan.auditLog.at(-1)?.detail).toBe("check 499");
    expect(plan.push).toEqual(verifiedPush);
    expect(plan.pullRequest).toEqual(prRecord);
    expect(PullRequestIntegrationPlanSchema.safeParse(plan).success).toBe(true);
  });
});

describe("M47-WU01 contract: no approval, merge, deployment, or release concept exists in the schema", () => {
  it("the plan shape has no field that could authorize a merge/approval/deploy/release", () => {
    const keys = Object.keys(buildPlan());
    for (const forbidden of ["merge", "autoMerge", "approve", "approval", "deploy", "release", "publish"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden.toLowerCase())), `plan should not carry a "${forbidden}" field`).toBe(false);
    }
  });
});
