import { MAX_PR_REVIEWERS, type BaseProtectionEvidence, type PullRequestCreateMode, type RemoteBranchPresence } from "../schema/pull-request-integration.schema.js";
import { isFullCommitSha, normalizeReviewers } from "./pr-integration-identity.js";
import { isSameRepositoryIdentity } from "./pr-remote-identity.js";

/**
 * M47-WU02: the pure preflight decision. Every gate from build spec Sec 8
 * ("Git write boundary") and Sec 11 ("Protected branch / policy evidence")
 * is evaluated here, over already-collected observations -- this module
 * performs no I/O of its own, so the entire write boundary is
 * deterministically testable without a repository, a remote, or a network.
 *
 * `pr prepare`, `pr push`, `pr create`, and `pr validate` all call this
 * one function, which is what keeps a gate from existing in one command
 * and being forgotten in another.
 */

export type PrPreflightPhase = "push" | "create" | "both";

export interface PrPreflightFinding {
  id: string;
  phase: PrPreflightPhase;
  message: string;
  suggestedAction: string;
}

/**
 * Facts collected read-only from the repository, the remote, and the
 * provider. Every "could not determine" case is explicitly `null` or
 * `"unverifiable"` rather than a default -- fail-closed evaluation depends
 * on being able to tell absence from ignorance.
 */
export interface PrPreflightObservations {
  targetIsAiqtRepository: boolean;
  insideWorkTree: boolean;
  /** null when cleanliness could not be determined at all. */
  worktreeClean: boolean | null;
  untrackedFileCount: number;
  currentBranch: string;
  sourceBranch: string;
  baseBranch: string;
  /** Local SHA the source branch resolves to; null when it could not be resolved. */
  sourceHeadSha: string | null;
  /** The exact SHA a persisted plan bound, when re-checking an existing plan. Null during initial prepare. */
  plannedSha: string | null;
  remoteName: string;
  /** owner/repo parsed from the configured remote URL; null when the remote is missing or not a GitHub remote. */
  remoteIdentity: string | null;
  /** Remote default branch; null when the remote did not report one (unverifiable, never "there is none"). */
  remoteDefaultBranch: string | null;
  remoteBasePresence: RemoteBranchPresence;
  remoteSourcePresence: RemoteBranchPresence;
  remoteSourceSha: string | null;
  /** True/false when ancestry could be computed locally; null when the remote commit is not present locally, so it could not be. */
  remoteSourceIsAncestorOfPlanned: boolean | null;
  /** owner/repo as confirmed by a provider lookup; null when it could not be confirmed. */
  providerIdentity: string | null;
  credentialsAvailable: boolean;
  baseProtection: BaseProtectionEvidence;
  requireProtectedBase: boolean;
  reviewers: readonly string[];
  createMode: PullRequestCreateMode;
}

export interface PrPreflightResult {
  blocking: PrPreflightFinding[];
  warnings: PrPreflightFinding[];
  pushAllowed: boolean;
  createAllowed: boolean;
  /** True when the remote source branch already holds exactly the planned commit, so a push would be a no-op. */
  remoteAlreadyAtPlannedSha: boolean;
}

function finding(id: string, phase: PrPreflightPhase, message: string, suggestedAction: string): PrPreflightFinding {
  return { id, phase, message, suggestedAction };
}

export function evaluatePrPreflight(obs: PrPreflightObservations): PrPreflightResult {
  const blocking: PrPreflightFinding[] = [];
  const warnings: PrPreflightFinding[] = [];
  const effectiveSha = obs.plannedSha ?? obs.sourceHeadSha;

  // --- 1. AIQT never targets its own repository (Sec 19) --------------------
  if (obs.targetIsAiqtRepository) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-SELF-MANAGEMENT",
        "both",
        "The target repository is the AIQT product repository itself.",
        "Run this command against a different repository. AIQT never manages its own development through its own commands.",
      ),
    );
  }

  // --- 2. Repository shape --------------------------------------------------
  if (!obs.insideWorkTree) {
    blocking.push(finding("PR-PREFLIGHT-NOT-A-REPOSITORY", "both", "The target path is not inside a Git working tree.", "Point --repository at a Git repository root."));
  }

  // --- 3. Clean worktree (Sec 8.3) -----------------------------------------
  if (obs.worktreeClean === null) {
    blocking.push(finding("PR-PREFLIGHT-WORKTREE-UNKNOWN", "both", "Working-tree cleanliness could not be determined.", "Resolve the repository error and retry; a push is never attempted from an unknown working-tree state."));
  } else if (!obs.worktreeClean) {
    blocking.push(
      finding("PR-PREFLIGHT-WORKTREE-DIRTY", "both", "The working tree has uncommitted tracked changes.", "Commit or stash the changes, then prepare a new plan -- the pushed commit must be exactly the reviewed one."),
    );
  }
  if (obs.untrackedFileCount > 0) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-UNTRACKED-FILES",
        "both",
        `The working tree has ${obs.untrackedFileCount} untracked file(s).`,
        "Commit, ignore, or remove them, then prepare a new plan -- untracked files mean the branch under review may not be what the operator thinks it is.",
      ),
    );
  }

  // --- 4/5/6. Branch identity (Sec 8.4-8.6) ---------------------------------
  if (obs.currentBranch !== obs.sourceBranch) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-SOURCE-NOT-CHECKED-OUT",
        "both",
        `The repository is on branch "${obs.currentBranch}", not the plan's source branch "${obs.sourceBranch}".`,
        `Check out "${obs.sourceBranch}" before pushing. M47 never switches branches as an integration side effect.`,
      ),
    );
  }
  if (obs.sourceBranch === obs.baseBranch) {
    blocking.push(
      finding("PR-PREFLIGHT-SOURCE-EQUALS-BASE", "both", `Source branch "${obs.sourceBranch}" is the same as the base branch.`, "Choose a source branch distinct from the base branch."),
    );
  }
  if (obs.remoteDefaultBranch !== null && obs.sourceBranch === obs.remoteDefaultBranch) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-SOURCE-IS-DEFAULT-BRANCH",
        "both",
        `Source branch "${obs.sourceBranch}" is the remote's default branch.`,
        "M47 never pushes to a remote's default branch, regardless of which base was requested.",
      ),
    );
  }

  // --- 7. Exact SHA binding (Sec 8.6) ---------------------------------------
  if (effectiveSha === null) {
    blocking.push(finding("PR-PREFLIGHT-HEAD-UNRESOLVED", "both", `Could not resolve a commit for source branch "${obs.sourceBranch}".`, "Verify the branch exists locally and has at least one commit."));
  } else if (!isFullCommitSha(effectiveSha)) {
    blocking.push(finding("PR-PREFLIGHT-HEAD-NOT-EXACT", "both", `"${effectiveSha}" is not a full 40-character commit SHA.`, "M47 binds an exact commit; an abbreviated SHA or a ref name is never accepted."));
  } else if (obs.plannedSha !== null && obs.sourceHeadSha !== null && obs.plannedSha.toLowerCase() !== obs.sourceHeadSha.toLowerCase()) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-HEAD-MOVED",
        "both",
        `Local HEAD of "${obs.sourceBranch}" is ${obs.sourceHeadSha}, but the plan is bound to ${obs.plannedSha}.`,
        "The plan is stale. Prepare a new plan for the current commit.",
      ),
    );
  }

  // --- 8/9. Remote and provider identity (Sec 8.7, Sec 9) -------------------
  if (obs.remoteIdentity === null) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-REMOTE-IDENTITY-UNRESOLVED",
        "both",
        `Remote "${obs.remoteName}" is missing, or its URL does not map to a GitHub repository.`,
        "Configure the remote to a github.com repository. M47 implements GitHub only and never guesses a host's Pull Request semantics.",
      ),
    );
  }
  if (!obs.credentialsAvailable) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-MISSING-CREDENTIALS",
        "both",
        "GitHub credentials are not available, so repository identity cannot be verified before a write.",
        "Set the token environment variable named by --token-env (default GITHUB_TOKEN) to a least-privilege token with write access to the target repository.",
      ),
    );
  } else if (obs.providerIdentity === null) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-IDENTITY-UNVERIFIED",
        "both",
        `The GitHub repository identity for remote "${obs.remoteName}" could not be verified.`,
        "Resolve the provider error and retry. 'Could not verify' is never treated as 'verified'; no write proceeds without a confirmed identity.",
      ),
    );
  } else if (obs.remoteIdentity !== null && !isSameRepositoryIdentity(obs.providerIdentity, obs.remoteIdentity)) {
    blocking.push(
      finding(
        "PR-PREFLIGHT-IDENTITY-MISMATCH",
        "both",
        `Remote "${obs.remoteName}" points at "${obs.remoteIdentity}", but the provider reports "${obs.providerIdentity}".`,
        "Resolve the discrepancy before any write -- this is exactly the condition that would push a branch to the wrong repository.",
      ),
    );
  }

  // --- 10. Remote base branch must exist (Sec 8.8) --------------------------
  if (obs.remoteBasePresence === "absent") {
    blocking.push(finding("PR-PREFLIGHT-REMOTE-BASE-MISSING", "both", `Base branch "${obs.baseBranch}" does not exist on remote "${obs.remoteName}".`, "Choose an existing base branch. M47 never creates a base branch."));
  } else if (obs.remoteBasePresence === "unverifiable") {
    blocking.push(
      finding(
        "PR-PREFLIGHT-REMOTE-BASE-UNVERIFIABLE",
        "both",
        `Could not determine whether base branch "${obs.baseBranch}" exists on remote "${obs.remoteName}".`,
        "Resolve the remote access error and retry; an unverifiable base is never treated as present.",
      ),
    );
  }

  // --- 11/12. Remote source state and fast-forward-only (Sec 8.9, 8.10) -----
  let remoteAlreadyAtPlannedSha = false;
  if (obs.remoteSourcePresence === "unverifiable") {
    blocking.push(
      finding(
        "PR-PREFLIGHT-REMOTE-SOURCE-UNVERIFIABLE",
        "both",
        `Could not determine the state of "${obs.sourceBranch}" on remote "${obs.remoteName}".`,
        "Resolve the remote access error and retry; an unverifiable remote branch is never treated as absent, which would authorize a create-style push.",
      ),
    );
  } else if (obs.remoteSourcePresence === "present") {
    if (obs.remoteSourceSha !== null && effectiveSha !== null && obs.remoteSourceSha.toLowerCase() === effectiveSha.toLowerCase()) {
      remoteAlreadyAtPlannedSha = true;
    } else if (obs.remoteSourceIsAncestorOfPlanned === null) {
      blocking.push(
        finding(
          "PR-PREFLIGHT-FAST-FORWARD-UNVERIFIABLE",
          "both",
          `The remote commit on "${obs.sourceBranch}" is not present locally, so fast-forward safety could not be verified.`,
          "Fetch the remote branch, then retry. M47 never pushes when it cannot prove the update is a fast-forward.",
        ),
      );
    } else if (!obs.remoteSourceIsAncestorOfPlanned) {
      blocking.push(
        finding(
          "PR-PREFLIGHT-NOT-FAST-FORWARD",
          "both",
          `Remote "${obs.sourceBranch}" has commits the planned commit does not contain (diverged or ahead).`,
          "Reconcile the branches yourself and prepare a new plan. M47 has no force or force-with-lease capability, by design.",
        ),
      );
    }
  }

  // --- 13. Base protection policy (Sec 11) ----------------------------------
  if (obs.requireProtectedBase && obs.baseProtection !== "protected") {
    blocking.push(
      finding(
        "PR-PREFLIGHT-BASE-NOT-PROTECTED",
        "create",
        `The plan requires a protected base branch, but protection evidence for "${obs.baseBranch}" is "${obs.baseProtection}".`,
        obs.baseProtection === "unprotected"
          ? "Protect the base branch, or prepare a plan without --require-protected-base."
          : "Protection could not be verified; an unverifiable or unsupported result never satisfies a protection requirement.",
      ),
    );
  } else if (obs.baseProtection === "unverifiable") {
    warnings.push(
      finding("PR-PREFLIGHT-PROTECTION-UNVERIFIABLE", "create", `Branch-protection evidence for "${obs.baseBranch}" is unavailable (permission, plan, or API limitation).`, "Reported honestly as unverifiable, never as unprotected."),
    );
  } else if (obs.baseProtection === "unprotected") {
    warnings.push(finding("PR-PREFLIGHT-BASE-UNPROTECTED", "create", `Base branch "${obs.baseBranch}" is not protected.`, "Informational only; the plan did not require a protected base."));
  }

  // --- 14/15. Reviewers and create intent -----------------------------------
  if (normalizeReviewers(obs.reviewers).length > MAX_PR_REVIEWERS) {
    blocking.push(finding("PR-PREFLIGHT-TOO-MANY-REVIEWERS", "create", `More than ${MAX_PR_REVIEWERS} reviewers were requested.`, `Request at most ${MAX_PR_REVIEWERS} explicit reviewers.`));
  }
  if (obs.createMode === "ready") {
    warnings.push(finding("PR-PREFLIGHT-READY-INTENT", "create", "This plan will open a ready-for-review Pull Request, not a draft.", "Draft is the default; ready was requested explicitly."));
  }
  if (remoteAlreadyAtPlannedSha) {
    warnings.push(
      finding("PR-PREFLIGHT-REMOTE-ALREADY-AT-PLANNED-SHA", "push", `Remote "${obs.sourceBranch}" already points at the planned commit.`, "A push would be a no-op; the exact-SHA verification still runs and must still match."),
    );
  }

  const pushAllowed = !blocking.some((f) => f.phase === "push" || f.phase === "both");
  const createAllowed = blocking.length === 0;
  return { blocking, warnings, pushAllowed, createAllowed, remoteAlreadyAtPlannedSha };
}
