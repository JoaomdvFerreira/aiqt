import { gitPushExactCommitToBranch, gitLsRemoteHead, gitCheckRefFormatBranch, GitRunnerError } from "../workspaces/git-command-runner.js";
import type { PullRequestIntegrationPlan, PullRequestPushRecord, RemoteBranchPresence } from "../schema/pull-request-integration.schema.js";
import { isFullCommitSha } from "../workflow/pr-integration-identity.js";

/**
 * M47-WU03 (build spec Sec 8): the one place in this repository that
 * causes a remote Git mutation.
 *
 * The whole design of this module is about one question -- "did the remote
 * accept exactly the planned commit?" -- and about never answering it by
 * assumption. `git push` exiting 0 is treated as evidence, not proof: the
 * remote source SHA is re-read afterwards in every case, and only exact
 * equality with the planned SHA produces `verified`.
 *
 * Symmetrically, `git push` throwing is not treated as proof of failure
 * either. A connection can drop after the remote has already accepted the
 * update, so a thrown error is followed by the same re-read: if the remote
 * now holds the planned commit, the push demonstrably landed and the
 * outcome is `verified`; if the remote holds something else, it is
 * `failed`; and if the remote cannot be read at all, the outcome is
 * `ambiguous` -- recorded as such, never guessed, so a later invocation
 * reconciles instead of pushing again.
 */

export interface PerformPushInput {
  plan: PullRequestIntegrationPlan;
  /** Remote source-branch state observed by the immediately preceding preflight. */
  remoteSourcePresenceBefore: RemoteBranchPresence;
  now: string;
}

export interface PerformPushDeps {
  push?: (cwd: string, remoteName: string, commitSha: string, branch: string) => string;
  readRemoteSha?: (cwd: string, remoteName: string, branch: string) => string | null;
  checkRefFormat?: (branch: string, cwd: string) => boolean;
}

export interface PerformPushResult {
  record: PullRequestPushRecord;
  /** Raw, already-sanitized failure text from Git, when the push itself errored. Never contains a credential (the runner truncates to a sanitized first line, and the URL never reaches it). */
  gitError: string | null;
}

type RemoteReadOutcome = { readable: true; sha: string | null } | { readable: false };

function readRemote(deps: PerformPushDeps, cwd: string, remoteName: string, branch: string): RemoteReadOutcome {
  const read = deps.readRemoteSha ?? gitLsRemoteHead;
  try {
    return { readable: true, sha: read(cwd, remoteName, branch) };
  } catch {
    return { readable: false };
  }
}

export function performExactShaPush(input: PerformPushInput, deps: PerformPushDeps = {}): PerformPushResult {
  const { plan, now } = input;
  const planned = plan.sourceHeadSha;

  // Last-line structural refusals. The preflight has already checked all of
  // this; re-checking here means a future caller that forgets to run
  // preflight still cannot reach the remote with a malformed value.
  if (!isFullCommitSha(planned)) {
    return {
      record: {
        attemptedAt: now,
        outcome: "failed",
        plannedSha: planned,
        remoteShaAfter: null,
        remoteBranchPresenceBefore: input.remoteSourcePresenceBefore,
        detail: "Refused to push: the plan's source SHA is not a full 40-character commit SHA. Nothing was sent.",
      },
      gitError: null,
    };
  }
  const checkRefFormat = deps.checkRefFormat ?? gitCheckRefFormatBranch;
  if (!checkRefFormat(plan.sourceBranch, plan.repositoryRoot)) {
    return {
      record: {
        attemptedAt: now,
        outcome: "failed",
        plannedSha: planned,
        remoteShaAfter: null,
        remoteBranchPresenceBefore: input.remoteSourcePresenceBefore,
        detail: `Refused to push: "${plan.sourceBranch}" is not a valid Git branch name. Nothing was sent.`,
      },
      gitError: null,
    };
  }

  const push = deps.push ?? gitPushExactCommitToBranch;
  let gitError: string | null = null;
  let pushThrew = false;
  try {
    push(plan.repositoryRoot, plan.remoteName, planned, plan.sourceBranch);
  } catch (err) {
    pushThrew = true;
    gitError = err instanceof GitRunnerError ? err.message : err instanceof Error ? err.message : String(err);
  }

  // The verification read happens on BOTH paths -- a successful exit is
  // never accepted on its own, and a failed exit is never accepted on its
  // own either.
  const after = readRemote(deps, plan.repositoryRoot, plan.remoteName, plan.sourceBranch);

  if (!after.readable) {
    return {
      record: {
        attemptedAt: now,
        outcome: "ambiguous",
        plannedSha: planned,
        remoteShaAfter: null,
        remoteBranchPresenceBefore: input.remoteSourcePresenceBefore,
        detail: pushThrew
          ? `The push failed and the remote branch could not then be read, so whether the update landed is unknown. Git reported: ${gitError}`
          : "The push reported success but the remote branch could not be re-read, so the resulting remote state is unknown.",
      },
      gitError,
    };
  }

  const remoteSha = after.sha;
  if (remoteSha !== null && remoteSha.toLowerCase() === planned.toLowerCase()) {
    return {
      record: {
        attemptedAt: now,
        outcome: "verified",
        plannedSha: planned,
        remoteShaAfter: remoteSha,
        remoteBranchPresenceBefore: input.remoteSourcePresenceBefore,
        detail: pushThrew
          ? `The push command reported an error, but the remote branch "${plan.sourceBranch}" now holds exactly the planned commit, so the update did land. Git reported: ${gitError}`
          : `Pushed exactly ${planned} to refs/heads/${plan.sourceBranch} on "${plan.remoteName}"; the remote re-read confirms that exact commit.`,
      },
      gitError,
    };
  }

  if (pushThrew) {
    return {
      record: {
        attemptedAt: now,
        outcome: "failed",
        plannedSha: planned,
        remoteShaAfter: remoteSha,
        remoteBranchPresenceBefore: input.remoteSourcePresenceBefore,
        detail: `The push was rejected and the remote branch does not hold the planned commit, so nothing changed. Git reported: ${gitError}`,
      },
      gitError,
    };
  }

  // Exit 0 but the remote does not hold the planned commit. Something
  // concurrent happened; this is exactly the case that must never be
  // reported as success.
  return {
    record: {
      attemptedAt: now,
      outcome: "ambiguous",
      plannedSha: planned,
      remoteShaAfter: remoteSha,
      remoteBranchPresenceBefore: input.remoteSourcePresenceBefore,
      detail: `The push reported success, but remote "${plan.sourceBranch}" holds ${remoteSha ?? "no commit"} rather than the planned ${planned}. The remote state is not what this plan intended.`,
    },
    gitError,
  };
}
