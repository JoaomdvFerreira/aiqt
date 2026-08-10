import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitDiffNumstat } from "../workspaces/git-command-runner.js";
import type { DefectRecord } from "../schema/defect.schema.js";
import type { NightAuditCoverageEntry, NightReviewDomain } from "../schema/night-audit.schema.js";
import type { ReviewCandidateScope } from "./night-audit-coverage-queue.js";

/**
 * M48-WU05 (build spec Sec 6): derives the real facts night-audit-coverage-
 * queue.ts's scoreReviewCandidates() needs -- candidate (domain, scope)
 * pairs, which changed since last review, and which are high-churn.
 * Real Git evidence, not fabricated: every function here reads actual
 * repository state through the existing read-only git-command-runner.ts
 * allowlist (gitDiffNumstat), never invents a result.
 */

/**
 * A conservative, first-pass default scope map -- one or two bounded areas
 * per domain, filtered to what actually exists in the target repository.
 * Expected to evolve with real usage; this is deliberately simple rather
 * than an unbounded directory-discovery heuristic.
 */
const DOMAIN_SCOPE_CANDIDATES: Readonly<Record<NightReviewDomain, readonly string[]>> = {
  code_quality: ["src"],
  tests: ["tests"],
  documentation: ["docs", "README.md"],
  repository_structure: ["src", "."],
  architecture: ["src"],
  governance_config: ["docs/governance", "package.json", ".github"],
};

export function deriveReviewCandidates(repoRoot: string, exists: (path: string) => boolean = existsSync): ReviewCandidateScope[] {
  const candidates: ReviewCandidateScope[] = [];
  const seen = new Set<string>();
  for (const domain of Object.keys(DOMAIN_SCOPE_CANDIDATES) as NightReviewDomain[]) {
    for (const scope of DOMAIN_SCOPE_CANDIDATES[domain]) {
      const key = `${domain}::${scope}`;
      if (seen.has(key)) continue;
      if (scope !== "." && !exists(join(repoRoot, scope))) continue;
      seen.add(key);
      candidates.push({ domain, scope });
    }
  }
  return candidates;
}

function scopePrefix(scope: string): string {
  return scope === "." ? "" : `${scope.replace(/\/$/, "")}/`;
}

function pathWithinScope(path: string, scope: string): boolean {
  const prefix = scopePrefix(scope);
  return prefix === "" || path === scope || path.startsWith(prefix);
}

interface NumstatChange {
  path: string;
  changedLines: number;
}

function parseNumstat(output: string): NumstatChange[] {
  const changes: NumstatChange[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const [insertedRaw, deletedRaw, path] = parts;
    const inserted = insertedRaw === "-" ? 0 : Number.parseInt(insertedRaw, 10);
    const deleted = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10);
    changes.push({ path, changedLines: (Number.isFinite(inserted) ? inserted : 0) + (Number.isFinite(deleted) ? deleted : 0) });
  }
  return changes;
}

/** Build spec Sec 6: total changed lines under a scope, since its last review, at or above this is "high churn." */
export const HIGH_CHURN_LINE_THRESHOLD = 200;

export interface ScopeChangeFacts {
  changedScopeKeys: Set<string>;
  highChurnScopeKeys: Set<string>;
}

/**
 * For each candidate with an existing coverage entry, determines whether
 * any tracked file under its scope changed since `entry.lastReviewedCommit`
 * (via `git diff --numstat <lastReviewedCommit>`, which compares against
 * the current working tree), and the total changed-line churn under that
 * scope. A candidate with no coverage entry is never-reviewed (tier 2) and
 * is not consulted here -- "changed since review" has no meaning without a
 * prior review to compare against. A diff that cannot be computed (e.g. the
 * recorded commit is no longer reachable) is treated as unchanged, never
 * fabricated as changed.
 */
export function computeScopeChangeFacts(
  repoRoot: string,
  candidates: readonly ReviewCandidateScope[],
  coverage: readonly NightAuditCoverageEntry[],
  diffNumstat: (cwd: string, baseRef: string) => string = gitDiffNumstat,
): ScopeChangeFacts {
  const changedScopeKeys = new Set<string>();
  const highChurnScopeKeys = new Set<string>();
  const coverageByKey = new Map(coverage.map((e) => [`${e.domain}::${e.scope}`, e]));

  for (const candidate of candidates) {
    const key = `${candidate.domain}::${candidate.scope}`;
    const entry = coverageByKey.get(key);
    if (!entry) continue;

    let raw: string;
    try {
      raw = diffNumstat(repoRoot, entry.lastReviewedCommit);
    } catch {
      continue;
    }
    const relevant = parseNumstat(raw).filter((c) => pathWithinScope(c.path, candidate.scope));
    if (relevant.length > 0) changedScopeKeys.add(key);
    const totalChurn = relevant.reduce((sum, c) => sum + c.changedLines, 0);
    if (totalChurn >= HIGH_CHURN_LINE_THRESHOLD) highChurnScopeKeys.add(key);
  }

  return { changedScopeKeys, highChurnScopeKeys };
}

/** Build spec Sec 6: a defect updated within this window counts as a "recent defect signal" for any candidate scope it touches. */
export const RECENT_DEFECT_SIGNAL_WINDOW_DAYS = 7;

export function computeRecentDefectSignalScopeKeys(candidates: readonly ReviewCandidateScope[], defects: readonly DefectRecord[], nowIso: string): Set<string> {
  const windowMs = RECENT_DEFECT_SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const nowMs = Date.parse(nowIso);
  const recentPaths: string[] = [];
  for (const defect of defects) {
    if (nowMs - Date.parse(defect.updatedAt) > windowMs) continue;
    for (const path of defect.affectedFiles ?? []) recentPaths.push(path);
  }

  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (recentPaths.some((path) => pathWithinScope(path, candidate.scope))) {
      keys.add(`${candidate.domain}::${candidate.scope}`);
    }
  }
  return keys;
}
