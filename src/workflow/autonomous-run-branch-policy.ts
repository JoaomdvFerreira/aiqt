/**
 * M36-WU03 (build spec Sec 7 WU36-03 Scope: "branch naming"). Derives the
 * branch name for one autonomous run's isolated worktree.
 *
 * Deliberately independent of workspace-branch-policy.ts's `aiqt/`-
 * prefixed scheme (M25): that scheme is for AIQT's own canonical-state-
 * tracked work units (a project id + work-unit id from state.json) --
 * an autonomous run's target repository is not required to be an AIQT-
 * tracked project at all (build spec Sec 2: "inspect a target
 * repository," never framed as "an AIQT project"). Reusing the `aiqt/`
 * prefix here would misleadingly suggest AIQT itself owns the branch's
 * meaning in the target repository's own workflow. `autonomous/` is a
 * distinct, equally fixed, equally sanitized template.
 *
 * Sanitization logic mirrors workspace-branch-policy.ts's sanitizeToken
 * exactly (same reasoning: never interpolate a user-supplied identifier
 * raw into a branch name, always reduce to a fixed lowercase-ASCII-and-
 * hyphen alphabet first) -- duplicated rather than imported, since
 * importing would couple this module to the `aiqt/`-scheme file for no
 * behavioral benefit.
 */

const BRANCH_NAME_MAX_CHARS = 180;

function sanitizeToken(raw: string): string {
  const lowered = raw.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9]+/g, "-");
  const collapsed = replaced.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed.length > 0 ? collapsed : "x";
}

/**
 * `autonomous/<issue-token>-<run-id-suffix>`. `runId` (not `issueId`
 * alone) is included so two runs against the same issue never collide
 * on branch name -- concurrent-run collision (threat model Sec 3.18) is
 * partly addressed structurally here: even if the operation lock
 * (WU36-01 Sec 3.18) were somehow bypassed, two runs could not derive
 * the same branch name.
 */
export function deriveAutonomousRunBranchName(issueId: string, runId: string): string {
  const issueToken = sanitizeToken(issueId);
  const runToken = sanitizeToken(runId);
  const prefix = "autonomous/";

  let branch = `${prefix}${issueToken}-${runToken}`;
  if (branch.length > BRANCH_NAME_MAX_CHARS) {
    const fixedLen = prefix.length + 1; /* '-' */
    const available = Math.max(2, BRANCH_NAME_MAX_CHARS - fixedLen - runToken.length);
    branch = `${prefix}${issueToken.slice(0, Math.max(1, available))}-${runToken}`;
  }
  return branch;
}

const BRANCH_TOKEN_PATTERN = /^[a-z0-9-]+$/;

/** Structural (non-Git) shape check, mirroring isValidAiqtBranchShape's pattern -- real validation still goes through gitCheckRefFormatBranch before any worktree is created. */
export function isValidAutonomousRunBranchShape(branchName: string): boolean {
  if (branchName.length === 0 || branchName.length > BRANCH_NAME_MAX_CHARS) return false;
  if (!branchName.startsWith("autonomous/")) return false;
  const rest = branchName.slice("autonomous/".length);
  return rest.length > 0 && BRANCH_TOKEN_PATTERN.test(rest);
}
