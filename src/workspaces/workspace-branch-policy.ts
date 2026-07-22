import { BRANCH_NAME_MAX_CHARS } from "../schema/managed-workspace.schema.js";

/** M25 §7: strict lowercase ASCII subset; repeated separators collapsed by the provider, never passed through verbatim. */
function sanitizeToken(raw: string): string {
  const lowered = raw.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9]+/g, "-");
  const collapsed = replaced.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return collapsed.length > 0 ? collapsed : "x";
}

/**
 * M25 §7: the provider owns the complete branch template --
 * `aiqt/<project-token>/<work-unit-token>-<workspace-hash>`. No CLI flag
 * or canonical field ever supplies a branch name directly; user-supplied
 * identifiers (projectId/workUnitId) are only ever sanitized into tokens
 * here, never interpolated raw, so they can never inject a Git option or
 * path-traversal-like ref component. Deterministic for the same inputs;
 * truncates tokens (never the hash suffix) to respect the 180-character
 * cap.
 */
export function deriveBranchName(projectId: string, workUnitId: string, workspaceInstanceIdentity: string): string {
  const projectToken = sanitizeToken(projectId);
  const workUnitToken = sanitizeToken(workUnitId);
  // `workspaceInstanceIdentity` comes from `sha256Hex` (shared hash.ts),
  // which prefixes every digest with "sha256:" for the packet contract --
  // strip it here so the branch suffix is pure hex, never a colon Git's
  // ref-format would reject.
  const hexDigest = workspaceInstanceIdentity.replace(/^sha256:/, "");
  const hash = hexDigest.slice(0, 12);
  const prefix = "aiqt/";

  let branch = `${prefix}${projectToken}/${workUnitToken}-${hash}`;
  if (branch.length > BRANCH_NAME_MAX_CHARS) {
    const fixedLen = prefix.length + 1 /* '/' */ + 1 /* '-' */ + hash.length;
    const available = Math.max(2, BRANCH_NAME_MAX_CHARS - fixedLen);
    const projectBudget = Math.max(1, Math.floor(available / 2));
    const workUnitBudget = Math.max(1, available - projectBudget);
    branch = `${prefix}${projectToken.slice(0, projectBudget)}/${workUnitToken.slice(0, workUnitBudget)}-${hash}`;
  }
  return branch;
}

const BRANCH_TOKEN_PATTERN = /^[a-z0-9-]+$/;

/**
 * M25 §7/§25.4: a structural (non-Git) shape check usable without
 * spawning a process -- real validation still goes through
 * `gitCheckRefFormatBranch` (git-command-runner.ts) before any worktree
 * is created, since Git's own ref-format rules are the authority.
 */
export function isValidAiqtBranchShape(branchName: string): boolean {
  if (branchName.length === 0 || branchName.length > BRANCH_NAME_MAX_CHARS) return false;
  if (!branchName.startsWith("aiqt/")) return false;
  const rest = branchName.slice("aiqt/".length);
  const parts = rest.split("/");
  if (parts.length !== 2) return false;
  return parts.every((part) => part.length > 0 && BRANCH_TOKEN_PATTERN.test(part));
}
