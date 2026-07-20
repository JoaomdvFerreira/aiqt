import { resolve, join } from "node:path";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";

/**
 * M16: the canonical root model (F064). controlRoot is always
 * runtime-derived from the loaded .aiqt location and is never persisted as
 * an absolute project.json field. implementationRoot is an operational term
 * resolved from project.existingRepositoryPath -- the canonical persisted
 * field -- falling back to controlRoot when unset. This module is the single
 * place that resolves roots; every guidance surface (driver, plan, packet,
 * checkpoint, status, manage) consumes its output instead of re-deriving
 * roots ad hoc.
 */

/**
 * M21-WU08 §5.8: a read-only trust classification, never an error by
 * itself. An external or unavailable root is reported as a warning-level
 * fact, not rejected -- AIQT never executes at, mutates, or contains the
 * implementation root based on this classification.
 */
export type ImplementationRootTrustLevel =
  | "control_root"
  | "external_verified"
  | "external_missing"
  | "external_not_directory"
  | "external_unreadable";

export interface RootDiagnostics {
  exists: boolean;
  isDirectory: boolean;
  isGitRepository: boolean;
  resolvesThroughSymlink: boolean;
  trust: ImplementationRootTrustLevel;
  /** Deterministic, non-blocking warning text, or null when there is nothing to warn about. */
  warning: string | null;
}

export interface RootResolution {
  /** Runtime directory containing .aiqt. Never persisted as an absolute project.json field. */
  controlRoot: string;
  /** Raw project.project.existingRepositoryPath, or null when unset. */
  existingRepositoryPath: string | null;
  /** existingRepositoryPath resolved relative to controlRoot, or controlRoot itself when unset. */
  implementationRoot: string;
  /** True when the implementation root is the same directory as the control root. */
  sameRoot: boolean;
  /** M21-WU08: read-only diagnostics about the implementation root. Never derived by executing a command there. */
  diagnostics: RootDiagnostics;
}

/** §12: existingRepositoryPath resolved relative to controlRoot when set; otherwise controlRoot. */
export function resolveImplementationRoot(
  controlRoot: string,
  existingRepositoryPath: string | null | undefined,
): string {
  if (!existingRepositoryPath) return resolve(controlRoot);
  return resolve(controlRoot, existingRepositoryPath);
}

/**
 * M21-WU08: warning-first, read-only diagnostics for the implementation
 * root. Uses only `node:fs` stat-family calls -- never spawns a process,
 * never writes, never follows a symlink to mutate anything. A missing,
 * non-directory, or unreadable external root is a deterministic warning,
 * not a thrown error; `sameRoot` (control root) is always trusted without
 * a filesystem check, since it is guaranteed to exist by the caller having
 * already loaded `.aiqt` from it.
 */
export function diagnoseImplementationRoot(
  implementationRoot: string,
  sameRoot: boolean,
): RootDiagnostics {
  if (sameRoot) {
    return {
      exists: true,
      isDirectory: true,
      isGitRepository: existsSync(join(implementationRoot, ".git")),
      resolvesThroughSymlink: false,
      trust: "control_root",
      warning: null,
    };
  }

  try {
    if (!existsSync(implementationRoot)) {
      return {
        exists: false,
        isDirectory: false,
        isGitRepository: false,
        resolvesThroughSymlink: false,
        trust: "external_missing",
        warning: `External implementation root "${implementationRoot}" does not exist.`,
      };
    }

    const lstat = lstatSync(implementationRoot);
    const resolvesThroughSymlink = lstat.isSymbolicLink();
    const stat = statSync(implementationRoot);

    if (!stat.isDirectory()) {
      return {
        exists: true,
        isDirectory: false,
        isGitRepository: false,
        resolvesThroughSymlink,
        trust: "external_not_directory",
        warning: `External implementation root "${implementationRoot}" exists but is not a directory.`,
      };
    }

    // realpathSync surfaces a broken symlink target or a permission
    // failure while resolving path components without ever executing
    // anything at the resolved location.
    realpathSync(implementationRoot);

    return {
      exists: true,
      isDirectory: true,
      isGitRepository: existsSync(join(implementationRoot, ".git")),
      resolvesThroughSymlink,
      trust: "external_verified",
      warning: null,
    };
  } catch {
    return {
      exists: true,
      isDirectory: false,
      isGitRepository: false,
      resolvesThroughSymlink: false,
      trust: "external_unreadable",
      warning: `External implementation root "${implementationRoot}" could not be read (permission or filesystem error).`,
    };
  }
}

/** Resolve the full root model from a runtime control root and the persisted existingRepositoryPath. */
export function resolveRoots(input: {
  controlRoot: string;
  existingRepositoryPath?: string | null;
}): RootResolution {
  const controlRoot = resolve(input.controlRoot);
  const existingRepositoryPath = input.existingRepositoryPath ?? null;
  const implementationRoot = resolveImplementationRoot(controlRoot, existingRepositoryPath);
  const sameRoot = implementationRoot === controlRoot;
  return {
    controlRoot,
    existingRepositoryPath,
    implementationRoot,
    sameRoot,
    diagnostics: diagnoseImplementationRoot(implementationRoot, sameRoot),
  };
}

/** §13.1: the driver prompt's always-rendered root context block. */
export function renderRootContextSection(roots: RootResolution): string {
  const lines: string[] = [];
  lines.push("AIQT control root:");
  lines.push(roots.controlRoot);
  lines.push("");
  lines.push("Implementation root:");
  lines.push(roots.implementationRoot);
  lines.push("");
  lines.push("Run AIQT commands from the control root.");
  lines.push(
    "Run application, Git, validation, and Playwright/browser commands from the implementation root.",
  );
  return lines.join("\n");
}
