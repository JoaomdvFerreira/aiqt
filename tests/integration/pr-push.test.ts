import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, removeDir, contextFor, initGitFixtureRepo } from "../helpers.js";
import { runPrPrepare } from "../../src/cli/commands/pr-prepare.command.js";
import { runPrPush } from "../../src/cli/commands/pr-push.command.js";
import type { PullRequestProviderReadClient } from "../../src/services/github-pull-request-client.js";
import type { PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";

/**
 * M47-WU03 integration: the REAL push, against a real local bare remote.
 * `git push` here is a genuine Git mutation of a genuine remote
 * repository -- only the GitHub provider lookups and the remote-URL
 * identity are injected (no account, no network).
 *
 * These tests are the behavioural half of the write boundary; the
 * structural half (no force/delete/tag/wildcard argument exists anywhere)
 * lives in tests/unit/pr-integration-boundary-scan.test.ts.
 */

const GITHUB_URL = "https://github.com/acme/widget.git";
const TOKEN_ENV = "AIQT_TEST_PR_TOKEN";

let workRoot: string;
let repoDir: string;
let remoteDir: string;

function git(args: string[], cwd = repoDir): string {
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

function deps(overrides: { readClient?: PullRequestProviderReadClient; env?: NodeJS.ProcessEnv } = {}) {
  return {
    readClient: overrides.readClient ?? stubClient(),
    remoteUrlResolver: () => GITHUB_URL,
    env: overrides.env ?? { [TOKEN_ENV]: "ghp_TESTTOKEN" },
  };
}

const PUSH_OPTIONS = { tokenEnv: TOKEN_ENV };

function baseOptions() {
  return { repository: repoDir, base: "main", title: "Add feature", tokenEnv: TOKEN_ENV };
}

async function prepare(options: Partial<ReturnType<typeof baseOptions>> = {}): Promise<PullRequestIntegrationPlan> {
  const result = await runPrPrepare(contextFor(workRoot), { ...baseOptions(), ...options }, deps());
  return (result.data as { plan: PullRequestIntegrationPlan }).plan;
}

/** Remote refs, read directly from the bare repository so the assertion does not depend on any AIQT code path. */
function remoteRefs(): string[] {
  return git(["for-each-ref", "--format=%(refname)"], remoteDir).split("\n").filter((l) => l.length > 0);
}

beforeEach(() => {
  workRoot = makeTempDir("aiqt-pr-push-");
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

describe("M47-WU03: exact-SHA push to an absent remote branch", () => {
  it("creates the remote branch at exactly the planned commit and verifies it", async () => {
    const plan = await prepare();
    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(git(["rev-parse", "refs/heads/feature/x"], remoteDir)).toBe(plan.sourceHeadSha);

    const pushed = (result.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(pushed.status).toBe("push_verified");
    expect(pushed.push).toMatchObject({ outcome: "verified", plannedSha: plan.sourceHeadSha, remoteShaAfter: plan.sourceHeadSha, remoteBranchPresenceBefore: "absent" });
    expect(result.nextRecommendedCommand).toBe(`aiqt pr create ${plan.id}`);
  });

  it("pushes exactly one ref and no tags", async () => {
    git(["tag", "v9.9.9"]);
    const plan = await prepare();
    await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());

    const refs = remoteRefs();
    expect(refs).toEqual(expect.arrayContaining(["refs/heads/main", "refs/heads/feature/x"]));
    expect(refs.filter((r) => r.startsWith("refs/tags/"))).toEqual([]);
    expect(refs).toHaveLength(2);
  });

  it("never touches the base branch", async () => {
    const baseBefore = git(["rev-parse", "refs/heads/main"], remoteDir);
    const plan = await prepare();
    await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(git(["rev-parse", "refs/heads/main"], remoteDir)).toBe(baseBefore);
  });
});

describe("M47-WU03: fast-forward-only semantics against an existing remote branch", () => {
  it("fast-forwards a remote branch that is behind", async () => {
    git(["push", "--quiet", "origin", "feature/x"]);
    const behind = git(["rev-parse", "refs/heads/feature/x"], remoteDir);

    writeFileSync(join(repoDir, "more.txt"), "more\n");
    git(["add", "more.txt"]);
    git(["commit", "--quiet", "-m", "more work"]);

    const plan = await prepare();
    expect(plan.sourceHeadSha).not.toBe(behind);

    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(result.status).toBe("passed");
    expect(git(["rev-parse", "refs/heads/feature/x"], remoteDir)).toBe(plan.sourceHeadSha);
    expect((result.data as { plan: PullRequestIntegrationPlan }).plan.push?.remoteBranchPresenceBefore).toBe("present");
  });

  it("blocks a diverged remote branch and leaves the remote untouched -- there is no force option", async () => {
    // Prepared while the remote branch does not exist yet; the divergence
    // appears afterwards, which is the realistic race this gate exists for.
    const plan = await prepare();

    const divergedClone = join(workRoot, "clone");
    execFileSync("git", ["clone", "--quiet", remoteDir, divergedClone]);
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: divergedClone });
    execFileSync("git", ["config", "user.name", "T"], { cwd: divergedClone });
    execFileSync("git", ["checkout", "--quiet", "-b", "feature/x"], { cwd: divergedClone });
    writeFileSync(join(divergedClone, "theirs.txt"), "theirs\n");
    execFileSync("git", ["add", "theirs.txt"], { cwd: divergedClone });
    execFileSync("git", ["commit", "--quiet", "-m", "theirs"], { cwd: divergedClone });
    execFileSync("git", ["push", "--quiet", "origin", "feature/x"], { cwd: divergedClone });
    const remoteBefore = git(["rev-parse", "refs/heads/feature/x"], remoteDir);

    // Fetch so the diverged commit exists locally and ancestry is decidable.
    git(["fetch", "--quiet", "origin"]);
    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());

    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-NOT-FAST-FORWARD");
    expect(git(["rev-parse", "refs/heads/feature/x"], remoteDir)).toBe(remoteBefore);
    expect((result.data as { plan: PullRequestIntegrationPlan }).plan.push).toBeNull();
  });

  it("blocks when the remote commit is not present locally, so fast-forward safety cannot be proven", async () => {
    const plan = await prepare();

    const otherClone = join(workRoot, "clone2");
    execFileSync("git", ["clone", "--quiet", remoteDir, otherClone]);
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: otherClone });
    execFileSync("git", ["config", "user.name", "T"], { cwd: otherClone });
    execFileSync("git", ["checkout", "--quiet", "-b", "feature/x"], { cwd: otherClone });
    writeFileSync(join(otherClone, "theirs.txt"), "theirs\n");
    execFileSync("git", ["add", "theirs.txt"], { cwd: otherClone });
    execFileSync("git", ["commit", "--quiet", "-m", "theirs"], { cwd: otherClone });
    execFileSync("git", ["push", "--quiet", "origin", "feature/x"], { cwd: otherClone });
    const remoteBefore = git(["rev-parse", "refs/heads/feature/x"], remoteDir);

    // Deliberately no fetch: the remote commit is unknown locally.
    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-FAST-FORWARD-UNVERIFIABLE");
    expect(git(["rev-parse", "refs/heads/feature/x"], remoteDir)).toBe(remoteBefore);
  });

  it("is a verified no-op when the remote already holds the planned commit", async () => {
    const plan = await prepare();
    const first = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(first.status).toBe("passed");

    // The plan is now push_verified; a second push is still permitted and
    // must remain a verified no-op rather than changing anything.
    const second = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(second.status).toBe("passed");
    expect(git(["rev-parse", "refs/heads/feature/x"], remoteDir)).toBe(plan.sourceHeadSha);
  });
});

describe("M47-WU03: stale and unsafe state block before anything is sent", () => {
  it("blocks when local HEAD moved after the plan was prepared", async () => {
    const plan = await prepare();
    writeFileSync(join(repoDir, "later.txt"), "later\n");
    git(["add", "later.txt"]);
    git(["commit", "--quiet", "-m", "later"]);

    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PUSH-PLAN-STALE");
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
    expect((result.data as { plan: PullRequestIntegrationPlan }).plan.status).toBe("blocked");
  });

  it("blocks when the working tree became dirty after the plan was prepared", async () => {
    const plan = await prepare();
    writeFileSync(join(repoDir, "feature.txt"), "uncommitted change\n");

    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-WORKTREE-DIRTY");
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });

  it("blocks when the source branch is no longer checked out", async () => {
    const plan = await prepare();
    git(["checkout", "--quiet", "main"]);

    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-SOURCE-NOT-CHECKED-OUT");
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });

  it("blocks when the repository identity no longer matches the plan", async () => {
    const plan = await prepare();
    const client = stubClient({ getRepository: async () => ({ ok: true, value: { fullName: "someone-else/widget", defaultBranch: "main" } }) });

    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps({ readClient: client }));
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.map((i) => i.id)).toContain("PR-PUSH-PLAN-STALE");
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });

  it("refuses without credentials, and pushes nothing", async () => {
    const plan = await prepare();
    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps({ env: {} }));
    expect(result.exitCode).toBe(4);
    expect(result.blockingIssues[0]!.id).toBe("PR-PUSH-MISSING-CREDENTIALS");
    expect(result.blockingIssues[0]!.suggestedAction).not.toMatch(/ghp_/);
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });

  it("refuses to push a plan that was already blocked at prepare time", async () => {
    writeFileSync(join(repoDir, "feature.txt"), "dirty\n");
    const blockedPlan = await prepare();
    expect(blockedPlan.status).toBe("blocked");

    const result = await runPrPush(contextFor(workRoot), blockedPlan.id, PUSH_OPTIONS, deps());
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues[0]!.id).toBe("PR-PUSH-NOT-PERMITTED");
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });

  it("fails cleanly for an unknown integration id", async () => {
    const result = await runPrPush(contextFor(workRoot), "pri-1-00000000", PUSH_OPTIONS, deps());
    expect(result.exitCode).toBe(3);
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });
});

describe("M47-WU03: an ambiguous outcome is recorded, never guessed", () => {
  it("records push_ambiguous and refuses further writes until reconciled", async () => {
    const plan = await prepare();
    // A push that reports success while the remote is left unchanged is
    // exactly the case that must never be reported as success.
    const result = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, { ...deps(), push: () => "" });

    expect(result.status).toBe("blocked");
    expect(result.blockingIssues[0]!.id).toBe("PR-PUSH-AMBIGUOUS");
    expect(result.blockingIssues[0]!.suggestedAction).toMatch(/will not retry/i);
    const stored = (result.data as { plan: PullRequestIntegrationPlan }).plan;
    expect(stored.status).toBe("push_ambiguous");

    // A second attempt must not push again -- reconciliation comes first.
    const retry = await runPrPush(contextFor(workRoot), plan.id, PUSH_OPTIONS, deps());
    expect(retry.blockingIssues[0]!.id).toBe("PR-PUSH-RECONCILIATION-REQUIRED");
    expect(remoteRefs()).toEqual(["refs/heads/main"]);
  });
});
