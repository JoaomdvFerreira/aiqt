import { describe, it, expect } from "vitest";
import { performExactShaPush, type PerformPushDeps } from "../../src/services/pr-push-service.js";
import { GitRunnerError } from "../../src/workspaces/git-command-runner.js";
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
  return createIntegrationPlan({ id: "pri-1754784000000-0123abcd", now: NOW, facts: facts(overrides), title: "T", portfolioRef: null });
}

interface Recorder {
  pushCalls: { remote: string; sha: string; branch: string }[];
}

function deps(options: { pushThrows?: Error; remoteAfter?: string | null; remoteReadThrows?: boolean; refFormatOk?: boolean } = {}): PerformPushDeps & Recorder {
  const pushCalls: { remote: string; sha: string; branch: string }[] = [];
  return {
    pushCalls,
    checkRefFormat: () => options.refFormatOk ?? true,
    push: (_cwd, remote, sha, branch) => {
      pushCalls.push({ remote, sha, branch });
      if (options.pushThrows) throw options.pushThrows;
      return "";
    },
    readRemoteSha: () => {
      if (options.remoteReadThrows) throw new GitRunnerError("GIT_COMMAND_FAILED", "could not read remote");
      return options.remoteAfter === undefined ? PLANNED : options.remoteAfter;
    },
  };
}

describe("M47-WU03 push: exactly one exact-SHA, single-ref push is attempted", () => {
  it("pushes the plan's bound commit to the plan's source branch and nothing else", () => {
    const d = deps();
    performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: "absent", now: NOW }, d);
    expect(d.pushCalls).toEqual([{ remote: "origin", sha: PLANNED, branch: "feature/x" }]);
  });
});

describe("M47-WU03 push: success is decided by re-reading the remote, never by the exit code", () => {
  it("verifies only when the remote holds exactly the planned commit", () => {
    const result = performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: "absent", now: NOW }, deps({ remoteAfter: PLANNED }));
    expect(result.record.outcome).toBe("verified");
    expect(result.record.remoteShaAfter).toBe(PLANNED);
  });

  it("treats exit 0 with a different remote SHA as ambiguous, never as success", () => {
    const result = performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: "present", now: NOW }, deps({ remoteAfter: OTHER }));
    expect(result.record.outcome).toBe("ambiguous");
    expect(result.record.remoteShaAfter).toBe(OTHER);
    expect(result.record.detail).toMatch(/not what this plan intended/);
  });

  it("treats exit 0 with an unreadable remote as ambiguous", () => {
    const result = performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: "absent", now: NOW }, deps({ remoteReadThrows: true }));
    expect(result.record.outcome).toBe("ambiguous");
    expect(result.record.remoteShaAfter).toBeNull();
  });

  it("treats exit 0 with an absent remote branch as ambiguous", () => {
    const result = performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: "absent", now: NOW }, deps({ remoteAfter: null }));
    expect(result.record.outcome).toBe("ambiguous");
  });
});

describe("M47-WU03 push: a thrown push is not proof of failure either", () => {
  it("verifies when the push errored but the remote demonstrably holds the planned commit", () => {
    const result = performExactShaPush(
      { plan: plan(), remoteSourcePresenceBefore: "absent", now: NOW },
      deps({ pushThrows: new GitRunnerError("GIT_COMMAND_FAILED", "connection reset"), remoteAfter: PLANNED }),
    );
    expect(result.record.outcome).toBe("verified");
    expect(result.record.detail).toMatch(/did land/);
  });

  it("fails when the push errored and the remote does not hold the planned commit", () => {
    const result = performExactShaPush(
      { plan: plan(), remoteSourcePresenceBefore: "present", now: NOW },
      deps({ pushThrows: new GitRunnerError("GIT_COMMAND_FAILED", "non-fast-forward"), remoteAfter: OTHER }),
    );
    expect(result.record.outcome).toBe("failed");
    expect(result.record.detail).toMatch(/nothing changed/);
  });

  it("is ambiguous when the push errored and the remote cannot then be read", () => {
    const result = performExactShaPush(
      { plan: plan(), remoteSourcePresenceBefore: "present", now: NOW },
      deps({ pushThrows: new GitRunnerError("GIT_COMMAND_FAILED", "connection reset"), remoteReadThrows: true }),
    );
    expect(result.record.outcome).toBe("ambiguous");
    expect(result.record.detail).toMatch(/unknown/);
  });
});

describe("M47-WU03 push: last-line structural refusals send nothing at all", () => {
  it("refuses a plan whose bound SHA is not a full commit SHA", () => {
    const d = deps();
    const result = performExactShaPush({ plan: plan({ sourceHeadSha: "abc1234" }), remoteSourcePresenceBefore: "absent", now: NOW }, d);
    expect(result.record.outcome).toBe("failed");
    expect(result.record.detail).toMatch(/Nothing was sent/);
    expect(d.pushCalls).toEqual([]);
  });

  it("refuses a source branch Git itself rejects as a ref name", () => {
    const d = deps({ refFormatOk: false });
    const result = performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: "absent", now: NOW }, d);
    expect(result.record.outcome).toBe("failed");
    expect(result.record.detail).toMatch(/Nothing was sent/);
    expect(d.pushCalls).toEqual([]);
  });
});

describe("M47-WU03 push: the record always carries the facts a resumption needs", () => {
  it("records the planned SHA and the pre-push remote presence on every outcome", () => {
    for (const presence of ["absent", "present", "unverifiable"] as const) {
      const result = performExactShaPush({ plan: plan(), remoteSourcePresenceBefore: presence, now: NOW }, deps({ remoteAfter: OTHER }));
      expect(result.record.plannedSha).toBe(PLANNED);
      expect(result.record.remoteBranchPresenceBefore).toBe(presence);
      expect(result.record.attemptedAt).toBe(NOW);
    }
  });
});
