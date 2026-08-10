import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, contextFor, initGitFixtureRepo } from "../helpers.js";
import { runPrPrepare, runPrInspect } from "../../src/cli/commands/pr-prepare.command.js";
import type { PullRequestProviderReadClient } from "../../src/services/github-pull-request-client.js";
import type { PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";
import { resolvePrIntegrationHome } from "../../src/state/pr-integration-home.js";
import { listPrIntegrationIds } from "../../src/state/pr-integration-store.js";

/**
 * M47-WU02 integration: `aiqt pr prepare` / `aiqt pr inspect` against a
 * REAL local Git repository with a REAL (local, bare) remote -- no network
 * and no GitHub account required.
 *
 * Every Git read is real: branch resolution, `diff --quiet`, untracked-file
 * listing, `ls-remote --heads`, `ls-remote --symref`, ancestry. Two
 * boundaries are injected, exactly as M40's release-draft tests inject
 * their GitHub client: the provider read client (so no GitHub account is
 * needed) and the remote-URL resolver (so the remote can be a local bare
 * repository while still presenting a genuine `owner/repo` identity). The
 * real resolver, `git remote get-url`, is covered separately in
 * tests/unit/git-command-runner-pr-reads.test.ts.
 */

const GITHUB_URL = "https://github.com/acme/widget.git";
const TOKEN_ENV = "AIQT_TEST_PR_TOKEN";

let workRoot: string;
let repoDir: string;
let remoteDir: string;
let integrationHome: string;

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function stubClient(overrides: Partial<PullRequestProviderReadClient> = {}): PullRequestProviderReadClient {
  return {
    getRepository: async () => ({ ok: true, value: { fullName: "acme/widget", defaultBranch: "main" } }),
    getBaseProtection: async () => ({ ok: true, value: { evidence: "unprotected", detail: "stub" } }),
    findOpenPullRequests: async () => ({ ok: true, value: [] }),
    ...overrides,
  };
}

function env(): NodeJS.ProcessEnv {
  return { [TOKEN_ENV]: "ghp_TESTTOKEN" };
}

/** The remote is a local bare repository; its identity is presented as the real GitHub URL it stands in for. */
function remoteUrlResolver(url: string = GITHUB_URL): () => string | null {
  return () => url;
}

function deps(overrides: { readClient?: PullRequestProviderReadClient; url?: string; env?: NodeJS.ProcessEnv } = {}) {
  return {
    readClient: overrides.readClient ?? stubClient(),
    remoteUrlResolver: remoteUrlResolver(overrides.url),
    env: overrides.env ?? env(),
  };
}

beforeEach(() => {
  workRoot = makeTempDir("aiqt-pr-prepare-");
  repoDir = join(workRoot, "repo");
  remoteDir = join(workRoot, "remote.git");
  integrationHome = join(workRoot, "integrations");
  mkdirSync(repoDir, { recursive: true });
  process.env.AIQT_PR_INTEGRATION_HOME = integrationHome;

  initGitFixtureRepo(repoDir);
  execFileSync("git", ["init", "--bare", "--quiet", "-b", "main", remoteDir]);

  // A real remote, local and bare, so `ls-remote` here and the real push in
  // WU47-03 are genuine Git operations against a genuine remote.
  git(["remote", "add", "origin", remoteDir], repoDir);
  git(["push", "--quiet", "origin", "main"], repoDir);

  git(["checkout", "--quiet", "-b", "feature/x"], repoDir);
  writeFileSync(join(repoDir, "feature.txt"), "work\n");
  git(["add", "feature.txt"], repoDir);
  git(["commit", "--quiet", "-m", "feature work"], repoDir);
});

afterEach(() => {
  delete process.env.AIQT_PR_INTEGRATION_HOME;
  removeDir(workRoot);
});

function baseOptions() {
  return { repository: repoDir, base: "main", title: "Add feature", tokenEnv: TOKEN_ENV };
}

describe("M47-WU02: pr prepare binds an exact plan and is read-only", () => {
  it("prepares a plan bound to the exact local HEAD, with no remote side effect", async () => {
    const headSha = git(["rev-parse", "HEAD"], repoDir);
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps());

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    const plan = (result.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(plan.sourceHeadSha).toBe(headSha);
    expect(plan.sourceBranch).toBe("feature/x");
    expect(plan.baseBranch).toBe("main");
    expect(plan.remoteRepositoryIdentity).toBe("acme/widget");
    expect(plan.createMode).toBe("draft");
    expect(plan.status).toBe("prepared");
    expect(plan.push).toBeNull();
    expect(plan.pullRequest).toBeNull();

    // Read-only: the remote still has only `main`, at the commit it had.
    const remoteRefs = git(["ls-remote", "--heads", "origin"], repoDir);
    expect(remoteRefs).not.toContain("refs/heads/feature/x");
    expect(result.nextRecommendedCommand).toBe(`aiqt pr push ${plan.id}`);
  });

  it("persists the plan outside the repository it targets", async () => {
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps());
    const plan = (result.data as { plan: PullRequestIntegrationPlan }).plan;

    expect(resolvePrIntegrationHome()).toBe(integrationHome);
    expect(listPrIntegrationIds(integrationHome)).toEqual([plan.id]);
    expect(existsSync(join(repoDir, ".aiqt"))).toBe(false);
    expect(result.changedFiles.every((f) => !f.startsWith(repoDir))).toBe(true);
  });

  it("records the draft default and honours explicit ready intent", async () => {
    const draft = await runPrPrepare(contextFor(workRoot), baseOptions(), deps());
    expect((draft.data as { plan: PullRequestIntegrationPlan }).plan.createMode).toBe("draft");

    const ready = await runPrPrepare(contextFor(workRoot), { ...baseOptions(), ready: true }, deps());
    const readyPlan = (ready.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(readyPlan.createMode).toBe("ready");
    expect(ready.warnings.map((w) => w.id)).toContain("PR-PREFLIGHT-READY-INTENT");
  });

  it("normalizes an explicit reviewer list into the plan", async () => {
    const result = await runPrPrepare(contextFor(workRoot), { ...baseOptions(), reviewer: [" Octocat ", "octocat", "alice"] }, deps());
    expect((result.data as { plan: PullRequestIntegrationPlan }).plan.reviewers).toEqual(["alice", "Octocat"]);
  });

  it("records base protection evidence verbatim, including unverifiable", async () => {
    const client = stubClient({ getBaseProtection: async () => ({ ok: true, value: { evidence: "unverifiable", detail: "403" } }) });
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps({ readClient: client }));
    expect((result.data as { plan: PullRequestIntegrationPlan }).plan.baseProtection?.evidence).toBe("unverifiable");
    expect(result.warnings.map((w) => w.id)).toContain("PR-PREFLIGHT-PROTECTION-UNVERIFIABLE");
  });
});

describe("M47-WU02: pr prepare blocks unsafe state before anything is written", () => {
  it("blocks a dirty working tree", async () => {
    writeFileSync(join(repoDir, "feature.txt"), "uncommitted\n");
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps());
    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-WORKTREE-DIRTY");
    expect((result.data as { plan: PullRequestIntegrationPlan }).plan.status).toBe("blocked");
  });

  it("blocks source == base", async () => {
    git(["checkout", "--quiet", "main"], repoDir);
    const result = await runPrPrepare(contextFor(workRoot), { ...baseOptions(), base: "main" }, deps());
    expect(result.blockingIssues.map((i) => i.id)).toEqual(expect.arrayContaining(["PR-PREFLIGHT-SOURCE-EQUALS-BASE", "PR-PREFLIGHT-SOURCE-IS-DEFAULT-BRANCH"]));
  });

  it("blocks a missing remote base branch", async () => {
    const result = await runPrPrepare(contextFor(workRoot), { ...baseOptions(), base: "no-such-branch" }, deps());
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-REMOTE-BASE-MISSING");
  });

  it("blocks when the provider reports a different repository than the remote URL", async () => {
    const client = stubClient({ getRepository: async () => ({ ok: true, value: { fullName: "evil/widget", defaultBranch: "main" } }) });
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps({ readClient: client }));
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-IDENTITY-MISMATCH");
  });

  it("blocks when identity could not be verified at all", async () => {
    const client = stubClient({ getRepository: async () => ({ ok: false, status: 500, message: "server error" }) });
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps({ readClient: client }));
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-IDENTITY-UNVERIFIED");
  });

  it("blocks a non-GitHub remote before any plan is bound", async () => {
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps({ url: "https://gitlab.com/acme/widget.git" }));
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-REMOTE-IDENTITY-UNRESOLVED");
    expect(listPrIntegrationIds(integrationHome)).toEqual([]);
  });

  it("returns an actionable, non-secret-leaking failure when credentials are missing, and writes nothing", async () => {
    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps({ env: {} }));
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(4);
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-MISSING-CREDENTIALS");
    expect(result.blockingIssues[0]!.suggestedAction).toMatch(/environment variable/i);
    expect(result.blockingIssues[0]!.suggestedAction).not.toMatch(/ghp_/);
    expect(listPrIntegrationIds(integrationHome)).toEqual([]);
  });

  it("refuses --repository together with a portfolio selector", async () => {
    const result = await runPrPrepare(contextFor(workRoot), { ...baseOptions(), portfolio: "p", member: "M1" }, deps());
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-CONFLICTING-TARGET");
  });

  it("refuses a half-specified portfolio selector", async () => {
    const result = await runPrPrepare(contextFor(workRoot), { base: "main", title: "t", portfolio: "p", tokenEnv: TOKEN_ENV }, deps());
    expect(result.blockingIssues[0]!.id).toBe("PR-PREPARE-INCOMPLETE-MEMBER-SELECTOR");
  });
});

describe("M47-WU02: pr prepare refuses to target the AIQT repository itself", () => {
  it("blocks when the target repository is the AIQT product repository", async () => {
    // A repository whose package.json declares name "aiqt" is, by the M37
    // self-management guard's definition, AIQT itself.
    writeFileSync(join(repoDir, "package.json"), JSON.stringify({ name: "aiqt" }), "utf8");
    git(["add", "package.json"], repoDir);
    git(["commit", "--quiet", "-m", "add package.json"], repoDir);

    const result = await runPrPrepare(contextFor(workRoot), baseOptions(), deps());
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-SELF-MANAGEMENT");
    expect(listPrIntegrationIds(integrationHome)).toEqual([]);
  });
});

describe("M47-WU02: pr inspect is read-only and reports capability", () => {
  it("reports a prepared plan as push-eligible and create-ineligible", async () => {
    const prepared = await runPrPrepare(contextFor(workRoot), baseOptions(), deps());
    const plan = (prepared.data as { plan: PullRequestIntegrationPlan }).plan;

    const result = runPrInspect(contextFor(workRoot), plan.id);
    expect(result.status).toBe("passed");
    const data = result.data as { plan: PullRequestIntegrationPlan; capability: { canPush: boolean; canCreate: boolean } };
    expect(data.plan.id).toBe(plan.id);
    expect(data.capability).toMatchObject({ canPush: true, canCreate: false });
  });

  it("fails cleanly for an unknown or malformed id", async () => {
    expect(runPrInspect(contextFor(workRoot), "pri-1-00000000").exitCode).toBe(3);
    expect(runPrInspect(contextFor(workRoot), "../escape").blockingIssues[0]!.id).toBe("PR-PLAN-NOT-FOUND");
  });
});
