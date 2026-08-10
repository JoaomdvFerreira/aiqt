import { isPathWithinApprovedRoots } from "./execution-context-manifest.js";
import { runStructuralReview, type RunStructuralReviewOptions, type RawStructuralReviewResult } from "./structural-review-engine.js";
import type { StructuralFinding, StructuralReviewDomain } from "../schema/structural-review.schema.js";
import type { AuditFinding, AuditFindingCandidateInput, NightAuditCoverageEntry, NightReviewDomain, ReviewTask } from "../schema/night-audit.schema.js";

/**
 * M48-WU03 (build spec Sec 5/7): bounded ReviewTask execution mechanics --
 * context manifest, handoff packet, structural call-through, result
 * normalization, and coverage-ledger upsert. No repository mutation
 * anywhere in this file; every function is pure (no filesystem write, no
 * canonical-state read/write, no network).
 *
 * Execution model (build spec Sec 4/5 clarified at implementation time):
 * AIQT never spawns a live coding-agent process itself outside the M38
 * sandboxed repair path (see build spec Sec 3's rejection of
 * sandboxBackendContract/workspaceLifecycle as M48 owners). A ReviewTask is
 * therefore packaged and handed off exactly like a Work Unit packet (reuses
 * the packetLifecycle discipline, not its schema): the driving agent reads
 * the packet, reviews the named scope, and reports findings back through
 * `aiqt review night submit` (WU48-05). This mirrors the *existing*
 * `aiqt next` (hand out bounded work) -> agent implements -> `aiqt
 * checkpoint` (record result) loop applied to review instead of
 * implementation, rather than inventing a second execution mechanism. Only
 * `isPathWithinApprovedRoots` is reused verbatim from
 * execution-context-manifest.ts; that module's token-budget constants and
 * `WorkComplexity`-keyed profile are Work-Unit-shaped and not exported, so
 * ReviewTask context uses its own small fixed bound instead (a ReviewTask
 * is deliberately small by design -- it has no complexity axis to size
 * against).
 */

/** A ReviewTask's context is always small and bounded -- no complexity-based escalation, unlike a Work Unit. */
export const REVIEW_TASK_MAX_CONTEXT_PATHS = 25;

export interface ReviewTaskContextItem {
  path: string;
  reason: string;
}

export interface ReviewTaskContextManifest {
  scope: string;
  items: ReviewTaskContextItem[];
  warnings: string[];
}

/** Build spec Sec 5/10.2 (architecture spec): path-safe, bounded, deduplicated. Never includes a path outside the approved repository root. */
export function buildReviewTaskContextManifest(task: ReviewTask, candidatePaths: readonly string[]): ReviewTaskContextManifest {
  const warnings: string[] = [];
  const items: ReviewTaskContextItem[] = [];
  const seen = new Set<string>();

  for (const path of candidatePaths) {
    if (seen.has(path)) continue;
    if (!isPathWithinApprovedRoots(path)) {
      warnings.push(`Excluded out-of-root/unsafe path reference: "${path}".`);
      continue;
    }
    if (items.length >= REVIEW_TASK_MAX_CONTEXT_PATHS) {
      warnings.push(`Additional path(s) omitted to keep the ReviewTask context bounded (max ${REVIEW_TASK_MAX_CONTEXT_PATHS}).`);
      break;
    }
    seen.add(path);
    items.push({ path, reason: `Within scope "${task.scope}".` });
  }

  return { scope: task.scope, items, warnings };
}

export interface ReviewTaskPacket {
  taskId: string;
  domain: NightReviewDomain;
  scope: string;
  repositoryCommit: string;
  contextManifest: ReviewTaskContextManifest;
  instructions: string[];
  expectedResultFormat: "audit-finding-candidates@1";
}

/** Build spec Sec 5/13: the bounded handoff packet -- structured, no raw reasoning transcript, no unbounded scope. */
export function buildReviewTaskPacket(task: ReviewTask, contextManifest: ReviewTaskContextManifest): ReviewTaskPacket {
  return {
    taskId: task.taskId,
    domain: task.domain,
    scope: task.scope,
    repositoryCommit: task.repositoryCommit,
    contextManifest,
    instructions: [
      `Review only "${task.scope}" for the "${task.domain}" domain, at commit ${task.repositoryCommit}.`,
      "This is a read-only review. Do not modify, stage, or commit any file.",
      "Report only concrete, evidence-backed findings; omit anything you are not confident about.",
      `Submit findings with: aiqt review night submit ${task.taskId} --from-file <path>`,
    ],
    expectedResultFormat: "audit-finding-candidates@1",
  };
}

/**
 * Build spec Sec 5/7: assembles a full AuditFinding from a submitted
 * candidate plus the ReviewTask it was produced for. `findingKey` is
 * supplied by the caller (WU48-04 owns fingerprint computation) rather
 * than computed here, so this module has no dependency on WU48-04.
 */
export function normalizeAuditFindingCandidate(candidate: AuditFindingCandidateInput, task: ReviewTask, findingKey: string): AuditFinding {
  return {
    findingKey,
    domain: task.domain,
    checkId: candidate.checkId,
    title: candidate.title,
    explanation: candidate.explanation,
    reviewCommit: task.repositoryCommit,
    scope: task.scope,
    affectedPaths: candidate.affectedPaths,
    evidence: candidate.evidence,
    confidence: candidate.confidence,
    significance: candidate.significance,
    disposition: candidate.disposition,
    recommendedNextAction: candidate.recommendedNextAction,
    validationIdea: candidate.validationIdea,
  };
}

/** Build spec Sec 6: upsert-by-(domain,scope) -- never a second entry for the same pair, never a wholesale rewrite of the ledger. */
export function upsertCoverageEntry(coverage: readonly NightAuditCoverageEntry[], entry: NightAuditCoverageEntry): NightAuditCoverageEntry[] {
  const key = (e: { domain: string; scope: string }) => `${e.domain}::${e.scope}`;
  const filtered = coverage.filter((e) => key(e) !== key(entry));
  return [...filtered, entry];
}

/**
 * Build spec Sec 3/5: the exact, narrow overlap between M48's six domains
 * and M43's seven deterministic rule sets. `code_quality`/`documentation`/
 * `governance_config` have no entry -- they have no rule-engine equivalent
 * and always require an agent-executed read.
 */
export const NIGHT_REVIEW_TO_STRUCTURAL_DOMAINS: Partial<Record<NightReviewDomain, readonly StructuralReviewDomain[]>> = {
  tests: ["test_infrastructure"],
  repository_structure: ["ownership_divergence", "dead_structural_paths"],
  architecture: ["dependency_coupling", "responsibility_concentration", "execution_safety_boundary", "public_contract_drift"],
};

function findingWithinScope(finding: StructuralFinding, scope: string): boolean {
  return finding.affectedPaths.some((p) => p.startsWith(scope));
}

/**
 * Build spec Sec 3/5: identical value sets by design (AuditFindingConfidence/
 * Significance/Disposition were defined in WU48-01 mirroring
 * StructuralFinding's own three enums exactly), so mapping is the identity
 * function on the string value -- there is no meaning conversion, only a
 * type-boundary crossing between two deliberately-separate contracts.
 */
function structuralFindingToCandidate(finding: StructuralFinding): AuditFindingCandidateInput {
  return {
    checkId: finding.ruleId,
    title: finding.title,
    explanation: finding.explanation,
    affectedPaths: finding.affectedPaths,
    evidence: finding.evidence.map((e) => ({ evidenceId: e.evidenceId, description: e.description, locator: e.locator })),
    confidence: finding.confidence,
    significance: finding.significance,
    disposition: finding.disposition,
    recommendedNextAction: finding.recommendedNextAction,
  };
}

/**
 * Build spec Sec 3/5: for a ReviewTask whose domain overlaps
 * `structuralReviewEngine`'s coverage, run it once and return candidates
 * scoped to the task -- never a second rule-engine implementation. Returns
 * an empty array (not an error) for a domain with no structural overlap;
 * the caller still hands the task to an agent in that case.
 *
 * `runReview` is injectable (defaults to the real `runStructuralReview`),
 * mirroring maintenance-due-engine.ts's injectable-clock discipline --
 * lets tests supply fixture findings without a real Git repository or
 * `vi.mock`.
 */
export function runStructuralCallThrough(
  task: ReviewTask,
  repoRoot: string,
  runReview: (options: RunStructuralReviewOptions) => RawStructuralReviewResult = runStructuralReview,
): AuditFindingCandidateInput[] {
  const structuralDomains = NIGHT_REVIEW_TO_STRUCTURAL_DOMAINS[task.domain];
  if (!structuralDomains || structuralDomains.length === 0) return [];

  const result = runReview({ repoRoot, domains: [...structuralDomains] });
  return result.findings.filter((f) => findingWithinScope(f, task.scope)).map(structuralFindingToCandidate);
}
