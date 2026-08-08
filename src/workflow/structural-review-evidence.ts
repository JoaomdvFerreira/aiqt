import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { gitRevParse } from "../workspaces/git-command-runner.js";

/**
 * Section 5.1: the smallest bounded repository-local evidence set --
 * tracked-source-file walk (fs-based, not an unbounded agent read),
 * plus the one already-reviewed, read-only git primitive
 * (gitRevParse) this module reuses rather than adding a new git
 * command-runner surface. Never reads file content outside `src/`/
 * `tests/`/`docs/governance/`/`.github/` and never writes anything.
 */

const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist", "coverage", ".git"]);

function walk(root: string, dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(root, full, out);
    } else if (stat.isFile()) {
      out.push(relative(root, full).split("\\").join("/"));
    }
  }
}

/** Repo-relative, forward-slash paths for every file under one or more root-relative directories. */
export function listRepositoryFiles(repoRoot: string, subdirs: readonly string[]): string[] {
  const out: string[] = [];
  for (const subdir of subdirs) {
    const dirPath = join(repoRoot, subdir);
    if (existsSync(dirPath)) walk(repoRoot, dirPath, out);
  }
  return out.sort();
}

export function listSourceFiles(repoRoot: string): string[] {
  return listRepositoryFiles(repoRoot, ["src"]).filter((f) => extname(f) === ".ts");
}

export function listTestFiles(repoRoot: string): string[] {
  return listRepositoryFiles(repoRoot, ["tests"]).filter((f) => f.endsWith(".test.ts"));
}

export function readRepoFileText(repoRoot: string, repoRelativePath: string): string | null {
  const full = join(repoRoot, repoRelativePath);
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

export function readRepoFileLines(repoRoot: string, repoRelativePath: string): string[] | null {
  const text = readRepoFileText(repoRoot, repoRelativePath);
  if (text === null) return null;
  return text.split(/\r\n|\n/);
}

/** The current HEAD commit -- the sole freshness binding for every finding produced in this review run. */
export function resolveReviewCommit(repoRoot: string): string {
  return gitRevParse(repoRoot, "HEAD");
}

export interface OwnerMapEntry {
  primary: string;
  supporting: string[];
  contractSummary?: string;
  lastVerifiedCommit?: string;
}

export interface OwnerMapDocument {
  protocolVersion: string;
  entries: Record<string, OwnerMapEntry>;
}

const OWNER_MAP_PATH = "docs/governance/repository-owner-map.json";

export function readOwnerMap(repoRoot: string): OwnerMapDocument | null {
  const text = readRepoFileText(repoRoot, OWNER_MAP_PATH);
  if (text === null) return null;
  try {
    return JSON.parse(text) as OwnerMapDocument;
  } catch {
    return null;
  }
}
