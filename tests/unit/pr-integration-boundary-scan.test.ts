import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M47-WU01 boundary scan (build spec Sec 14 WU47-01: "Pure contracts/
 * ownership/freshness/idempotency/state decision. No remote writes.").
 * Follows the established M27/M28/M36/M37 boundary-scan pattern: scoped to
 * exactly this Work Unit's own file set, so it cannot false-positive on
 * M25's Git command runner or M40's GitHub client, and proves only this
 * Work Unit's own "still contract-only" claim.
 */
const M47_WU01_FILES = [
  "src/schema/pull-request-integration.schema.ts",
  "src/workflow/pr-integration-identity.ts",
  "src/workflow/pr-integration-lifecycle.ts",
  "src/state/pr-integration-home.ts",
  "src/state/pr-integration-versioning.ts",
  "src/state/pr-integration-store.ts",
];

/** Only the store legitimately touches the filesystem; every other WU47-01 file is pure. */
const M47_WU01_PURE_FILES = M47_WU01_FILES.filter((f) => f !== "src/state/pr-integration-store.ts" && f !== "src/state/pr-integration-home.ts");

const codeOnly = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
    .join("\n");

describe("M47-WU01 boundary scan: contract/state files perform no remote write, no network, no process execution", () => {
  const surfaces: { pattern: RegExp; label: string }[] = [
    { pattern: /\bchild_process\b/, label: "child_process (process spawning)" },
    { pattern: /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, label: "a child_process execution function" },
    { pattern: /\bnode:net\b|\bnode:http\b|\bnode:https\b|\bnode:tls\b|\bnode:dns\b/, label: "a network module" },
    { pattern: /\bfetch\s*\(/, label: "fetch( (network)" },
    { pattern: /\bWebSocket\b|\bXMLHttpRequest\b/, label: "a network client" },
    { pattern: /@anthropic-ai\/(claude-agent-sdk|sdk)/, label: "Claude/Anthropic SDK dependency (model invocation)" },
    { pattern: /\beval\s*\(|new\s+Function\s*\(|\bvm\.(Script|createContext|runIn)/, label: "dynamic code execution" },
    { pattern: /\brequire\s*\(/, label: "require() (this codebase is ESM-only)" },
  ];

  for (const relPath of M47_WU01_FILES) {
    it(`${relPath} contains none of the forbidden execution/network surfaces`, () => {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of surfaces) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    });
  }

  it("no WU47-01 file imports the Git command runner or the GitHub client (this Work Unit cannot reach either write surface)", () => {
    for (const relPath of M47_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import git-command-runner.js`).not.toMatch(/git-command-runner\.js/);
      expect(text, `${relPath} should not import github-release-client.js`).not.toMatch(/github-release-client\.js/);
    }
  });

  it("no WU47-01 file imports a CLI command module (no dispatch capability)", () => {
    for (const relPath of M47_WU01_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import a CLI command module`).not.toMatch(/from\s+["'].*cli\/commands/);
    }
  });

  it("the pure contract files perform no filesystem I/O at all -- only the store and home resolver may", () => {
    for (const relPath of M47_WU01_PURE_FILES) {
      const text = readFileSync(join(repoRoot, relPath), "utf8");
      expect(text, `${relPath} should not import node:fs`).not.toMatch(/from\s+["']node:fs["']/);
    }
  });

  it("no WU47-01 file can merge, approve, force-push, delete a ref, push a tag, deploy, or publish a release (structural check, comments excluded)", () => {
    const forbidden: { pattern: RegExp; label: string }[] = [
      { pattern: /\bgitMerge\b|\.merge\(|\bmergePullRequest\b/i, label: "a merge operation" },
      { pattern: /\bapprovePullRequest\b|\bsubmitReview\b|["'`]APPROVE["'`]/, label: "a PR approval operation" },
      { pattern: /--force-with-lease|--force\b|\bforcePush\b/, label: "a force push" },
      { pattern: /\bdeleteRef\b|\bdeleteBranch\b/, label: "a ref/branch deletion" },
      { pattern: /\bpushTag\b|\bcreateTag\b/, label: "a tag push/creation" },
      { pattern: /\bdeploy\(|\bpublishRelease\b|\bcreateRelease\b/, label: "a deploy/release publication" },
    ];
    for (const relPath of M47_WU01_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of forbidden) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });
});

describe("M47-WU01: the state boundary is a separate, non-repository-local store", () => {
  it("pr-integration-home.ts never resolves into a target repository or into an .aiqt/ project directory of the current working directory", () => {
    const text = readFileSync(join(repoRoot, "src", "state", "pr-integration-home.ts"), "utf8");
    expect(text).toMatch(/homedir\(\)/);
    expect(text, "plans must never be stored relative to process.cwd()").not.toMatch(/process\.cwd\(\)/);
    expect(text, "plans must never reuse the repository-local .aiqt path owner").not.toMatch(/resolveAiqtPaths|AIQT_DIR_NAME/);
  });

  it("no WU47-01 file writes a parallel `.aiqt/pr*.json` state database (code only -- a doc comment naming what is deliberately NOT created does not itself violate this)", () => {
    for (const relPath of M47_WU01_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not reference a .aiqt/pr*.json path`).not.toMatch(/\.aiqt[/\\]pr[a-z-]*\.json/i);
    }
  });

  it("M47 does not change the canonical project-state schema version", () => {
    const text = readFileSync(join(repoRoot, "src", "core", "constants", "schema-version.ts"), "utf8");
    expect(text).toMatch(/AIQT_SCHEMA_VERSION = "0\.7\.0"/);
  });

  it("package.json declares no new runtime dependency for M47-WU01 (still exactly @inquirer/prompts, commander, zod)", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the AIQT repository root still has no .aiqt/ directory", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M47-WU02 boundary scan (build spec Sec 14 WU47-02: "Read-only
 * repository/remote/base/source/HEAD/protection/provider preflight").
 * This Work Unit adds the first real repository and network reads, and a
 * public CLI surface -- these guards prove all of it stays read-only.
 */
const M47_WU02_FILES = [
  "src/workflow/pr-remote-identity.ts",
  "src/workflow/pr-preflight.ts",
  "src/services/github-pull-request-client.ts",
  "src/services/pr-preflight-service.ts",
  "src/cli/commands/pr-shared.ts",
  "src/cli/commands/pr-prepare.command.ts",
];

/** Exactly the git-command-runner exports the preflight service may call -- every one read-only. */
const ALLOWED_PREFLIGHT_GIT_FUNCTIONS = [
  "gitIsInsideWorkTree",
  "gitCurrentBranch",
  "gitDiffQuietIsClean",
  "gitLsFilesOthersExcludeStandard",
  "gitRevParse",
  "gitRemoteGetUrl",
  "gitLsRemoteHead",
  "gitLsRemoteDefaultBranch",
  "gitCommitExists",
  "gitIsAncestor",
  "GitRunnerError",
];

describe("M47-WU02 boundary scan: preflight and prepare are read-only", () => {
  it("the preflight service imports only read-only git-command-runner exports", () => {
    const text = readFileSync(join(repoRoot, "src", "services", "pr-preflight-service.ts"), "utf8");
    const importMatch = /import\s*\{([^}]*)\}\s*from\s*["'].*git-command-runner\.js["']/.exec(text);
    expect(importMatch, "pr-preflight-service.ts should import from git-command-runner.js").not.toBeNull();
    const imported = importMatch![1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const unexpected = imported.filter((name) => !ALLOWED_PREFLIGHT_GIT_FUNCTIONS.includes(name));
    expect(unexpected, `pr-preflight-service.ts imports unexpected git-command-runner exports: ${unexpected.join(", ")}`).toEqual([]);
  });

  it("no WU47-02 file references a mutating Git surface", () => {
    const forbidden: { pattern: RegExp; label: string }[] = [
      { pattern: /\bgitWorktreeAdd\b|\bgitWorktreeRemove\b/, label: "worktree mutation" },
      { pattern: /\bgitPush\w*\b/, label: "a push function (WU47-03 owns the first write)" },
      { pattern: /--force|--delete\b|\bpush\s+--tags\b/, label: "force / delete / tag-push arguments" },
      { pattern: /\bexecFileSync\b|\bspawnSync\b|\bexecFile\b|\bspawn\b|\bexecSync\b/, label: "a direct child_process execution function" },
    ];
    for (const relPath of M47_WU02_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      for (const { pattern, label } of forbidden) {
        expect(pattern.test(text), `${relPath} unexpectedly matched forbidden pattern: ${label}`).toBe(false);
      }
    }
  });

  // "the Pull Request client makes only GET requests" and "no
  // requested_reviewers endpoint exists yet" were true, deliberately
  // asserted WU47-02 invariants. WU47-04 explicitly lifts both (build spec
  // Sec 10 gives it PR creation and reviewer assignment). They are replaced
  // here by the narrower invariant that still holds after WU47-04 -- the
  // READ client's own operations remain read-only -- rather than being left
  // to fail silently. The full post-WU47-04 write surface is pinned by the
  // M47-WU04 section below.
  it("the read client's own operations issue no request body and no non-GET method", () => {
    const text = codeOnly(readFileSync(join(repoRoot, "src", "services", "github-pull-request-client.ts"), "utf8"));
    const readSection = text.slice(text.indexOf("realGithubPullRequestReadClient: PullRequestProviderReadClient"), text.indexOf("realGithubPullRequestClient: PullRequestProviderClient"));
    expect(readSection.length).toBeGreaterThan(0);
    expect(readSection, "no non-GET method should be issued by the read client").not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    expect(readSection, "no merge endpoint").not.toMatch(/\/merge\b/);
    expect(readSection, "no review/approval endpoint").not.toMatch(/\/reviews\b|["'`]APPROVE["'`]/);
  });

  it("only the pull-request client and the release client may contact the network at all", () => {
    for (const relPath of M47_WU02_FILES) {
      if (relPath === "src/services/github-pull-request-client.ts") continue;
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(/\bfetch\s*\(/.test(text), `${relPath} should not call fetch directly`).toBe(false);
    }
  });

  it("prepare calls the self-management guard before using any repository path", () => {
    const service = readFileSync(join(repoRoot, "src", "services", "pr-preflight-service.ts"), "utf8");
    expect(service).toMatch(/isAiqtOwnRepository/);
  });

  it("no WU47-02 file places a raw remote URL or a token into a result, a plan, or a message", () => {
    // The remote URL can embed a credential, so it must never be carried
    // anywhere except through the parser that discards it.
    const service = codeOnly(readFileSync(join(repoRoot, "src", "services", "pr-preflight-service.ts"), "utf8"));
    expect(service).toMatch(/parseGitHubRemoteUrl\(remoteUrl\)/);
    expect(service, "the raw URL must not be returned in the observation set").not.toMatch(/remoteUrl:\s*remoteUrl/);

    const identity = readFileSync(join(repoRoot, "src", "workflow", "pr-remote-identity.ts"), "utf8");
    expect(identity, "the parse result must not carry a url field").not.toMatch(/^\s*url:/m);

    for (const relPath of M47_WU02_FILES) {
      // The Authorization header is the one place a token is legitimately
      // interpolated; anywhere else would be a leak into output or state.
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8")).split("`Bearer ${token}`").join("");
      expect(text, `${relPath} should not interpolate a token anywhere except the Authorization header`).not.toMatch(/\$\{token\}/);
    }
  });

  it("credentials are read only from an operator-named environment variable, never a CLI flag", () => {
    const shared = readFileSync(join(repoRoot, "src", "cli", "commands", "pr-shared.ts"), "utf8");
    expect(shared).toMatch(/env\[envName\]/);
    const register = readFileSync(join(repoRoot, "src", "cli", "register-commands.ts"), "utf8");
    const prSection = register.slice(register.indexOf('.command("pr")'));
    expect(prSection).toMatch(/--token-env <name>/);
    expect(prSection, "no flag may accept a token value directly").not.toMatch(/--token <|--github-token/);
  });

  it("no WU47-02 file can approve, merge, deploy, or publish (structural check, comments excluded)", () => {
    for (const relPath of M47_WU02_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a merge/approve/deploy/publish operation`).not.toMatch(
        /\bgitMerge\b|\bmergePullRequest\b|\bapprovePullRequest\b|\bdeploy\(|\bpublishRelease\b|\bcreateReleaseDraft\b/i,
      );
    }
  });

  it("package.json still declares no new runtime dependency for M47-WU02", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });
});

/**
 * M47-WU03 boundary scan (build spec Sec 8, threat model T5/T6/T7):
 * this Work Unit adds the first, and only, remote-write capability in the
 * repository. These guards prove that capability is exactly one non-force,
 * single-ref, exact-commit branch push and nothing more -- structurally,
 * not by convention.
 */
const M47_WU03_FILES = ["src/services/pr-push-service.ts", "src/cli/commands/pr-push.command.ts"];

describe("M47-WU03 boundary scan: the remote-write capability is exactly one non-force single-ref push", () => {
  const runnerPath = join(repoRoot, "src", "workspaces", "git-command-runner.ts");

  it("git-command-runner.ts contains exactly one push invocation, with a fixed argument template", () => {
    const text = codeOnly(readFileSync(runnerPath, "utf8"));
    const pushInvocations = text.match(/execGit\(\[\s*"push"/g) ?? [];
    expect(pushInvocations, "exactly one push call site may exist").toHaveLength(1);
    expect(text).toMatch(/execGit\(\["push", "--porcelain", remoteName, `\$\{commitSha\}:refs\/heads\/\$\{branch\}`\]/);
  });

  it("no force, force-with-lease, delete, tag, mirror, or wildcard push argument exists anywhere in the Git runner", () => {
    const text = codeOnly(readFileSync(runnerPath, "utf8"));
    for (const forbidden of ["--force", "--force-with-lease", "--delete", "--tags", "--mirror", "--all", "--prune", "+refs/"]) {
      expect(text.includes(forbidden), `git-command-runner.ts must not contain ${forbidden}`).toBe(false);
    }
  });

  it("the push refspec can never express a deletion (the source side is always a commit SHA, never empty)", () => {
    const text = codeOnly(readFileSync(runnerPath, "utf8"));
    expect(text, "a leading ':' refspec would delete the remote ref").not.toMatch(/`:refs\/heads\//);
    expect(text).toMatch(/GIT_PUSH_INVALID_COMMIT/);
    expect(text).toMatch(/GIT_PUSH_INVALID_BRANCH/);
    expect(text).toMatch(/GIT_PUSH_INVALID_REMOTE/);
  });

  it("only the push service may call the push runner function -- no command or other service reaches it directly", () => {
    const callers = ["src/cli/commands/pr-push.command.ts", "src/cli/commands/pr-prepare.command.ts", "src/services/pr-preflight-service.ts", "src/cli/commands/pr-shared.ts"];
    for (const relPath of callers) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text.includes("gitPushExactCommitToBranch"), `${relPath} must not call the push runner directly`).toBe(false);
    }
    const service = readFileSync(join(repoRoot, "src", "services", "pr-push-service.ts"), "utf8");
    expect(service).toMatch(/gitPushExactCommitToBranch/);
  });

  it("the push service verifies the remote after the write on every path -- success is never inferred from the exit code alone", () => {
    const text = codeOnly(readFileSync(join(repoRoot, "src", "services", "pr-push-service.ts"), "utf8"));
    // Exactly one verification read, performed after the try/catch, so both
    // the succeeded and threw paths reach it.
    expect((text.match(/readRemote\(deps,/g) ?? []).length).toBe(1);
    expect(text).toMatch(/outcome: "verified"/);
    expect(text).toMatch(/outcome: "ambiguous"/);
  });

  it("no WU47-03 file can merge, approve, deploy, publish, or create a Pull Request (creation is WU47-04's own reviewed surface)", () => {
    for (const relPath of M47_WU03_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a merge/approve/deploy/publish operation`).not.toMatch(
        /\bgitMerge\b|\bmergePullRequest\b|\bapprovePullRequest\b|\bdeploy\(|\bpublishRelease\b|\bcreatePullRequest\b/i,
      );
      expect(/\bfetch\s*\(/.test(text), `${relPath} should not call fetch directly`).toBe(false);
    }
  });

  it("the push command runs freshness and preflight before the write, in that order", () => {
    const text = readFileSync(join(repoRoot, "src", "cli", "commands", "pr-push.command.ts"), "utf8");
    const freshnessAt = text.indexOf("evaluatePlanFreshness(plan, observedFacts)");
    const preflightAt = text.indexOf("evaluatePrPreflight(obs)");
    const pushAt = text.indexOf("performExactShaPush(");
    expect(freshnessAt).toBeGreaterThan(-1);
    expect(preflightAt).toBeGreaterThan(freshnessAt);
    expect(pushAt).toBeGreaterThan(preflightAt);
  });

  it("package.json still declares no new runtime dependency for M47-WU03", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the AIQT repository root still has no .aiqt/ directory now that a real remote-write path exists", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});

/**
 * M47-WU04 boundary scan (build spec Sec 10, threat model T11/T13/T14/T21):
 * Pull Request creation is the second and last remote-write capability.
 * These guards prove the write surface is exactly three provider
 * operations, that none of them can approve or merge, and that a create is
 * never issued without a preceding lookup.
 */
const M47_WU04_FILES = ["src/services/pr-create-service.ts", "src/cli/commands/pr-create.command.ts", "src/services/github-pull-request-client.ts"];

describe("M47-WU04 boundary scan: creation cannot approve, merge, or duplicate", () => {
  const clientPath = join(repoRoot, "src", "services", "github-pull-request-client.ts");

  it("the provider client contains exactly three non-GET requests, all POST", () => {
    const text = codeOnly(readFileSync(clientPath, "utf8"));
    const methods = text.match(/method:\s*"(POST|PUT|PATCH|DELETE)"/g) ?? [];
    expect(methods).toEqual(['method: "POST"', 'method: "POST"']);
    // (create and requestReviewers; getPullRequest and every read are GET.)
    expect(text).not.toMatch(/method:\s*"(PUT|PATCH|DELETE)"/);
  });

  it("no GitHub merge, review/approval, label, or close endpoint appears anywhere in src/", () => {
    const text = codeOnly(readFileSync(clientPath, "utf8"));
    for (const forbidden of ["/merge", "/reviews", "/labels", '"APPROVE"', "merge_method", "state: \"closed\""]) {
      expect(text.includes(forbidden), `github-pull-request-client.ts must not reference ${forbidden}`).toBe(false);
    }
    const releaseClient = codeOnly(readFileSync(join(repoRoot, "src", "services", "github-release-client.ts"), "utf8"));
    expect(releaseClient.includes("/merge")).toBe(false);
  });

  it("reviewer requests can never expand into a team or organization request", () => {
    const text = codeOnly(readFileSync(clientPath, "utf8"));
    expect(text).toMatch(/requested_reviewers/);
    expect(text.includes("team_reviewers"), "team_reviewers would turn an explicit request into an org-scoped one").toBe(false);
  });

  it("the create service always looks up before it creates", () => {
    const text = codeOnly(readFileSync(join(repoRoot, "src", "services", "pr-create-service.ts"), "utf8"));
    const firstLookup = text.indexOf("client.findOpenPullRequests(");
    const create = text.indexOf("client.createPullRequest(");
    expect(firstLookup).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(firstLookup);
    // And a failed create is followed by another lookup, never a retry.
    expect((text.match(/client\.findOpenPullRequests\(/g) ?? []).length).toBe(2);
    expect((text.match(/client\.createPullRequest\(/g) ?? []).length).toBe(1);
  });

  it("the create command refuses to create a second Pull Request for a plan that already has one", () => {
    const text = codeOnly(readFileSync(join(repoRoot, "src", "cli", "commands", "pr-create.command.ts"), "utf8"));
    const guard = text.indexOf("if (plan.pullRequest !== null)");
    const create = text.indexOf("createOrReconcilePullRequest(");
    expect(guard).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(guard);
  });

  it("draft is the default: only an explicit ready createMode produces draft: false", () => {
    const text = codeOnly(readFileSync(join(repoRoot, "src", "cli", "commands", "pr-create.command.ts"), "utf8"));
    const service = codeOnly(readFileSync(join(repoRoot, "src", "services", "pr-create-service.ts"), "utf8"));
    expect(service).toMatch(/draft: plan\.createMode === "draft"/);
    expect(text + service, "no unconditional draft: false may exist").not.toMatch(/draft:\s*false/);
  });

  it("no WU47-04 file can merge, approve, deploy, publish, delete a ref, or force-push", () => {
    for (const relPath of M47_WU04_FILES) {
      const text = codeOnly(readFileSync(join(repoRoot, relPath), "utf8"));
      expect(text, `${relPath} should not invoke a forbidden operation`).not.toMatch(
        /\bmergePullRequest\b|\bapprovePullRequest\b|\bsubmitReview\b|\bdeploy\(|\bpublishRelease\b|--force|\bdeleteRef\b|\bgitPushExactCommitToBranch\b/i,
      );
    }
  });

  it("package.json still declares no new runtime dependency for M47-WU04", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["@inquirer/prompts", "commander", "zod"]);
  });

  it("the AIQT repository root still has no .aiqt/ directory", () => {
    expect(existsSync(join(repoRoot, ".aiqt"))).toBe(false);
  });
});
