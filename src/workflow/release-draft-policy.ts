import type { ReleaseDecision } from "../schema/release-governance.schema.js";

/**
 * M40-WU04 (build spec Sec 11.1): pure, I/O-free prerequisite checks that
 * must all pass before any GitHub network call is attempted. Kept separate
 * from the network client so the gating logic is deterministically
 * testable without a real (or even mocked) HTTP call.
 */

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface OwnerRepo {
  owner: string;
  repo: string;
}

/** Only accepts a literal "owner/repo" shape -- never used to build an arbitrary URL. */
export function parseOwnerRepo(repositoryIdentity: string): OwnerRepo | null {
  const match = OWNER_REPO_PATTERN.exec(repositoryIdentity);
  if (!match) return null;
  const [owner, repo] = repositoryIdentity.split("/");
  return { owner: owner!, repo: repo! };
}

export interface DraftPrerequisiteCheck {
  ok: boolean;
  blockingReasons: string[];
}

/**
 * Build spec Sec 11.1: candidate provenance current, integrity not
 * blocked, intended tag/version/commit consistent (already enforced by
 * ReleaseCandidate construction + readiness), and a GitHub-shaped
 * repository identity. Does not check credentials or contact GitHub --
 * those are separate, later gates (missing credentials must produce a
 * distinct, actionable error; a repository-identity mismatch can only be
 * confirmed after a real lookup).
 */
export function checkDraftPrerequisites(decision: ReleaseDecision): DraftPrerequisiteCheck {
  const blockingReasons: string[] = [];

  if (decision.readiness.integrity === "blocked") {
    blockingReasons.push("Candidate readiness is blocked; resolve blocking findings before requesting a draft.");
  }
  if (decision.readiness.integrity === "insufficient_evidence") {
    blockingReasons.push("Candidate has insufficient evidence; resolve missing core evidence before requesting a draft.");
  }
  if (parseOwnerRepo(decision.candidate.identity.repositoryIdentity) === null) {
    blockingReasons.push(`repositoryIdentity "${decision.candidate.identity.repositoryIdentity}" is not an "owner/repo" GitHub identity.`);
  }

  return { ok: blockingReasons.length === 0, blockingReasons };
}

/** Build spec Sec 11.2: a clear, non-secret-leaking operator action list -- never a fabricated credential. */
export function missingGithubTokenActions(tokenEnvName: string): string[] {
  return [
    `Set the "${tokenEnvName}" environment variable to a token with "contents: write" permission on the target repository.`,
    "Use a least-privilege, repository-scoped or fine-grained personal access token where possible.",
    "Never pass the token as a CLI flag or commit it to any file -- environment variable only.",
  ];
}
