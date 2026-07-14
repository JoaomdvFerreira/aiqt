import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import type { AcknowledgedFinding } from "../schema/review-acknowledgment.schema.js";
import type { ReviewResult } from "./review-service.js";
import { workUnitCountsByStatus } from "../workflow/statuses.js";
import {
  buildNormalizedIssues,
  getIssueOverrides,
  effectiveIssueStatus,
  reviewIssueKey,
} from "./issue-service.js";
import type { IssueOverrideStatus } from "../schema/issue-state.schema.js";

/** M9 §7.1: missing state.review must be treated as an empty acknowledgment list. */
export function getAcknowledgedFindings(state: StateModel): AcknowledgedFinding[] {
  return state.review?.acknowledgedFindings ?? [];
}

export function isFindingAcknowledged(
  findingKey: string,
  acknowledged: readonly AcknowledgedFinding[],
): boolean {
  return acknowledged.some((a) => a.findingKey === findingKey);
}

export interface FindingView extends ReviewFinding {
  acknowledged: boolean;
}

export interface AcknowledgedFindingView extends AcknowledgedFinding {
  /** True if this acknowledgment still corresponds to a currently active finding. */
  stillActive: boolean;
}

/**
 * A checkpoint-category finding whose findingKey uses the
 * "checkpoint:<workUnitId>:<field>:<value>" pattern represents an unresolved
 * validation/acceptance-criteria gap on a done work unit -- exactly the
 * dogfood WU003 case (a live external-service verification gap). Combined
 * with checkpoint-issue-derived gaps (M10 §8.3) into the final bucket.
 */
const EXTERNAL_VERIFICATION_KEY_PREFIX = "checkpoint:";

export function isAllWorkDone(state: StateModel): boolean {
  const workUnits = state.workGraph.workUnits;
  return workUnits.length > 0 && workUnits.every((wu) => wu.status === "done");
}

export interface FindingClassification {
  activeFindings: FindingView[];
  acknowledgedFindings: AcknowledgedFindingView[];
  /** Blocking findings that are NOT acknowledged -- what development mode cares about. */
  unacknowledgedBlockingFindings: FindingView[];
  /** All blocking findings, regardless of acknowledgment -- what release mode cares about. */
  blockingFindingsIgnoringAcknowledgment: FindingView[];
  /** M10 §8.3: operator/user-controlled setup or action, review findings + checkpoint issues combined. */
  userActionRequired: string[];
  /** M10 §8.3: live runtime/service verification gaps, review findings + checkpoint issues combined. */
  externalVerificationGaps: string[];
  /** M10 §8.3: issues an agent can resolve without external/user setup. */
  agentFixableIssues: string[];
  /** M10 §8.3: blocking review findings + checkpoint issues requiring release-blocking setup/verification. */
  releaseBlockers: string[];
  /** M10 §8.3: low/medium non-blocking issues suitable for later optimization. */
  postMvpBacklogCandidates: string[];
  developmentComplete: boolean;
  productionReady: boolean;
}

/**
 * M11 §12: statuses that fully clear an issue from every manage/final-review
 * bucket and from both dev- and release-mode blocking. "resolved" means
 * genuinely addressed; "post_mvp" means explicitly triaged out of the
 * current release (it is instead force-included in postMvpBacklogCandidates
 * for checkpoint-issue-sourced items).
 */
function isFullyExempt(status: IssueOverrideStatus): boolean {
  return status === "resolved" || status === "post_mvp";
}

/**
 * M11 §12: any override status (including "accepted"/"deferred") exempts an
 * issue from development-mode blocking, mirroring M9 acknowledgment's
 * existing dev-exempt/release-still-blocking semantics.
 */
function isDevExempt(status: IssueOverrideStatus): boolean {
  return status !== "active";
}

/**
 * Shared classification core reused by aiqt manage, aiqt review --mode, and
 * the final-review.md export, so all surfaces agree on exactly what
 * "development complete," "production ready," and each M10 §8.3
 * classification bucket mean. M11 §12 layers issue overrides on top of this
 * same M10 classification -- it does not create a second classifier.
 *
 * developmentComplete: every work unit is done AND no unacknowledged,
 * non-overridden blocking finding remains -- acknowledgment or any M11
 * override status exempts a finding from this check.
 *
 * productionReady: developmentComplete AND no release blocker exists at all
 * (review findings ignoring acknowledgment, plus checkpoint-issue-derived
 * release blockers), excluding findings/issues whose M11 override status is
 * "resolved" or "post_mvp" -- an acknowledged or merely "accepted"/"deferred"
 * finding still blocks release, per §8.2's "Acknowledged findings remain
 * visible and may still block release" and M11 §12's "deferred and post_mvp
 * issues remain visible but move to the appropriate section" (deferred is
 * NOT the same as resolved).
 */
export function classifyFindings(
  _project: ProjectModel,
  state: StateModel,
  review: ReviewResult,
): FindingClassification {
  const acknowledgedRecords = getAcknowledgedFindings(state);
  const issueOverrides = getIssueOverrides(state);
  const activeKeys = new Set(review.findings.map((f) => f.findingKey));

  const activeFindings: FindingView[] = review.findings.map((f) => ({
    ...f,
    acknowledged: isFindingAcknowledged(f.findingKey, acknowledgedRecords),
  }));

  const acknowledgedFindings: AcknowledgedFindingView[] = acknowledgedRecords.map((a) => ({
    ...a,
    stillActive: activeKeys.has(a.findingKey),
  }));

  const statusForFinding = (f: ReviewFinding): IssueOverrideStatus =>
    effectiveIssueStatus(reviewIssueKey(f.findingKey), issueOverrides);

  const unacknowledgedBlockingFindings = activeFindings.filter(
    (f) => f.blocking && !f.acknowledged && !isDevExempt(statusForFinding(f)),
  );
  const blockingFindingsIgnoringAcknowledgment = activeFindings.filter(
    (f) => f.blocking && !isFullyExempt(statusForFinding(f)),
  );

  const findingExternalVerificationGaps = activeFindings
    .filter((f) => f.findingKey.startsWith(EXTERNAL_VERIFICATION_KEY_PREFIX))
    .filter((f) => !isFullyExempt(statusForFinding(f)))
    .map((f) => `[${f.findingKey}] ${f.message}`);

  // §8.2/§8.3/M11 §12: classify every open checkpoint issue via the
  // deterministic text-heuristic classifier (reused, not reimplemented),
  // then apply the M11 override precedence on top.
  const normalizedIssues = buildNormalizedIssues(state, review);
  const issueUserActionRequired: string[] = [];
  const issueExternalVerificationGaps: string[] = [];
  const agentFixableIssues: string[] = [];
  const issueReleaseBlockers: string[] = [];
  const postMvpBacklogCandidates: string[] = [];

  for (const issue of normalizedIssues) {
    if (issue.source !== "checkpoint") continue;
    const label = `${issue.workUnitId}: ${issue.message}`;
    if (issue.status === "resolved") continue;
    if (issue.status === "post_mvp") {
      postMvpBacklogCandidates.push(label);
      continue;
    }
    if (issue.raw.userActionRequired) issueUserActionRequired.push(label);
    if (issue.raw.externalVerificationGap) issueExternalVerificationGaps.push(label);
    if (issue.raw.agentFixable) agentFixableIssues.push(label);
    if (issue.raw.releaseBlocking) issueReleaseBlockers.push(label);
    if (issue.raw.backlogCandidate) postMvpBacklogCandidates.push(label);
  }

  // §8.4: a blocking, unacknowledged, non-overridden "context" review
  // finding (e.g. a blocking open question) is itself a human-decision-
  // required item.
  const blockingContextUserAction = activeFindings
    .filter(
      (f) =>
        f.category === "context" &&
        f.blocking &&
        !f.acknowledged &&
        !isFullyExempt(statusForFinding(f)),
    )
    .map((f) => f.message);

  const userActionRequired = [...blockingContextUserAction, ...issueUserActionRequired];
  const externalVerificationGaps = [
    ...findingExternalVerificationGaps,
    ...issueExternalVerificationGaps,
  ];
  const releaseBlockers = [
    ...blockingFindingsIgnoringAcknowledgment.map((f) => `[${f.findingKey}] ${f.message}`),
    ...issueReleaseBlockers,
  ];

  const developmentComplete = isAllWorkDone(state) && unacknowledgedBlockingFindings.length === 0;
  const productionReady = developmentComplete && releaseBlockers.length === 0;

  return {
    activeFindings,
    acknowledgedFindings,
    unacknowledgedBlockingFindings,
    blockingFindingsIgnoringAcknowledgment,
    userActionRequired,
    externalVerificationGaps,
    agentFixableIssues,
    releaseBlockers,
    postMvpBacklogCandidates,
    developmentComplete,
    productionReady,
  };
}

/**
 * The set of review findings that should gate a given review mode's
 * pass/fail exit code and nextRecommendedCommand precedence. Development
 * mode treats an acknowledged blocking finding as non-blocking; release mode
 * ignores acknowledgment entirely (§8.2).
 */
export function findingsForMode(
  review: ReviewResult,
  acknowledged: readonly AcknowledgedFinding[],
  mode: "development" | "release",
): ReviewFinding[] {
  if (mode === "release") return review.findings;
  return review.findings.filter(
    (f) => !f.blocking || !isFindingAcknowledged(f.findingKey, acknowledged),
  );
}

export interface ManageReport {
  projectStatus: string;
  developmentComplete: boolean;
  productionReady: boolean;
  recommendedCommand: string;
  reason: string;
  counts: Record<string, number>;
  activeFindings: FindingView[];
  acknowledgedFindings: AcknowledgedFindingView[];
  userActionRequired: string[];
  externalVerificationGaps: string[];
  agentFixableIssues: string[];
  releaseBlockers: string[];
  postMvpBacklogCandidates: string[];
  /** M10 §9: explicit named counts so aiqt manage and final-review.md are testably identical. */
  releaseBlockerCount: number;
  userActionRequiredCount: number;
  externalVerificationGapCount: number;
  agentFixableIssueCount: number;
}

/**
 * M10 §10: the centralized terminal/release nextRecommendedCommand
 * refinement, reused by both aiqt manage and final-review.md so recommendation
 * logic is not scattered across review/manage/export/status. Always resolves
 * to exactly one command string; multi-step guidance lives in `reason` only.
 */
function computeManageRecommendation(
  classification: FindingClassification,
  review: ReviewResult,
): { recommendedCommand: string; reason: string } {
  if (!classification.developmentComplete) {
    // §10.1 case: release review failed with unacknowledged development
    // blockers -- once all work is done, repeatedly recommending "aiqt
    // review" would just repeat the same blocker forever.
    if (classification.unacknowledgedBlockingFindings.length > 0) {
      return {
        recommendedCommand: "aiqt review acknowledge",
        reason: "Acknowledge accepted historical findings or fix the blocker.",
      };
    }
    return {
      recommendedCommand: review.nextRecommendedCommand,
      reason: `Development is not yet complete. Recommended next step: ${review.nextRecommendedCommand}.`,
    };
  }

  // developmentComplete is true from here on.
  if (classification.releaseBlockers.length > 0) {
    return {
      recommendedCommand: "aiqt manage",
      reason: "Resolve release blockers, then rerun aiqt review --mode release.",
    };
  }

  if (
    classification.userActionRequired.length > 0 ||
    classification.externalVerificationGaps.length > 0
  ) {
    return {
      recommendedCommand: "aiqt manage",
      reason: "Complete user-action-required setup and live verification.",
    };
  }

  return {
    recommendedCommand: "aiqt export all",
    reason: "Development-complete export is available.",
  };
}

/**
 * Build the full aiqt manage report (§8.1), reusing an already-computed
 * ReviewResult so callers that already ran the review engine (e.g. aiqt
 * export) do not need to run it twice.
 */
export function buildManageReport(
  project: ProjectModel,
  state: StateModel,
  review: ReviewResult,
): ManageReport {
  const classification = classifyFindings(project, state, review);
  const { recommendedCommand, reason } = computeManageRecommendation(classification, review);

  return {
    projectStatus: state.projectStatus,
    developmentComplete: classification.developmentComplete,
    productionReady: classification.productionReady,
    recommendedCommand,
    reason,
    counts: workUnitCountsByStatus(state),
    activeFindings: classification.activeFindings,
    acknowledgedFindings: classification.acknowledgedFindings,
    userActionRequired: classification.userActionRequired,
    externalVerificationGaps: classification.externalVerificationGaps,
    agentFixableIssues: classification.agentFixableIssues,
    releaseBlockers: classification.releaseBlockers,
    postMvpBacklogCandidates: classification.postMvpBacklogCandidates,
    releaseBlockerCount: classification.releaseBlockers.length,
    userActionRequiredCount: classification.userActionRequired.length,
    externalVerificationGapCount: classification.externalVerificationGaps.length,
    agentFixableIssueCount: classification.agentFixableIssues.length,
  };
}
