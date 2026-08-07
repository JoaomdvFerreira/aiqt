import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M34-WU02: this file spawns real subprocesses (git, via initGitFixtureRepo).
// Uses the shared class constant, not a locally hardcoded literal.
vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });
import { makeTempDir, removeDir, initGitFixtureRepo, contextFor } from "../helpers.js";
import { runReleaseDraft } from "../../src/cli/commands/release-draft.command.js";
import { checkDraftPrerequisites, parseOwnerRepo, missingGithubTokenActions } from "../../src/workflow/release-draft-policy.js";
import type { GithubReleaseClient, GithubApiOutcome, GithubRepositoryFacts, GithubExistingRelease, GithubCreatedRelease } from "../../src/services/github-release-client.js";
import type { ReleaseDecision } from "../../src/schema/release-governance.schema.js";

/**
 * M40-WU04: every test here injects a fake GithubReleaseClient -- no real
 * network call is ever made. This mirrors the repository's established
 * dependency-injection pattern for external boundaries (e.g. the
 * autonomous-run AgentAdapter interface).
 */

function fakeClient(overrides: Partial<GithubReleaseClient> = {}): GithubReleaseClient {
  return {
    getRepository: async (): Promise<GithubApiOutcome<GithubRepositoryFacts>> => ({ ok: true, value: { fullName: "example/widget" } }),
    getReleaseByTag: async (): Promise<GithubApiOutcome<GithubExistingRelease | null>> => ({ ok: true, value: null }),
    createReleaseDraft: async (): Promise<GithubApiOutcome<GithubCreatedRelease>> => ({ ok: true, value: { id: 42, htmlUrl: "https://github.com/example/widget/releases/42" } }),
    ...overrides,
  };
}

describe("release-draft-policy: prerequisites (pure, no network)", () => {
  it("parseOwnerRepo accepts owner/repo and rejects everything else", () => {
    expect(parseOwnerRepo("example/widget")).toEqual({ owner: "example", repo: "widget" });
    expect(parseOwnerRepo("not-a-repo-identity")).toBeNull();
    expect(parseOwnerRepo("too/many/slashes")).toBeNull();
    expect(parseOwnerRepo("")).toBeNull();
  });

  it("missingGithubTokenActions never contains a token value, only guidance text", () => {
    const actions = missingGithubTokenActions("GITHUB_TOKEN");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.join(" ")).toMatch(/GITHUB_TOKEN/);
    expect(actions.join(" ")).not.toMatch(/ghp_|github_pat_/);
  });
});

describe("aiqt release draft", () => {
  let dir: string;
  let headCommit: string;
  let reqFile: string;

  beforeEach(() => {
    dir = makeTempDir("aiqt-release-draft-");
    headCommit = initGitFixtureRepo(dir);
    execFileSync("git", ["tag", "m1-done"], { cwd: dir });
    reqFile = join(dir, "req.json");
    const body = {
      repositoryIdentity: "example/widget",
      packageVersion: "1.0.0",
      intendedReleaseTag: "v1.0.0",
      milestones: [{ milestoneId: "m1", tag: "m1-done", closureCommit: headCommit }],
      ciCommit: headCommit,
      ciStatus: "verified",
      validationEvidenceDigest: "sha256:aaaa",
      securityEvidenceStatus: "verified",
      declaredPresent: ["breakingChanges", "migration", "rollback", "knownLimitations", "releaseNotes"],
      riskSignals: {
        regressionExposureLevel: "low",
        blastRadiusLevel: "low",
        testConfidenceLevel: "high",
        operationalComplexityLevel: "low",
        breakingChangesDeclared: false,
        migrationDeclared: false,
        rollbackDeclared: true,
        dogfoodMaturityLevel: "proven",
        knownLimitationsDeclared: true,
      },
    };
    writeFileSync(reqFile, JSON.stringify(body));
  });

  afterEach(() => {
    removeDir(dir);
  });

  it("creates a draft, hardcoding draft semantics -- returns a bounded id/url, never publishes", async () => {
    const client = fakeClient();
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: { GITHUB_TOKEN: "test-token" } });
    expect(result.status).not.toBe("failed");
    expect(result.status).not.toBe("blocked");
    const data = result.data as { decision: ReleaseDecision };
    expect(data.decision.draft.status).toBe("created");
    expect(data.decision.draft.url).toBe("https://github.com/example/widget/releases/42");
    expect(data.decision.draft.id).toBe("42");
    expect(result.summary).toMatch(/NOT published/);
  });

  it("requires explicit command intent: fails closed with no --from-file/--stdin", async () => {
    const result = await runReleaseDraft(contextFor(dir), {}, { env: { GITHUB_TOKEN: "test-token" } });
    expect(result.status).toBe("failed");
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-MISSING-INPUT")).toBe(true);
  });

  it("blocks when candidate readiness is blocked (stale/mismatched provenance) -- no network call attempted", async () => {
    const body = JSON.parse(readFileSync(reqFile, "utf8"));
    body.ciCommit = "0000000000000000000000000000000000000000";
    writeFileSync(reqFile, JSON.stringify(body));

    let called = false;
    const client = fakeClient({
      getRepository: async () => {
        called = true;
        return { ok: true, value: { fullName: "example/widget" } };
      },
    });
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: { GITHUB_TOKEN: "test-token" } });
    expect(result.status).toBe("blocked");
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-DRAFT-PREREQUISITE-BLOCKED")).toBe(true);
    expect(called).toBe(false);
  });

  it("blocks a non-owner/repo repositoryIdentity before any network call", async () => {
    const body = JSON.parse(readFileSync(reqFile, "utf8"));
    body.repositoryIdentity = "not-a-github-identity";
    writeFileSync(reqFile, JSON.stringify(body));

    let called = false;
    const client = fakeClient({
      getRepository: async () => {
        called = true;
        return { ok: true, value: { fullName: "not-a-github-identity" } };
      },
    });
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: { GITHUB_TOKEN: "test-token" } });
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-DRAFT-PREREQUISITE-BLOCKED")).toBe(true);
    expect(called).toBe(false);
  });

  it("returns a clear operator action list, exit MissingDependency, when the token env var is unset -- no network call attempted", async () => {
    let called = false;
    const client = fakeClient({
      getRepository: async () => {
        called = true;
        return { ok: true, value: { fullName: "example/widget" } };
      },
    });
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: {} });
    expect(result.exitCode).toBe(4);
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-DRAFT-MISSING-CREDENTIALS")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/ghp_|github_pat_/);
    expect(called).toBe(false);
  });

  it("blocks on a repository identity mismatch reported by GitHub", async () => {
    const client = fakeClient({ getRepository: async () => ({ ok: true, value: { fullName: "someone-else/other-repo" } }) });
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: { GITHUB_TOKEN: "test-token" } });
    expect(result.blockingIssues.some((i) => i.id === "RELEASE-DRAFT-REPOSITORY-IDENTITY-MISMATCH")).toBe(true);
  });

  it("detects an existing release for the same tag and does not create a duplicate draft", async () => {
    let createCalled = false;
    const client = fakeClient({
      getReleaseByTag: async () => ({ ok: true, value: { id: 7, htmlUrl: "https://github.com/example/widget/releases/7", draft: true } }),
      createReleaseDraft: async () => {
        createCalled = true;
        return { ok: true, value: { id: 999, htmlUrl: "https://github.com/example/widget/releases/999" } };
      },
    });
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: { GITHUB_TOKEN: "test-token" } });
    const data = result.data as { decision: ReleaseDecision };
    expect(data.decision.draft.status).toBe("exists");
    expect(data.decision.draft.id).toBe("7");
    expect(createCalled).toBe(false);
    expect(result.summary).toMatch(/no duplicate draft created/);
  });

  it("maps a repository-lookup network failure to ExternalIntegrationError without leaking the token", async () => {
    const client = fakeClient({ getRepository: async () => ({ ok: false, status: 500, message: "GitHub API returned 500 looking up the repository." }) });
    const result = await runReleaseDraft(contextFor(dir), { fromFile: reqFile }, { githubClient: client, env: { GITHUB_TOKEN: "super-secret-token" } });
    expect(result.exitCode).toBe(5);
    expect(JSON.stringify(result)).not.toMatch(/super-secret-token/);
  });
});

describe("checkDraftPrerequisites: pure gating logic", () => {
  it("is satisfied for a ready, owner/repo-identified decision", () => {
    const fakeDecision = {
      candidate: { identity: { repositoryIdentity: "example/widget" } },
      readiness: { integrity: "ready" },
    } as unknown as ReleaseDecision;
    expect(checkDraftPrerequisites(fakeDecision).ok).toBe(true);
  });
});
