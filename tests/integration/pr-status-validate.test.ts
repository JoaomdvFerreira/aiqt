import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HEAVY_SPAWNING_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, contextFor, initGitFixtureRepo } from "../helpers.js";
import { runPrPrepare } from "../../src/cli/commands/pr-prepare.command.js";
import { runPrPush } from "../../src/cli/commands/pr-push.command.js";
import { runPrCreate } from "../../src/cli/commands/pr-create.command.js";
import { runPrStatus, runPrValidate } from "../../src/cli/commands/pr-status.command.js";
import type { GithubExistingPullRequest, PullRequestProviderClient } from "../../src/services/github-pull-request-client.js";
import type { PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";
import { resolvePrIntegrationFilePath } from "../../src/state/pr-integration-home.js";

// M49-WU3: this real Git/local-remote suite passes in isolation on WU3 and
// clean WU2, but its created-PR reconciliation scenario exceeded 15s only
// under canonical parallel host load. It uses the existing, evidence-gated
// per-file heavy spawning budget; assertions and global defaults are unchanged.
vi.setConfig({ testTimeout: HEAVY_SPAWNING_TEST_TIMEOUT_MS });

/**
 * M47-WU05 integration: `aiqt pr status` (reconciliation, resumability)
 * and `aiqt pr validate` (deterministic, side-effect-free verdict), plus
 * the M46 single-member selector and the M37 handoff. Real Git, real local
 * bare remote, in-memory provider.
 */

const GITHUB_URL = "https://github.com/acme/widget.git";
const TOKEN_ENV = "AIQT_TEST_PR_TOKEN";
const OPTS = { tokenEnv: TOKEN_ENV };

let workRoot: string;
let repoDir: string;
let remoteDir: string;
let integrationHome: string;

function git(args: string[], cwd = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

interface Fake {
  client: PullRequestProviderClient;
  pulls: GithubExistingPullRequest[];
  failLookup: boolean;
  createCount: number;
}

function fake(): Fake {
  const state: Fake = { pulls: [], failLookup: false, createCount: 0, client: undefined as unknown as PullRequestProviderClient };
  state.client = {
    getRepository: async () => ({ ok: true, value: { fullName: "acme/widget", defaultBranch: "main" } }),
    getBaseProtection: async () => ({ ok: true, value: { evidence: "unprotected", detail: "fake" } }),
    findOpenPullRequests: async (_o, _r, head, base) =>
      state.failLookup ? { ok: false, status: 502, message: "lookup unavailable" } : { ok: true, value: state.pulls.filter((p) => p.headRef === head && p.baseRef === base) },
    createPullRequest: async (_o, _r, params) => {
      state.createCount++;
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
    requestReviewers: async (_o, _r, _n, reviewers) => ({ ok: true, value: [...reviewers] }),
    getPullRequest: async (_o, _r, n) => ({ ok: true, value: state.pulls.find((p) => p.number === n) ?? null }),
  };
  return state;
}

function deps(f: Fake, overrides: { env?: NodeJS.ProcessEnv } = {}) {
  return { readClient: f.client, client: f.client, remoteUrlResolver: () => GITHUB_URL, env: overrides.env ?? { [TOKEN_ENV]: "ghp_TESTTOKEN" } };
}

async function prepare(f: Fake, options: Record<string, unknown> = {}): Promise<PullRequestIntegrationPlan> {
  const result = await runPrPrepare(contextFor(workRoot), { repository: repoDir, base: "main", title: "Add feature", tokenEnv: TOKEN_ENV, ...options }, deps(f));
  return (result.data as { plan: PullRequestIntegrationPlan }).plan;
}

function storedPlan(id: string): PullRequestIntegrationPlan {
  return JSON.parse(readFileSync(resolvePrIntegrationFilePath(integrationHome, id), "utf8")) as PullRequestIntegrationPlan;
}

beforeEach(() => {
  workRoot = makeTempDir("aiqt-pr-status-");
  repoDir = join(workRoot, "repo");
  remoteDir = join(workRoot, "remote.git");
  integrationHome = join(workRoot, "integrations");
  mkdirSync(repoDir, { recursive: true });
  process.env.AIQT_PR_INTEGRATION_HOME = integrationHome;

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
  delete process.env.AIQT_PORTFOLIO_HOME;
  removeDir(workRoot);
});

describe("M47-WU05: pr status reports without changing anything it does not need to", () => {
  it("reports a prepared plan with no side effects", async () => {
    const f = fake();
    const plan = await prepare(f);
    const result = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.summary).toMatch(/Push: not attempted/);
    expect(result.summary).toMatch(/Pull Request: none/);
    expect((result.data as { reconciled: boolean }).reconciled).toBe(false);
  });

  it("reports a created Pull Request and its reviewer outcome", async () => {
    const f = fake();
    const plan = await prepare(f, { reviewer: ["alice"] });
    await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(f));
    await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(f));

    const result = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(result.summary).toMatch(/Pull Request: #100 \(draft\)/);
    expect(result.summary).toMatch(/Reviewers: succeeded/);
  });

  it("never approves, merges, or publishes -- and observes, without producing, a merged Pull Request", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(f));
    await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(f));

    // A human merged it outside AIQT.
    f.pulls[0]!.merged = true;
    f.pulls[0]!.state = "closed";

    const result = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(result.warnings.map((w) => w.id)).toContain("PR-STATUS-PULL-REQUEST-MERGED");
    expect(result.warnings.find((w) => w.id === "PR-STATUS-PULL-REQUEST-MERGED")!.message).toMatch(/AIQT never merges/);
  });

  it("refuses without credentials", async () => {
    const f = fake();
    const plan = await prepare(f);
    const result = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f, { env: {} }));
    expect(result.exitCode).toBe(4);
    expect(result.blockingIssues[0]!.id).toBe("PR-STATUS-MISSING-CREDENTIALS");
  });
});

describe("M47-WU05: pr status reconciles an ambiguous outcome from real remote evidence", () => {
  it("confirms an ambiguous push that actually landed, unblocking create", async () => {
    const f = fake();
    const plan = await prepare(f);
    // A push that landed but whose outcome AIQT could not confirm.
    await runPrPush(contextFor(workRoot), plan.id, OPTS, { ...deps(f), readRemoteSha: () => null });
    expect(storedPlan(plan.id).status).toBe("push_ambiguous");
    // The branch really is on the remote.
    expect(git(["rev-parse", "refs/heads/feature/x"], remoteDir)).toBe(plan.sourceHeadSha);

    const status = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(status.warnings.concat(status.blockingIssues).map((i) => i.id)).toContain("PR-STATUS-PUSH-RECONCILED-VERIFIED");
    expect(storedPlan(plan.id).status).toBe("push_verified");

    const created = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(created.status).toBe("passed");
    expect(f.createCount).toBe(1);
  });

  it("records that an ambiguous push did not land, without inventing a side effect", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, { ...deps(f), push: () => "" });
    expect(storedPlan(plan.id).status).toBe("push_ambiguous");

    const status = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(status.warnings.map((w) => w.id)).toContain("PR-STATUS-PUSH-RECONCILED-FAILED");
    expect(storedPlan(plan.id).push?.outcome).toBe("failed");
  });

  it("leaves an unresolvable push outcome unresolved rather than guessing", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, { ...deps(f), push: () => "" });

    // The remote is now unreachable, so status cannot resolve anything.
    git(["remote", "set-url", "origin", join(workRoot, "gone.git")]);
    const status = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(status.blockingIssues.map((i) => i.id)).toContain("PR-STATUS-PUSH-STILL-UNKNOWN");
    expect(storedPlan(plan.id).status).toBe("push_ambiguous");
  });

  it("adopts a Pull Request that an ambiguous create actually produced, and a later create makes no second one", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(f));

    // Create reports failure while the PR exists -- then even the lookup fails.
    f.pulls.push({
      number: 55,
      htmlUrl: "https://github.com/acme/widget/pull/55",
      state: "open",
      isDraft: true,
      headSha: plan.sourceHeadSha,
      headRef: "feature/x",
      baseRef: "main",
      merged: false,
    });
    f.failLookup = true;
    const ambiguous = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(ambiguous.blockingIssues[0]!.id).toBe("PR-CREATE-AMBIGUOUS");
    expect(storedPlan(plan.id).status).toBe("pr_ambiguous");

    f.failLookup = false;
    const status = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(status.warnings.map((w) => w.id)).toContain("PR-STATUS-PULL-REQUEST-RECONCILED");
    expect(storedPlan(plan.id).pullRequest?.number).toBe(55);

    const retry = await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(retry.summary).toMatch(/already exists/);
    expect(f.createCount).toBe(0);
    expect(f.pulls).toHaveLength(1);
  });

  it("establishes that an ambiguous create did not land, and restores the plan to push_verified", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(f));

    f.failLookup = true;
    await runPrCreate(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(storedPlan(plan.id).status).toBe("pr_ambiguous");

    f.failLookup = false;
    const status = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(status.warnings.map((w) => w.id)).toContain("PR-STATUS-CREATE-RECONCILED-ABSENT");
    expect(storedPlan(plan.id).status).toBe("push_verified");
    expect(storedPlan(plan.id).pullRequest).toBeNull();
  });

  it("blocks rather than adopting when several open Pull Requests exist", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(f));
    for (const number of [61, 62]) {
      f.pulls.push({ number, htmlUrl: `u${number}`, state: "open", isDraft: true, headSha: plan.sourceHeadSha, headRef: "feature/x", baseRef: "main", merged: false });
    }

    const status = await runPrStatus(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(status.blockingIssues.map((i) => i.id)).toContain("PR-STATUS-MULTIPLE-PULL-REQUESTS");
    expect(storedPlan(plan.id).pullRequest).toBeNull();
  });
});

describe("M47-WU05: pr validate is deterministic and writes nothing at all", () => {
  it("passes for a fresh, pushed plan and reports what would be permitted", async () => {
    const f = fake();
    const plan = await prepare(f);
    await runPrPush(contextFor(workRoot), plan.id, OPTS, deps(f));

    const before = readFileSync(resolvePrIntegrationFilePath(integrationHome, plan.id), "utf8");
    const result = await runPrValidate(contextFor(workRoot), plan.id, OPTS, deps(f));
    const after = readFileSync(resolvePrIntegrationFilePath(integrationHome, plan.id), "utf8");

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect((result.data as { wouldPush: boolean; wouldCreate: boolean })).toMatchObject({ wouldPush: true, wouldCreate: true });
    expect(after).toBe(before);
  });

  it("blocks a stale plan and still writes nothing", async () => {
    const f = fake();
    const plan = await prepare(f);
    writeFileSync(join(repoDir, "later.txt"), "later\n");
    git(["add", "later.txt"]);
    git(["commit", "--quiet", "-m", "later"]);

    const before = readFileSync(resolvePrIntegrationFilePath(integrationHome, plan.id), "utf8");
    const result = await runPrValidate(contextFor(workRoot), plan.id, OPTS, deps(f));
    const after = readFileSync(resolvePrIntegrationFilePath(integrationHome, plan.id), "utf8");

    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
    expect(result.blockingIssues[0]!.id).toBe("PR-VALIDATE-PLAN-STALE");
    expect(after).toBe(before);
  });

  it("is deterministic: two runs of the same state produce the same verdict", async () => {
    const f = fake();
    const plan = await prepare(f);
    const first = await runPrValidate(contextFor(workRoot), plan.id, OPTS, deps(f));
    const second = await runPrValidate(contextFor(workRoot), plan.id, OPTS, deps(f));
    expect(second.status).toBe(first.status);
    expect(second.blockingIssues).toEqual(first.blockingIssues);
    expect((second.data as { wouldPush: boolean }).wouldPush).toBe((first.data as { wouldPush: boolean }).wouldPush);
  });
});

describe("M47-WU05: M46 member selection picks exactly one repository and grants no authority", () => {
  it("resolves a portfolio member to the target repository root", async () => {
    const f = fake();
    const result = await runPrPrepare(
      contextFor(workRoot),
      { base: "main", title: "Add feature", tokenEnv: TOKEN_ENV, portfolio: "acme", member: "M1" },
      { ...deps(f), resolveMember: (portfolioId, memberId) => (portfolioId === "acme" && memberId === "M1" ? { ok: true, root: repoDir } : { ok: false, reason: "no such member" }) },
    );

    expect(result.status).toBe("passed");
    const plan = (result.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(plan.repositoryRoot).toBe(repoDir);
    expect(plan.portfolioRef).toEqual({ portfolioId: "acme", memberId: "M1" });
  });

  it("reports a member that does not resolve, and writes no plan", async () => {
    const f = fake();
    const result = await runPrPrepare(
      contextFor(workRoot),
      { base: "main", title: "T", tokenEnv: TOKEN_ENV, portfolio: "acme", member: "M9" },
      { ...deps(f), resolveMember: () => ({ ok: false, reason: 'Member "M9" does not exist in portfolio "acme".' }) },
    );
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-MEMBER-NOT-RESOLVED");
  });

  it("a member-selected plan is still subject to every gate a --repository plan is", async () => {
    const f = fake();
    writeFileSync(join(repoDir, "feature.txt"), "dirty\n");
    const result = await runPrPrepare(
      contextFor(workRoot),
      { base: "main", title: "T", tokenEnv: TOKEN_ENV, portfolio: "acme", member: "M1" },
      { ...deps(f), resolveMember: () => ({ ok: true, root: repoDir }) },
    );
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-WORKTREE-DIRTY");
  });
});

describe("M47-WU05: M37 handoff reuse", () => {
  it("refuses --from-run together with --title", async () => {
    const f = fake();
    const result = await runPrPrepare(contextFor(workRoot), { repository: repoDir, base: "main", title: "T", fromRun: "run-1-0000000a", tokenEnv: TOKEN_ENV }, deps(f));
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-CONFLICTING-METADATA-SOURCE");
  });

  it("requires a title when no handoff is used", async () => {
    const f = fake();
    const result = await runPrPrepare(contextFor(workRoot), { repository: repoDir, base: "main", tokenEnv: TOKEN_ENV }, deps(f));
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-MISSING-TITLE");
  });

  it("reports an unavailable run honestly rather than fabricating a draft", async () => {
    const f = fake();
    const result = await runPrPrepare(
      contextFor(workRoot),
      { repository: repoDir, base: "main", fromRun: "run-1754784000000-0000000a", evidenceDir: join(workRoot, "evidence"), tokenEnv: TOKEN_ENV },
      deps(f),
    );
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-HANDOFF-UNAVAILABLE");
  });
});
