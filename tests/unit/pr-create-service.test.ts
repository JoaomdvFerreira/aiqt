import { describe, it, expect } from "vitest";
import { createOrReconcilePullRequest, requestPlanReviewers } from "../../src/services/pr-create-service.js";
import type { GithubExistingPullRequest, PullRequestProviderClient } from "../../src/services/github-pull-request-client.js";
import { createIntegrationPlan } from "../../src/workflow/pr-integration-lifecycle.js";
import { computePrMetadataDigest, type PullRequestWriteBindingFacts } from "../../src/workflow/pr-integration-identity.js";
import type { PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";

const NOW = "2026-08-10T00:00:00.000Z";
const PLANNED = "a".repeat(40);
const OTHER = "b".repeat(40);

function facts(overrides: Partial<PullRequestWriteBindingFacts> = {}): PullRequestWriteBindingFacts {
  return {
    provider: "github",
    repositoryRoot: "/tmp/target-repo",
    remoteName: "origin",
    remoteRepositoryIdentity: "acme/widget",
    baseBranch: "main",
    sourceBranch: "feature/x",
    sourceHeadSha: PLANNED,
    metadataDigest: computePrMetadataDigest({ title: "T", body: "B" }),
    reviewers: [],
    createMode: "draft",
    policy: { requireProtectedBase: false },
    ...overrides,
  };
}

function plan(overrides: Partial<PullRequestWriteBindingFacts> = {}): PullRequestIntegrationPlan {
  return createIntegrationPlan({ id: "pri-1754784000000-0123abcd", now: NOW, facts: facts(overrides), title: "T", body: "B", portfolioRef: null });
}

function pr(overrides: Partial<GithubExistingPullRequest> = {}): GithubExistingPullRequest {
  return {
    number: 7,
    htmlUrl: "https://github.com/acme/widget/pull/7",
    state: "open",
    isDraft: true,
    headSha: PLANNED,
    headRef: "feature/x",
    baseRef: "main",
    merged: false,
    ...overrides,
  };
}

interface Calls {
  creates: { draft: boolean; title: string; body: string; headBranch: string; baseBranch: string }[];
  lookups: number;
  reviewerCalls: { pullNumber: number; reviewers: readonly string[] }[];
}

function client(options: {
  lookupResults?: (GithubExistingPullRequest[] | "error")[];
  createResult?: GithubExistingPullRequest | "error";
  reviewerResult?: string[] | "error";
} = {}): PullRequestProviderClient & { calls: Calls } {
  const calls: Calls = { creates: [], lookups: 0, reviewerCalls: [] };
  const lookupResults = options.lookupResults ?? [[]];
  return {
    calls,
    getRepository: async () => ({ ok: true, value: { fullName: "acme/widget", defaultBranch: "main" } }),
    getBaseProtection: async () => ({ ok: true, value: { evidence: "unprotected", detail: "stub" } }),
    findOpenPullRequests: async () => {
      const result = lookupResults[Math.min(calls.lookups++, lookupResults.length - 1)]!;
      return result === "error" ? { ok: false, status: 502, message: "bad gateway" } : { ok: true, value: result };
    },
    createPullRequest: async (_o, _r, params) => {
      calls.creates.push({ draft: params.draft, title: params.title, body: params.body, headBranch: params.headBranch, baseBranch: params.baseBranch });
      const result = options.createResult ?? pr();
      return result === "error" ? { ok: false, status: 502, message: "bad gateway" } : { ok: true, value: result };
    },
    requestReviewers: async (_o, _r, pullNumber, reviewers) => {
      calls.reviewerCalls.push({ pullNumber, reviewers });
      const result = options.reviewerResult ?? [...reviewers];
      return result === "error" ? { ok: false, status: 403, message: "forbidden" } : { ok: true, value: result };
    },
    getPullRequest: async () => ({ ok: true, value: pr() }),
  };
}

describe("M47-WU04 create: exact provenance is required before any Pull Request exists", () => {
  it("refuses when the remote source branch is not at the planned commit", async () => {
    const c = client();
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: OTHER, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("failed");
    expect(c.calls.creates).toEqual([]);
  });

  it("refuses when the remote source branch holds no readable commit", async () => {
    const c = client();
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: null, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("failed");
    expect(c.calls.creates).toEqual([]);
  });

  it("refuses a plan whose repository identity is not owner/repo", async () => {
    const c = client();
    const outcome = await createOrReconcilePullRequest({ plan: plan({ remoteRepositoryIdentity: "unresolved" }), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("failed");
    expect(c.calls.creates).toEqual([]);
  });
});

describe("M47-WU04 create: lookup always precedes create", () => {
  it("looks up before creating, and creates a draft by default", async () => {
    const c = client();
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(c.calls.lookups).toBeGreaterThanOrEqual(1);
    expect(outcome.kind).toBe("created");
    expect(c.calls.creates).toHaveLength(1);
    expect(c.calls.creates[0]).toMatchObject({ draft: true, headBranch: "feature/x", baseBranch: "main", title: "T", body: "B" });
  });

  it("sends draft: false only for a plan with explicit ready intent", async () => {
    const c = client({ createResult: pr({ isDraft: false }) });
    await createOrReconcilePullRequest({ plan: plan({ createMode: "ready" }), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(c.calls.creates[0]!.draft).toBe(false);
  });

  it("adopts an existing matching open Pull Request instead of creating a second one", async () => {
    const c = client({ lookupResults: [[pr()]] });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("reconciled");
    expect(c.calls.creates).toEqual([]);
    if (outcome.kind !== "reconciled") return;
    expect(outcome.record).toMatchObject({ number: 7, origin: "reconciled" });
  });

  it("never adopts a Pull Request whose head is a different commit", async () => {
    const c = client({ lookupResults: [[pr({ headSha: OTHER })]] });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("conflict");
    expect(c.calls.creates).toEqual([]);
  });

  it("blocks rather than guessing when several open Pull Requests match the branch pair", async () => {
    const c = client({ lookupResults: [[pr({ number: 7 }), pr({ number: 8 })]] });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("conflict");
    expect(c.calls.creates).toEqual([]);
  });

  it("ignores closed and merged Pull Requests when deciding whether one already exists", async () => {
    const c = client({ lookupResults: [[pr({ number: 5, state: "closed" }), pr({ number: 6, merged: true })]] });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("created");
  });

  it("reports ambiguity, and creates nothing, when the pre-create lookup itself fails", async () => {
    const c = client({ lookupResults: ["error"] });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("ambiguous");
    expect(c.calls.creates).toEqual([]);
  });
});

describe("M47-WU04 create: a failed create is resolved by looking up, never by retrying", () => {
  it("adopts the Pull Request when the create reported an error but it actually landed", async () => {
    const c = client({ lookupResults: [[], [pr()]], createResult: "error" });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("reconciled");
    expect(c.calls.creates).toHaveLength(1);
    if (outcome.kind !== "reconciled") return;
    expect(outcome.record.number).toBe(7);
  });

  it("reports a genuine failure when the create failed and no Pull Request exists", async () => {
    const c = client({ lookupResults: [[], []], createResult: "error" });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("failed");
    expect(c.calls.creates).toHaveLength(1);
  });

  it("reports ambiguity when both the create and the follow-up lookup fail", async () => {
    const c = client({ lookupResults: [[], "error"], createResult: "error" });
    const outcome = await createOrReconcilePullRequest({ plan: plan(), remoteSourceSha: PLANNED, token: "t", now: NOW }, c);
    expect(outcome.kind).toBe("ambiguous");
    expect(c.calls.creates).toHaveLength(1);
  });
});

describe("M47-WU04 reviewers: explicit only, and a failure never invalidates the Pull Request", () => {
  it("requests nothing when the plan names no reviewers", async () => {
    const c = client();
    const record = await requestPlanReviewers({ plan: plan(), pullNumber: 7, token: "t", now: NOW }, c);
    expect(record.outcome).toBe("not_requested");
    expect(c.calls.reviewerCalls).toEqual([]);
  });

  it("requests exactly the plan's reviewers, and no others", async () => {
    const c = client();
    const record = await requestPlanReviewers({ plan: plan({ reviewers: ["alice", "bob"] }), pullNumber: 7, token: "t", now: NOW }, c);
    expect(c.calls.reviewerCalls).toEqual([{ pullNumber: 7, reviewers: ["alice", "bob"] }]);
    expect(record.outcome).toBe("succeeded");
    expect(record.confirmed).toEqual(["alice", "bob"]);
  });

  it("records a typed failure that explicitly says the Pull Request must not be recreated", async () => {
    const c = client({ reviewerResult: "error" });
    const record = await requestPlanReviewers({ plan: plan({ reviewers: ["alice"] }), pullNumber: 7, token: "t", now: NOW }, c);
    expect(record.outcome).toBe("failed");
    expect(record.requested).toEqual(["alice"]);
    expect(record.confirmed).toEqual([]);
    expect(record.detail).toMatch(/must not be recreated/);
  });

  it("records `partial` when the provider confirms only some reviewers", async () => {
    const c = client({ reviewerResult: ["alice"] });
    const record = await requestPlanReviewers({ plan: plan({ reviewers: ["alice", "bob"] }), pullNumber: 7, token: "t", now: NOW }, c);
    expect(record.outcome).toBe("partial");
    expect(record.detail).toMatch(/bob/);
  });

  it("matches confirmation case-insensitively, as GitHub logins are", async () => {
    const c = client({ reviewerResult: ["ALICE"] });
    const record = await requestPlanReviewers({ plan: plan({ reviewers: ["alice"] }), pullNumber: 7, token: "t", now: NOW }, c);
    expect(record.outcome).toBe("succeeded");
  });
});
