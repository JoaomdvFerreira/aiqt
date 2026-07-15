import { resolve } from "node:path";

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

export interface RootResolution {
  /** Runtime directory containing .aiqt. Never persisted as an absolute project.json field. */
  controlRoot: string;
  /** Raw project.project.existingRepositoryPath, or null when unset. */
  existingRepositoryPath: string | null;
  /** existingRepositoryPath resolved relative to controlRoot, or controlRoot itself when unset. */
  implementationRoot: string;
  /** True when the implementation root is the same directory as the control root. */
  sameRoot: boolean;
}

/** §12: existingRepositoryPath resolved relative to controlRoot when set; otherwise controlRoot. */
export function resolveImplementationRoot(
  controlRoot: string,
  existingRepositoryPath: string | null | undefined,
): string {
  if (!existingRepositoryPath) return resolve(controlRoot);
  return resolve(controlRoot, existingRepositoryPath);
}

/** Resolve the full root model from a runtime control root and the persisted existingRepositoryPath. */
export function resolveRoots(input: {
  controlRoot: string;
  existingRepositoryPath?: string | null;
}): RootResolution {
  const controlRoot = resolve(input.controlRoot);
  const existingRepositoryPath = input.existingRepositoryPath ?? null;
  const implementationRoot = resolveImplementationRoot(controlRoot, existingRepositoryPath);
  return {
    controlRoot,
    existingRepositoryPath,
    implementationRoot,
    sameRoot: implementationRoot === controlRoot,
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
