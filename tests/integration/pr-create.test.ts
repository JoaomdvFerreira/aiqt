import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, contextFor, initGitFixtureRepo } from "../helpers.js";
import { runPrPrepare } from "../../src/cli/commands/pr-prepare.command.js";
import { runPrPush } from "../../src/cli/commands/pr-push.command.js";
import { runPrCreate } from "../../src/cli/commands/pr-create.command.js";
import type { GithubExistingPullRequest, PullRequestProviderClient } from "../../src/services/github-pull-request-client.js";
import type { PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";

// M34-WU02: this suite spawns real `git` subprocesses against real
// repositories and a real local bare remote; it belongs to the
// spawning workload class (docs/engineering/m34-validation-workload-policy.md Sec 6.1).
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

/**
 * M47-WU04 integration: `aiqt pr create` end to end, on top of a real
 * prepare and a real push against a real local bare remote. The GitHub
 * provider is a recording in-memory fake so that duplicate-safety,
 * partial-reviewer, and ambiguity paths can be exercised deterministically
 * -- the live-provider proof is WU47-06's controlled dogfood.
 */

const GITHUB_URL = "https://github.com/acme/widget.git";
const TOKEN_ENV = "AIQT_TEST_PR_TOKEN";
const OPTS = { tokenEnv: TOKEN_ENV };

let workRoot: string;
let repoDir: string;
let remoteDir: string;

function git(args: string[], cwd = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

interface FakeProvider {
  client: PullRequestProviderClient;
  pulls: GithubExistingPullRequest[];
  createCount: number;
  reviewerCalls: { pullNumber: number; reviewers: readonly string[] }[];
  failCreate: boolean;
  failLookup: boolean;
  failReviewers: boolean;
  protection: "protected" | "unprotected" | "unverifiable" | "unsupported";
}

function fakeProvider(): FakeProvider {
  const state: FakeProvider = {
    pulls: [],
    createCount: 0,
    reviewerCalls: [],
    failCreate: false,
    failLookup: false,
    failReviewers: false,
    protection: "unprotected",
    client: undefined as unknown as PullRequestProviderClient,
  };
  state.client = {
    getRepository: async () => ({ ok: true, value: { fullName: "acme/widget", defaultBranch: "main" } }),
    getBaseProtection: async () => ({ ok: true, value: { evidence: state.protection, detail: "fake" } }),
    findOpenPullRequests: async (_o, _r, head, base) => {
      if (state.failLookup) return { ok: false, status: 502, message: "lookup unavailable" };
      return { ok: true, value: state.pulls.filter((p) => p.headRef === head && p.baseRef === base) };
    },
    createPullRequest: async (_o, _r, params) => {
      state.createCount++;
      if (state.failCreate) return { ok: false, status: 502, message: "create unavailable" };
      const created: GithubExistingPullRequest = {
        number: 100 + state.pulls.length,
        htmlUrl: `https://github.com/acme/widget/pull/${100 + state.pulls.length}`,
        state: "open",
        isDraft: params.draft,
        headSha: git(["rev-parse", "HEAD"]),
        headRef: params.headBranch,
        baseRef: params.baseBranch,
        merged: false,
      };
      state.pulls.push(created);
      return { ok: true, value: created };
    },
    requestReviewers: async (_o, _r, pullNumber, reviewers) => {
      state.reviewerCalls.push({ pullNumber, reviewers });
      if (state.failReviewers) return { ok: false, status: 403, message: "reviewer request forbidden" };
      return { ok: true, value: [...reviewers] };
    },
    getPullRequest: async (_o, _r, n) => ({ ok: true, value: state.pulls.find((p) => p.number === n) ?? null }),
  };
  return state;
}

function deps(provider: FakeProvider, overrides: { env?: NodeJS.ProcessEnv } = {}) {
  return {
    readClient: provider.client,
    client: provider.client,
    remoteUrlResolver: () => GITHUB_URL,
    env: overrides.env ?? { [TOKEN_ENV]: "ghp_TESTTOKEN" },
  };
}

async function prepareAndPush(provider: FakeProvider, options: Record<string, unknown> = {}): Promise<PullRequestIntegrationPlan> {
  const prepared = await runPrPrepare(contextFor(workRoot), { repository: repoDir, base: "main", title: "Add feature", tokenEnv: TOKEN_ENV, ...options }, deps(provider));
  const plan = (prepared.data as { plan: PullRequestIntegrationPlan }).plan;
  await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(provider));
  return plan;
}

beforeEach(() => {
  workRoot = makeTempDir("aiqt-pr-create-");
  repoDir = join(workRoot, "repo");
  remoteDir = join(workRoot, "remote.git");
  mkdirSync(repoDir, { recursive: true });
  process.env.AIQT_PR_INTEGRATION_HOME = join(workRoot, "integrations");

  initGitFixtureRepo(repoDir);
  execFileSync("git", ["init", "--bare", "--quiet", "-b", "main", remoteDir]);
  git(["remote", "add", "origin", remoteDir]);
  git(["push", "--quiet", "origin", "main"]);

  git(["checkout", "--quiet", "-b", "feature/x"]);
  writeFileSync(join(repoDir, "feature.txt"), "work\n");
  git(["add", "feature.txt"]);
  git(["commit", "--quiet", "-m", "feature work"]);
});

afterEach(() => {
  delete process.env.AIQT_PR_INTEGRATION_HOME;
  removeDir(workRoot);
});

describe("M47-WU04: draft-by-default creation with exact provenance", () => {
  it("creates exactly one draft Pull Request for the pushed commit", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);
    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(provider.createCount).toBe(1);
    const record = (result.data as { pullRequest: { number: number; isDraft: boolean; origin: string } }).pullRequest;
    expect(record.isDraft).toBe(true);
    expect(record.origin).toBe("created");
    expect(result.summary).toMatch(/Nothing has been approved, merged, deployed, or released/);

    const stored = (result.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(stored.status).toBe("pr_open");
    expect(stored.pullRequest?.number).toBe(record.number);
  });

  it("opens a ready-for-review Pull Request only when the plan recorded explicit ready intent", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider, { ready: true });
    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect((result.data as { pullRequest: { isDraft: boolean } }).pullRequest.isDraft).toBe(false);
  });

  it("refuses to create before the branch has been pushed and verified", async () => {
    const provider = fakeProvider();
    const prepared = await runPrPrepare(contextFor(workRoot), { repository: repoDir, base: "main", title: "T", tokenEnv: TOKEN_ENV }, deps(provider));
    const plan = (prepared.data as { plan: PullRequestIntegrationPlan }).plan;

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues[0]!.id).toBe("PR-CREATE-NOT-PERMITTED");
    expect(provider.createCount).toBe(0);
  });

  it("blocks when a write-relevant fact changed after the push", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);
    writeFileSync(join(repoDir, "later.txt"), "later\n");
    git(["add", "later.txt"]);
    git(["commit", "--quiet", "-m", "later"]);

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues[0]!.id).toBe("PR-CREATE-PLAN-STALE");
    expect(provider.createCount).toBe(0);
  });

  it("refuses without credentials and creates nothing", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);
    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider, { env: {} }));
    expect(result.exitCode).toBe(4);
    expect(result.blockingIssues[0]!.suggestedAction).not.toMatch(/ghp_/);
    expect(provider.createCount).toBe(0);
  });
});

describe("M47-WU04: a plan never produces two Pull Requests", () => {
  it("running create twice creates one Pull Request and reconciles on the second run", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);

    const first = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    const second = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));

    expect(provider.createCount).toBe(1);
    expect(provider.pulls).toHaveLength(1);
    expect(second.status).toBe("passed");
    expect(second.summary).toMatch(/already exists/);
    expect((first.data as { pullRequest: { number: number } }).pullRequest.number).toBe(provider.pulls[0]!.number);
  });

  it("adopts a Pull Request that already existed before AIQT ever ran create", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);
    provider.pulls.push({
      number: 42,
      htmlUrl: "https://github.com/acme/widget/pull/42",
      state: "open",
      isDraft: true,
      headSha: plan.sourceHeadSha,
      headRef: "feature/x",
      baseRef: "main",
      merged: false,
    });

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(provider.createCount).toBe(0);
    expect((result.data as { pullRequest: { number: number; origin: string } }).pullRequest).toMatchObject({ number: 42, origin: "reconciled" });
  });

  it("blocks on a conflicting existing Pull Request for a different commit, and creates nothing", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);
    provider.pulls.push({
      number: 42,
      htmlUrl: "https://github.com/acme/widget/pull/42",
      state: "open",
      isDraft: false,
      headSha: "c".repeat(40),
      headRef: "feature/x",
      baseRef: "main",
      merged: false,
    });

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues[0]!.id).toBe("PR-CREATE-CONFLICTING-PULL-REQUEST");
    expect(result.blockingIssues[0]!.suggestedAction).toMatch(/never closes, edits, or supersedes/);
    expect(provider.createCount).toBe(0);
  });

  it("records ambiguity when the lookup fails, and a later successful retry still creates only one", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);

    provider.failLookup = true;
    const ambiguous = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(ambiguous.status).toBe("blocked");
    expect(ambiguous.blockingIssues[0]!.id).toBe("PR-CREATE-AMBIGUOUS");
    expect((ambiguous.data as { plan: PullRequestIntegrationPlan }).plan.status).toBe("pr_ambiguous");
    expect(provider.createCount).toBe(0);

    provider.failLookup = false;
    const retry = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(retry.status).toBe("passed");
    expect(provider.createCount).toBe(1);
    expect(provider.pulls).toHaveLength(1);
  });

  it("does not duplicate when a create reported an error but actually landed", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);

    // The create call errors, but the Pull Request appears anyway -- the
    // classic lost-response case.
    const realCreate = provider.client.createPullRequest;
    provider.client.createPullRequest = async (o, r, params, token) => {
      await realCreate(o, r, params, token);
      return { ok: false, status: 502, message: "gateway timeout after write" };
    };

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("passed");
    expect(provider.pulls).toHaveLength(1);
    expect((result.data as { pullRequest: { number: number } }).pullRequest.number).toBe(provider.pulls[0]!.number);
  });
});

describe("M47-WU04: reviewers are explicit, and a failure is a recoverable partial state", () => {
  it("requests exactly the plan's reviewers on the created Pull Request", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider, { reviewer: ["alice", "bob"] });
    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));

    expect(provider.reviewerCalls).toHaveLength(1);
    expect(provider.reviewerCalls[0]!.reviewers).toEqual(["alice", "bob"]);
    expect((result.data as { reviewerRequest: { outcome: string } }).reviewerRequest.outcome).toBe("succeeded");
  });

  it("keeps the Pull Request and records a typed partial state when the reviewer request fails", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider, { reviewer: ["alice"] });
    provider.failReviewers = true;

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("warning");
    expect(result.exitCode).toBe(0);
    expect(provider.pulls).toHaveLength(1);
    const stored = (result.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(stored.pullRequest).not.toBeNull();
    expect(stored.reviewerRequest?.outcome).toBe("failed");
    expect(result.warnings[0]!.id).toBe("PR-CREATE-REVIEWERS-INCOMPLETE");
  });

  it("a retry after a reviewer failure completes the reviewer request without creating a second Pull Request", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider, { reviewer: ["alice"] });
    provider.failReviewers = true;
    await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(provider.createCount).toBe(1);

    provider.failReviewers = false;
    const retry = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));

    expect(retry.status).toBe("passed");
    expect(provider.createCount).toBe(1);
    expect(provider.pulls).toHaveLength(1);
    expect(provider.reviewerCalls).toHaveLength(2);
    expect((retry.data as { reviewerRequest: { outcome: string } }).reviewerRequest.outcome).toBe("succeeded");
    expect((retry.data as { plan: PullRequestIntegrationPlan }).plan.reviewerRequest?.outcome).toBe("succeeded");
  });

  it("requests no reviewers when the plan names none", async () => {
    const provider = fakeProvider();
    const plan = await prepareAndPush(provider);
    await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(provider.reviewerCalls).toEqual([]);
  });
});

describe("M47-WU04: base-protection policy is enforced at create time", () => {
  it("blocks a plan requiring a protected base when protection is unverifiable", async () => {
    const provider = fakeProvider();
    provider.protection = "unverifiable";
    const plan = await prepareAndPush(provider, { requireProtectedBase: true });

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-BASE-NOT-PROTECTED");
    expect(provider.createCount).toBe(0);
  });

  it("blocks a plan requiring a protected base when the base is verifiably unprotected", async () => {
    const provider = fakeProvider();
    provider.protection = "unprotected";
    const plan = await prepareAndPush(provider, { requireProtectedBase: true });

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("blocked");
    expect(provider.createCount).toBe(0);
  });

  it("permits create when protection is required and verified", async () => {
    const provider = fakeProvider();
    provider.protection = "protected";
    const plan = await prepareAndPush(provider, { requireProtectedBase: true });

    const result = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(provider));
    expect(result.status).toBe("passed");
    expect(provider.createCount).toBe(1);
  });
});
