import {
  gitIsInsideWorkTree,
  gitCurrentBranch,
  gitDiffQuietIsClean,
  gitLsFilesOthersExcludeStandard,
  gitRevParse,
  gitRemoteGetUrl,
  gitLsRemoteHead,
  gitLsRemoteDefaultBranch,
  gitCommitExists,
  gitIsAncestor,
  GitRunnerError,
} from "../workspaces/git-command-runner.js";
import { isAiqtOwnRepository } from "../workflow/autonomous-run-self-management-guard.js";
import { parseGitHubRemoteUrl } from "../workflow/pr-remote-identity.js";
import type { PrPreflightObservations } from "../workflow/pr-preflight.js";
import type { BaseProtectionEvidence, PullRequestCreateMode, RemoteBranchPresence } from "../schema/pull-request-integration.schema.js";
import { realGithubPullRequestReadClient, type PullRequestProviderReadClient } from "./github-pull-request-client.js";

/**
 * M47-WU02: collects, read-only, every fact evaluatePrPreflight needs.
 * This is the ONLY module in the milestone that reads both the repository
 * and the provider; the decision itself stays pure
 * (src/workflow/pr-preflight.ts), so the whole write boundary can be
 * tested without a repository or a network.
 *
 * Nothing here mutates anything: the Git functions used are exactly the
 * read-only entries of the M25 allowlist plus M47-WU02's own read-only
 * additions, and the provider client is the read-only half. `ls-remote`
 * does contact the network, but it has no mutating form.
 *
 * Every failure is mapped to an explicit "could not determine" value
 * rather than to a convenient default -- `unverifiable` never degrades
 * into `absent`, because `absent` is what would authorize a create-style
 * push.
 */

export interface CollectPrPreflightInput {
  repositoryRoot: string;
  remoteName: string;
  baseBranch: string;
  /** Null means "use whatever branch is currently checked out". */
  sourceBranch: string | null;
  /** The SHA an existing plan bound, when re-checking one. Null during initial prepare. */
  plannedSha: string | null;
  reviewers: readonly string[];
  createMode: PullRequestCreateMode;
  requireProtectedBase: boolean;
  /** Null when no credential was available. Never logged, never persisted. */
  token: string | null;
}

export interface CollectPrPreflightDeps {
  readClient?: PullRequestProviderReadClient;
  /**
   * Resolves the effective URL of a named remote. Defaults to
   * `git remote get-url`, which expands `insteadOf` rewriting and so
   * reports where a push would ACTUALLY go -- the property that matters
   * for identity. Injectable for the same reason `readClient` is: the
   * integration suite runs against a local bare repository (no network,
   * no GitHub account) while still exercising the real Git reads,
   * remote lookups, and preflight decision around it.
   */
  remoteUrlResolver?: (cwd: string, remoteName: string) => string | null;
}

export interface CollectedPrPreflight {
  observations: PrPreflightObservations;
  /** Provider-reported default branch, when it could be read. Informational; the push gate uses the Git-reported one. */
  providerDefaultBranch: string | null;
  /** Set when a provider call failed, so the caller can report the external error honestly. Already redacted. */
  providerError: string | null;
}

function safeBoolean(fn: () => boolean): boolean | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function remoteBranchPresence(cwd: string, remoteName: string, branch: string): { presence: RemoteBranchPresence; sha: string | null } {
  try {
    const sha = gitLsRemoteHead(cwd, remoteName, branch);
    return sha === null ? { presence: "absent", sha: null } : { presence: "present", sha };
  } catch (err) {
    // An access/network failure is ignorance about the branch, never proof
    // that it does not exist.
    if (err instanceof GitRunnerError) return { presence: "unverifiable", sha: null };
    throw err;
  }
}

export async function collectPrPreflightObservations(input: CollectPrPreflightInput, deps: CollectPrPreflightDeps = {}): Promise<CollectedPrPreflight> {
  const cwd = input.repositoryRoot;
  const targetIsAiqtRepository = isAiqtOwnRepository(cwd);
  const insideWorkTree = gitIsInsideWorkTree(cwd);

  // Once we know this is not a Git working tree (or is AIQT itself), every
  // further repository read would be meaningless, and every remote read
  // would be an unnecessary network call for an already-doomed plan.
  if (!insideWorkTree || targetIsAiqtRepository) {
    return {
      observations: {
        targetIsAiqtRepository,
        insideWorkTree,
        worktreeClean: null,
        untrackedFileCount: 0,
        currentBranch: "",
        sourceBranch: input.sourceBranch ?? "",
        baseBranch: input.baseBranch,
        sourceHeadSha: null,
        plannedSha: input.plannedSha,
        remoteName: input.remoteName,
        remoteIdentity: null,
        remoteDefaultBranch: null,
        remoteBasePresence: "unverifiable",
        remoteSourcePresence: "unverifiable",
        remoteSourceSha: null,
        remoteSourceIsAncestorOfPlanned: null,
        providerIdentity: null,
        credentialsAvailable: input.token !== null,
        baseProtection: "unverifiable",
        requireProtectedBase: input.requireProtectedBase,
        reviewers: input.reviewers,
        createMode: input.createMode,
      },
      providerDefaultBranch: null,
      providerError: null,
    };
  }

  // An empty current branch means detached HEAD (or an unreadable repo);
  // the preflight's "source branch must be checked out" gate turns that
  // into a block rather than guessing which branch was intended.
  let currentBranch = "";
  try {
    currentBranch = gitCurrentBranch(cwd);
  } catch {
    currentBranch = "";
  }
  const sourceBranch = input.sourceBranch ?? currentBranch;

  const worktreeClean = safeBoolean(() => gitDiffQuietIsClean(cwd));
  let untrackedFileCount = 0;
  try {
    untrackedFileCount = gitLsFilesOthersExcludeStandard(cwd).length;
  } catch {
    untrackedFileCount = 0;
  }

  let sourceHeadSha: string | null = null;
  if (sourceBranch.length > 0) {
    try {
      sourceHeadSha = gitRevParse(cwd, `refs/heads/${sourceBranch}`);
    } catch {
      sourceHeadSha = null;
    }
  }

  // The remote URL may embed a credential, so it is parsed here and never
  // retained: only the resulting owner/repo identity leaves this function.
  const remoteUrl = (deps.remoteUrlResolver ?? gitRemoteGetUrl)(cwd, input.remoteName);
  const remoteIdentity = remoteUrl === null ? null : (parseGitHubRemoteUrl(remoteUrl)?.identity ?? null);

  // Once the remote is known not to be a GitHub repository this milestone
  // can act on, every further remote read is a network call on behalf of an
  // already-doomed plan. Skipping them keeps a misconfigured remote a fast,
  // local failure instead of a chain of connection timeouts.
  const remoteReadable = remoteIdentity !== null;

  let remoteDefaultBranch: string | null = null;
  if (remoteReadable) {
    try {
      remoteDefaultBranch = gitLsRemoteDefaultBranch(cwd, input.remoteName);
    } catch {
      remoteDefaultBranch = null;
    }
  }

  const base = remoteReadable ? remoteBranchPresence(cwd, input.remoteName, input.baseBranch) : { presence: "unverifiable" as RemoteBranchPresence, sha: null };
  const source =
    remoteReadable && sourceBranch.length > 0 ? remoteBranchPresence(cwd, input.remoteName, sourceBranch) : { presence: "unverifiable" as RemoteBranchPresence, sha: null };

  const effectiveSha = input.plannedSha ?? sourceHeadSha;
  let remoteSourceIsAncestorOfPlanned: boolean | null = null;
  if (source.presence === "present" && source.sha !== null && effectiveSha !== null) {
    // Ancestry can only be computed for objects this repository actually
    // has. A remote commit we have never fetched is unknowable here, and
    // the preflight treats that as "cannot verify", not "safe".
    if (gitCommitExists(cwd, source.sha) && gitCommitExists(cwd, effectiveSha)) {
      try {
        remoteSourceIsAncestorOfPlanned = gitIsAncestor(cwd, source.sha, effectiveSha);
      } catch {
        remoteSourceIsAncestorOfPlanned = null;
      }
    }
  }

  let providerIdentity: string | null = null;
  let providerDefaultBranch: string | null = null;
  let providerError: string | null = null;
  let baseProtection: BaseProtectionEvidence = "unverifiable";

  if (input.token !== null && remoteIdentity !== null) {
    const client = deps.readClient ?? realGithubPullRequestReadClient;
    const [owner, repo] = remoteIdentity.split("/");
    const repoLookup = await client.getRepository(owner!, repo!, input.token);
    if (repoLookup.ok) {
      providerIdentity = repoLookup.value.fullName;
      providerDefaultBranch = repoLookup.value.defaultBranch.length > 0 ? repoLookup.value.defaultBranch : null;
    } else {
      providerError = repoLookup.message;
    }

    const protection = await client.getBaseProtection(owner!, repo!, input.baseBranch, input.token);
    if (protection.ok) {
      baseProtection = protection.value.evidence;
    } else {
      baseProtection = "unverifiable";
      providerError = providerError ?? protection.message;
    }
  }

  return {
    observations: {
      targetIsAiqtRepository,
      insideWorkTree,
      worktreeClean,
      untrackedFileCount,
      currentBranch,
      sourceBranch,
      baseBranch: input.baseBranch,
      sourceHeadSha,
      plannedSha: input.plannedSha,
      remoteName: input.remoteName,
      remoteIdentity,
      // Prefer Git's own symref answer; fall back to the provider's when the
      // server did not report one, so a stale/limited transport does not
      // silently disable the "source is the default branch" gate.
      remoteDefaultBranch: remoteDefaultBranch ?? providerDefaultBranch,
      remoteBasePresence: base.presence,
      remoteSourcePresence: source.presence,
      remoteSourceSha: source.sha,
      remoteSourceIsAncestorOfPlanned,
      providerIdentity,
      credentialsAvailable: input.token !== null,
      baseProtection,
      requireProtectedBase: input.requireProtectedBase,
      reviewers: input.reviewers,
      createMode: input.createMode,
    },
    providerDefaultBranch,
    providerError,
  };
}
