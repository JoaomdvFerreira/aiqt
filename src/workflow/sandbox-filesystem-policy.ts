import { resolve } from "node:path";
import { homedir } from "node:os";
import type { SandboxFilesystemPolicy, SandboxMount } from "../schema/sandbox-backend.schema.js";
import { isAiqtOwnRepository } from "./autonomous-run-self-management-guard.js";

/**
 * M38-WU01 (build spec Sec 6 "Filesystem policy": "approved worktree:
 * read/write; approved runtime/tool paths: read-only; isolated
 * temp/output directories; no host home; no parent repository; no
 * sibling worktrees; no secret stores; no arbitrary absolute paths").
 * Pure, read-only validation over a policy's declared host paths -- this
 * module never creates a mount, a bind, a container, or a symlink; it
 * only inspects (`isAiqtOwnRepository`'s own read-only package.json
 * check) and compares path strings, matching M25's
 * workspace-path-policy.ts precedent for what "pure filesystem policy
 * validation" means in this codebase.
 *
 * "No parent repository" / "no sibling worktrees" are necessarily
 * run-specific (this module has no way to know a given run's own parent
 * repository or sibling worktrees in the abstract) -- WU38-02, which
 * actually derives a run's mounts from a real worktree path, is where
 * those two checks become concrete. This function enforces the two
 * checks that ARE evaluable in the abstract: the worktree mount must be
 * writable and every other mount read-only, and no mount may resolve to
 * the operator's home directory or the AIQT product's own repository.
 */
export interface SandboxFilesystemPolicyValidation {
  ok: boolean;
  issues: string[];
}

function checkMount(mount: SandboxMount, expectedMode: SandboxMount["mode"], label: string, issues: string[]): void {
  if (mount.mode !== expectedMode) {
    issues.push(`${label} has mode "${mount.mode}", expected "${expectedMode}".`);
  }
  const resolvedHostPath = resolve(mount.hostPath);
  if (resolvedHostPath === resolve(homedir())) {
    issues.push(`${label} host path resolves to the operator's home directory -- never permitted.`);
  }
  if (isAiqtOwnRepository(resolvedHostPath)) {
    issues.push(`${label} host path resolves to the AIQT product's own repository -- self-management is never permitted.`);
  }
}

export function validateSandboxFilesystemPolicy(policy: SandboxFilesystemPolicy): SandboxFilesystemPolicyValidation {
  const issues: string[] = [];

  checkMount(policy.worktreeMount, "read_write", "worktreeMount", issues);
  policy.readOnlyMounts.forEach((mount, index) => checkMount(mount, "read_only", `readOnlyMounts[${index}]`, issues));

  const resolvedWorktree = resolve(policy.worktreeMount.hostPath);
  for (const [index, mount] of policy.readOnlyMounts.entries()) {
    if (resolve(mount.hostPath) === resolvedWorktree) {
      issues.push(`readOnlyMounts[${index}] duplicates the worktree mount's own host path -- a path must not be mounted both read-only and read-write.`);
    }
  }

  if (policy.isolatedOutputDirectory.trim() === "") {
    issues.push("isolatedOutputDirectory must not be empty.");
  } else if (resolve(policy.isolatedOutputDirectory) === resolve(homedir())) {
    issues.push("isolatedOutputDirectory must not resolve to the operator's home directory.");
  }

  return { ok: issues.length === 0, issues };
}
