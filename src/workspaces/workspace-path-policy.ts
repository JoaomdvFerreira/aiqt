import { dirname, basename, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { existsSync, lstatSync } from "node:fs";
import { PHYSICAL_PATH_MAX_CHARS } from "../schema/managed-workspace.schema.js";

/**
 * M25 §4.1: the derived default isolated-workspace root, a sibling of the
 * implementation root under a fixed `.aiqt-workspaces` directory. Pure --
 * never creates a directory, never touches the filesystem.
 */
export function deriveDefaultWorkspaceRoot(implementationRoot: string): string {
  const resolved = resolve(implementationRoot);
  const parent = dirname(resolved);
  const name = basename(resolved);
  return resolve(parent, ".aiqt-workspaces", name);
}

export interface WorkspaceRootValidation {
  ok: boolean;
  reason?: string;
}

function isFilesystemRoot(path: string): boolean {
  return dirname(path) === path;
}

/** True when `child` is a strict descendant of `parent` (never equal, never a different root/drive). */
function isStrictDescendant(child: string, parent: string): boolean {
  if (child === parent) return false;
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * M25 §4.1: validates a (derived or, in a future milestone, configured)
 * workspace root against every documented constraint. Read-only --
 * inspects the filesystem only to detect symlinks, never creates
 * anything. `implementationRoot` supplies the "trusted parent" reference
 * point (its own parent directory) for the ancestor-symlink walk, which
 * only applies when the candidate root is actually nested under that
 * parent (the derived-default shape); a root outside that parent is
 * accepted or rejected on the other rules alone.
 */
export function validateWorkspaceRoot(workspaceRoot: string, implementationRoot: string): WorkspaceRootValidation {
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedImplRoot = resolve(implementationRoot);
  const implParent = dirname(resolvedImplRoot);

  if (resolvedRoot.length > PHYSICAL_PATH_MAX_CHARS) {
    return { ok: false, reason: `workspace root exceeds physical_path_max_chars (${PHYSICAL_PATH_MAX_CHARS})` };
  }
  if (resolvedRoot === resolvedImplRoot) {
    return { ok: false, reason: "workspace root must not equal the implementation root" };
  }
  if (isStrictDescendant(resolvedRoot, resolvedImplRoot)) {
    return { ok: false, reason: "workspace root must not be nested inside the implementation root" };
  }
  if (isFilesystemRoot(resolvedRoot)) {
    return { ok: false, reason: "workspace root must not be the filesystem root" };
  }
  if (resolvedRoot === resolve(homedir())) {
    return { ok: false, reason: "workspace root must not be the user's home directory" };
  }
  if (resolvedRoot === implParent) {
    return { ok: false, reason: "workspace root must not be the implementation root's parent directory" };
  }

  try {
    // lstatSync (not existsSync/statSync) so a symlink is detected even
    // when its target is missing or broken -- existsSync follows
    // symlinks and reports false for a broken one, which would silently
    // skip this check entirely.
    if (lstatSync(resolvedRoot).isSymbolicLink()) {
      return { ok: false, reason: "workspace root must not itself be a symlink" };
    }
  } catch {
    // Path does not exist yet (the common case for a not-yet-created
    // workspace root) -- nothing to reject on this check.
  }

  if (isStrictDescendant(resolvedRoot, implParent)) {
    const segments = relative(implParent, resolvedRoot).split(sep).filter(Boolean);
    let current = implParent;
    for (const segment of segments) {
      current = resolve(current, segment);
      if (existsSync(current)) {
        try {
          if (lstatSync(current).isSymbolicLink()) {
            return { ok: false, reason: `ancestor path segment "${current}" is a symlink` };
          }
        } catch {
          return { ok: false, reason: `ancestor path segment "${current}" could not be inspected` };
        }
      }
    }
  }

  return { ok: true };
}

/**
 * M25 §6.4: the isolated physical path leaf is derived from the
 * generated canonical workspace ID, never directly from `assignmentKey`
 * -- so a later generation for the same assignment key receives a
 * distinct path.
 */
export function deriveWorkspacePath(workspaceRoot: string, workspaceId: string): string {
  return resolve(workspaceRoot, workspaceId);
}
