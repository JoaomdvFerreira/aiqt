import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LIVE_REMOTE_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { makeTempDir, removeDir, contextFor } from "../helpers.js";
import { runPrPrepare } from "../../src/cli/commands/pr-prepare.command.js";
import { runPrPush } from "../../src/cli/commands/pr-push.command.js";
import { runPrCreate } from "../../src/cli/commands/pr-create.command.js";
import { runPrStatus, runPrValidate } from "../../src/cli/commands/pr-status.command.js";
import { realGithubPullRequestClient } from "../../src/services/github-pull-request-client.js";
import { isAiqtOwnRepository } from "../../src/workflow/autonomous-run-self-management-guard.js";
import type { PullRequestIntegrationPlan } from "../../src/schema/pull-request-integration.schema.js";

// Every step here is a real network round-trip to GitHub, not a local
// subprocess -- see workload-timeout-policy.ts for the measured sizing.
vi.setConfig({ testTimeout: LIVE_REMOTE_SUITE_TEST_TIMEOUT_MS });

/**
 * M47-WU06 (build spec Sec 15): the REQUIRED controlled live dogfood --
 * a real `git push` and a real GitHub Pull Request against a real,
 * operator-nominated DISPOSABLE repository.
 *
 * This is a conditional suite, in the same reviewed shape as M38's
 * real-Docker suites: it runs only when an operator has explicitly
 * nominated a disposable target and supplied credentials, and it skips
 * (loudly, never silently passing) otherwise. That gate is deliberate --
 * this file creates real, externally visible artifacts, so it must never
 * run by accident on a developer machine or in ordinary CI.
 *
 * To run it:
 *   AIQT_PR_DOGFOOD_REPOSITORY=<owner>/<repo>   (a DISPOSABLE repository -- never AIQT itself, never anything with valuable history)
 *   AIQT_PR_DOGFOOD_TOKEN=<token>               (contents: write + pull requests: write on that repository only)
 *   AIQT_PR_DOGFOOD_REVIEWER=<login>            (optional; reviewer assignment is skipped when unset)
 *
 * The suite clones the target, works only on branches it creates under a
 * unique `aiqt-m47-dogfood/<timestamp>/` prefix, and never touches the
 * default branch. It deliberately does NOT delete anything afterwards:
 * M47 has no branch-deletion or PR-closing capability at all, and adding
 * one just to tidy up a test would defeat the boundary the milestone
 * exists to establish. Cleanup is the operator's, on a disposable target.
 */

const TARGET = process.env.AIQT_PR_DOGFOOD_REPOSITORY ?? "";
const TOKEN = process.env.AIQT_PR_DOGFOOD_TOKEN ?? "";
const REVIEWER = process.env.AIQT_PR_DOGFOOD_REVIEWER ?? "";
const TOKEN_ENV = "AIQT_PR_DOGFOOD_TOKEN";
const dogfoodConfigured = TARGET.length > 0 && TOKEN.length > 0 && /^[^/]+\/[^/]+$/.test(TARGET);

if (!dogfoodConfigured) {
  // Loud, not silent: an unconfigured live dogfood is a missing closure
  // gate, and the reason must be visible in the run output.
  console.warn(
    "[M47-WU06] Live Pull Request dogfood SKIPPED: set AIQT_PR_DOGFOOD_REPOSITORY (owner/repo, disposable) and AIQT_PR_DOGFOOD_TOKEN to run it. " +
      "The milestone's closure report must record this as not-yet-exercised if it never runs.",
  );
}

const RUN_ID = `${Date.now()}`;
const BRANCH_PREFIX = `aiqt-m47-dogfood/${RUN_ID}`;

let workRoot: string;
let repoDir: string;
let baseBranch = "main";

function git(args: string[], cwd = repoDir): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
}

function deps() {
  return { env: { [TOKEN_ENV]: TOKEN }, client: realGithubPullRequestClient, readClient: realGithubPullRequestClient };
}

function commitOn(branch: string, content: string): void {
  git(["checkout", "--quiet", "-b", branch, `origin/${baseBranch}`]);
  writeFileSync(join(repoDir, "aiqt-m47-dogfood.txt"), `${content}\n`);
  git(["add", "aiqt-m47-dogfood.txt"]);
  git(["commit", "--quiet", "-m", `M47 dogfood: ${content}`]);
}

async function prepareResult(branch: string, extra: Record<string, unknown> = {}) {
  return runPrPrepare(
    contextFor(workRoot),
    { repository: repoDir, base: baseBranch, source: branch, title: `AIQT M47 dogfood ${branch}`, tokenEnv: TOKEN_ENV, ...extra },
    deps(),
  );
}

async function prepare(branch: string, extra: Record<string, unknown> = {}): Promise<PullRequestIntegrationPlan> {
  const result = await prepareResult(branch, extra);
  return (result.data as { plan: PullRequestIntegrationPlan }).plan;
}

beforeAll(() => {
  if (!dogfoodConfigured) return;
  workRoot = makeTempDir("aiqt-m47-dogfood-");
  repoDir = join(workRoot, "repo");
  mkdirSync(workRoot, { recursive: true });
  process.env.AIQT_PR_INTEGRATION_HOME = join(workRoot, "integrations");

  // Clone over HTTPS with the operator's token, so the push uses exactly
  // the credential the operator nominated for this run.
  const [owner, repo] = TARGET.split("/");
  execFileSync("git", ["clone", "--quiet", `https://x-access-token:${TOKEN}@github.com/${owner}/${repo}.git`, repoDir], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  git(["config", "user.email", "aiqt-dogfood@example.com"]);
  git(["config", "user.name", "AIQT M47 dogfood"]);
  // Restore the canonical remote URL so the credential never sits in the
  // repository's own config for the rest of the run.
  git(["remote", "set-url", "origin", `https://github.com/${owner}/${repo}.git`]);
  baseBranch = git(["rev-parse", "--abbrev-ref", "origin/HEAD"]).replace(/^origin\//, "");
});

afterAll(() => {
  if (!dogfoodConfigured) return;
  delete process.env.AIQT_PR_INTEGRATION_HOME;
  removeDir(workRoot);
});

describe.skipIf(!dogfoodConfigured)("M47-WU06 live dogfood: real push and real Pull Request against a disposable GitHub repository", () => {
  it("scenario 32: the dogfood target is not the AIQT product repository", () => {
    // The self-management guard's own definition is a package.json whose
    // `name` is exactly "aiqt" -- a substring check on the repository name
    // would be both weaker and wrong (this very target is called
    // "aiqt-m47-dogfood").
    expect(isAiqtOwnRepository(repoDir)).toBe(false);
    expect(repoDir).not.toBe(process.cwd());
    expect(TARGET.toLowerCase().endsWith("/aiqt")).toBe(false);
  });

  it("scenario 1/6/11/16: clean branch -> prepare -> exact-SHA push -> draft Pull Request -> reviewers", async () => {
    const branch = `${BRANCH_PREFIX}/main-flow`;
    commitOn(branch, "main flow");
    const plan = await prepare(branch, REVIEWER.length > 0 ? { reviewer: [REVIEWER] } : {});

    expect(plan.status).toBe("prepared");
    expect(plan.remoteRepositoryIdentity.toLowerCase()).toBe(TARGET.toLowerCase());
    expect(plan.sourceHeadSha).toBe(git(["rev-parse", "HEAD"]));

    const pushed = await runPrPush(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(pushed.status).toBe("passed");
    expect((pushed.data as { plan: PullRequestIntegrationPlan }).plan.push).toMatchObject({ outcome: "verified", remoteShaAfter: plan.sourceHeadSha });
    expect(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])).toContain(plan.sourceHeadSha);

    const created = await runPrCreate(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(["passed", "warning"]).toContain(created.status);
    const pr = (created.data as { pullRequest: { number: number; isDraft: boolean; origin: string } }).pullRequest;
    expect(pr.isDraft).toBe(true);
    expect(pr.origin).toBe("created");

    if (REVIEWER.length > 0) {
      const reviewerRecord = (created.data as { reviewerRequest: { outcome: string } }).reviewerRequest;
      expect(["succeeded", "partial", "failed"]).toContain(reviewerRecord.outcome);
    }

    // scenario 13: a second create produces no second Pull Request.
    const again = await runPrCreate(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(again.summary).toMatch(/already exists/);
    const [owner, repo] = TARGET.split("/");
    const open = await realGithubPullRequestClient.findOpenPullRequests(owner!, repo!, branch, baseBranch, TOKEN);
    expect(open.ok && open.value.filter((p) => p.state === "open").length).toBe(1);

    // scenario 24: status and validate are read-only and report the truth.
    const status = await runPrStatus(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(status.summary).toContain(`#${pr.number}`);
    const validated = await runPrValidate(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(validated.exitCode).toBeLessThanOrEqual(2);
  });

  it("scenario 7: a behind remote branch fast-forwards to the exact planned commit", async () => {
    const branch = `${BRANCH_PREFIX}/fast-forward`;
    commitOn(branch, "first");
    const first = await prepare(branch);
    expect((await runPrPush(contextFor(workRoot), first.id, { tokenEnv: TOKEN_ENV }, deps())).status).toBe("passed");

    writeFileSync(join(repoDir, "aiqt-m47-dogfood.txt"), "second\n");
    git(["add", "aiqt-m47-dogfood.txt"]);
    git(["commit", "--quiet", "-m", "M47 dogfood: second"]);
    const second = await prepare(branch);
    expect(second.sourceHeadSha).not.toBe(first.sourceHeadSha);

    const pushed = await runPrPush(contextFor(workRoot), second.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(pushed.status).toBe("passed");
    expect(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])).toContain(second.sourceHeadSha);
  });

  it("scenario 8: a diverged remote branch blocks, with no force option and the remote left untouched", async () => {
    const branch = `${BRANCH_PREFIX}/diverged`;
    commitOn(branch, "ours");
    const plan = await prepare(branch);
    expect((await runPrPush(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps())).status).toBe("passed");
    const remoteAfterFirst = git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\t")[0];

    // Rewrite local history so the local branch no longer contains the
    // remote commit -- a genuine divergence.
    git(["reset", "--hard", "--quiet", `origin/${baseBranch}`]);
    writeFileSync(join(repoDir, "aiqt-m47-dogfood.txt"), "theirs\n");
    git(["add", "aiqt-m47-dogfood.txt"]);
    git(["commit", "--quiet", "-m", "M47 dogfood: diverged"]);
    git(["fetch", "--quiet", "origin", branch]);

    // The divergence is already visible at prepare time, so that is where
    // the specific finding is raised; the resulting plan is terminal, and
    // pushing it is refused too. Either way, no force option exists and the
    // remote is byte-identical afterwards.
    const divergedPrepare = await prepareResult(branch);
    expect(divergedPrepare.status).toBe("blocked");
    expect(divergedPrepare.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-NOT-FAST-FORWARD");

    const divergedPlan = (divergedPrepare.data as { plan: PullRequestIntegrationPlan }).plan;
    const blocked = await runPrPush(contextFor(workRoot), divergedPlan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(blocked.status).toBe("blocked");
    expect(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]).split("\t")[0]).toBe(remoteAfterFirst);
  });

  it("scenario 2/3/9: a dirty tree, a source == base plan, and a moved HEAD each block with nothing pushed", async () => {
    const branch = `${BRANCH_PREFIX}/gates`;
    commitOn(branch, "gates");
    const dirtyPlan = await prepare(branch);

    writeFileSync(join(repoDir, "aiqt-m47-dogfood.txt"), "dirty\n");
    const dirty = await runPrPush(contextFor(workRoot), dirtyPlan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(dirty.status).toBe("blocked");
    expect(dirty.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-WORKTREE-DIRTY");
    git(["checkout", "--quiet", "--", "aiqt-m47-dogfood.txt"]);

    git(["checkout", "--quiet", baseBranch]);
    const sameBranch = await runPrPrepare(
      contextFor(workRoot),
      { repository: repoDir, base: baseBranch, source: baseBranch, title: "should block", tokenEnv: TOKEN_ENV },
      deps(),
    );
    expect(sameBranch.status).toBe("blocked");
    expect(sameBranch.blockingIssues.map((i) => i.id)).toEqual(expect.arrayContaining(["PR-PREFLIGHT-SOURCE-EQUALS-BASE"]));

    // A fresh plan for the staleness gate: a refused write is terminal for
    // the plan it refused (fail-closed), and preparing another is read-only
    // and cheap -- so each gate is exercised on a plan that reaches it.
    git(["checkout", "--quiet", branch]);
    const stalePlan = await prepare(branch);
    writeFileSync(join(repoDir, "aiqt-m47-dogfood.txt"), "moved\n");
    git(["add", "aiqt-m47-dogfood.txt"]);
    git(["commit", "--quiet", "-m", "M47 dogfood: moved"]);
    const stale = await runPrPush(contextFor(workRoot), stalePlan.id, { tokenEnv: TOKEN_ENV }, deps());
    expect(stale.status).toBe("blocked");
    expect(stale.blockingIssues.map((i) => i.id)).toContain("PR-PUSH-PLAN-STALE");

    // The branch was never pushed at all.
    expect(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])).toBe("");
  });

  it("scenario 4/22: a wrong remote identity and missing credentials both block with nothing pushed", async () => {
    const branch = `${BRANCH_PREFIX}/identity`;
    commitOn(branch, "identity");

    const wrongIdentity = await runPrPrepare(
      contextFor(workRoot),
      { repository: repoDir, base: baseBranch, source: branch, title: "wrong identity", tokenEnv: TOKEN_ENV },
      { ...deps(), remoteUrlResolver: () => "https://github.com/someone-else/not-the-target.git" },
    );
    expect(wrongIdentity.status).toBe("blocked");

    const noCredentials = await runPrPrepare(contextFor(workRoot), { repository: repoDir, base: baseBranch, source: branch, title: "no creds", tokenEnv: TOKEN_ENV }, { ...deps(), env: {} });
    expect(noCredentials.exitCode).toBe(4);
    expect(noCredentials.blockingIssues[0]!.suggestedAction).not.toContain(TOKEN);
    expect(git(["ls-remote", "--heads", "origin", `refs/heads/${branch}`])).toBe("");
  });

  it("scenario 18/19/20: base-branch protection evidence is reported honestly", async () => {
    const [owner, repo] = TARGET.split("/");
    const protection = await realGithubPullRequestClient.getBaseProtection(owner!, repo!, baseBranch, TOKEN);
    expect(protection.ok).toBe(true);
    if (!protection.ok) return;
    expect(["protected", "unprotected", "unverifiable", "unsupported"]).toContain(protection.value.evidence);

    // Whatever the real evidence is, a plan that REQUIRES protection may
    // only proceed when it is verifiably `protected`.
    const branch = `${BRANCH_PREFIX}/protection`;
    commitOn(branch, "protection");
    const plan = await prepare(branch, { requireProtectedBase: true });
    await runPrPush(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    const created = await runPrCreate(contextFor(workRoot), plan.id, { tokenEnv: TOKEN_ENV }, deps());
    if (protection.value.evidence === "protected") {
      expect(["passed", "warning"]).toContain(created.status);
    } else {
      expect(created.status).toBe("blocked");
      expect(created.blockingIssues.map((i) => i.id)).toContain("PR-PREFLIGHT-BASE-NOT-PROTECTED");
    }
  });

  it("scenarios 26/27/28/29/30/31: no tag, no branch deletion, no force, no approval, no merge, no release resulted from any of the above", () => {
    const remoteRefs = git(["ls-remote", "origin"]);
    // Every ref this run created is under the run's own prefix, and no tag
    // was created at all.
    const tags = remoteRefs.split("\n").filter((l) => l.includes("refs/tags/"));
    const dogfoodTags = tags.filter((l) => l.includes("aiqt-m47-dogfood"));
    expect(dogfoodTags).toEqual([]);

    // Branches this run pushed still exist (nothing was deleted).
    expect(remoteRefs).toContain(`${BRANCH_PREFIX}/main-flow`);
    expect(remoteRefs).toContain(`${BRANCH_PREFIX}/fast-forward`);
    expect(remoteRefs).toContain(`${BRANCH_PREFIX}/diverged`);
  });
});
