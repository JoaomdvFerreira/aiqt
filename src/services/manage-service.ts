import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { ReviewFinding } from "../schema/review-finding.schema.js";
import type { AcknowledgedFinding } from "../schema/review-acknowledgment.schema.js";
import type { ReviewResult } from "./review-service.js";
import { workUnitCountsByStatus } from "../workflow/statuses.js";

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
 * dogfood WU003 case (a live external-service verification gap). Reused here
 * as the "external verification gaps" bucket for aiqt manage/final-review.
 */
const EXTERNAL_VERIFICATION_KEY_PREFIX = "checkpoint:";

function allWorkDone(state: StateModel): boolean {
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
  externalVerificationGaps: FindingView[];
  developmentComplete: boolean;
  productionReady: boolean;
}

/**
 * Shared classification core reused by aiqt manage, aiqt review --mode, and
 * the final-review.md export, so all three surfaces agree on exactly what
 * "development complete" and "production ready" mean (§8.1/§8.2/§8.6).
 *
 * developmentComplete: every work unit is done AND no unacknowledged blocking
 * finding remains -- acknowledgment fully exempts a finding from this check.
 *
 * productionReady: developmentComplete AND no blocking finding exists at all,
 * ignoring acknowledgment entirely -- an acknowledged finding still blocks
 * release, per §8.2's "Acknowledged findings remain visible and may still
 * block release."
 */
export function classifyFindings(
  _project: ProjectModel,
  state: StateModel,
  review: ReviewResult,
): FindingClassification {
  const acknowledgedRecords = getAcknowledgedFindings(state);
  const activeKeys = new Set(review.findings.map((f) => f.findingKey));

  const activeFindings: FindingView[] = review.findings.map((f) => ({
    ...f,
    acknowledged: isFindingAcknowledged(f.findingKey, acknowledgedRecords),
  }));

  const acknowledgedFindings: AcknowledgedFindingView[] = acknowledgedRecords.map((a) => ({
    ...a,
    stillActive: activeKeys.has(a.findingKey),
  }));

  const unacknowledgedBlockingFindings = activeFindings.filter(
    (f) => f.blocking && !f.acknowledged,
  );
  const blockingFindingsIgnoringAcknowledgment = activeFindings.filter((f) => f.blocking);
  const externalVerificationGaps = activeFindings.filter((f) =>
    f.findingKey.startsWith(EXTERNAL_VERIFICATION_KEY_PREFIX),
  );

  const developmentComplete = allWorkDone(state) && unacknowledgedBlockingFindings.length === 0;
  const productionReady =
    developmentComplete && blockingFindingsIgnoringAcknowledgment.length === 0;

  return {
    activeFindings,
    acknowledgedFindings,
    unacknowledgedBlockingFindings,
    blockingFindingsIgnoringAcknowledgment,
    externalVerificationGaps,
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

function collectCheckpointIssueBuckets(state: StateModel): {
  userActionRequired: string[];
  agentFixableIssues: string[];
} {
  const userActionRequired: string[] = [];
  const agentFixableIssues: string[] = [];
  for (const cp of state.checkpoints) {
    for (const issue of cp.issues) {
      if (issue.status !== "open") continue;
      const label = `${cp.workUnitId}: ${issue.title}`;
      if (issue.agentCanFix) {
        agentFixableIssues.push(label);
      } else {
        userActionRequired.push(label);
      }
    }
  }
  return { userActionRequired, agentFixableIssues };
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
  externalVerificationGaps: FindingView[];
  agentFixableIssues: string[];
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
  const { userActionRequired, agentFixableIssues } = collectCheckpointIssueBuckets(state);

  const blockingContextUserAction = classification.activeFindings
    .filter((f) => f.category === "context" && f.blocking && !f.acknowledged)
    .map((f) => f.message);

  const allUserActionRequired = [...blockingContextUserAction, ...userActionRequired];

  let recommendedCommand: string;
  let reason: string;
  if (classification.developmentComplete && classification.productionReady) {
    recommendedCommand = "aiqt export all";
    reason = "All work is done and no release blockers remain.";
  } else if (classification.developmentComplete && !classification.productionReady) {
    recommendedCommand = "aiqt review --mode release";
    reason = "All work units are done, but production-readiness blockers remain.";
  } else {
    recommendedCommand = review.nextRecommendedCommand;
    reason = `Development is not yet complete. Recommended next step: ${review.nextRecommendedCommand}.`;
  }

  return {
    projectStatus: state.projectStatus,
    developmentComplete: classification.developmentComplete,
    productionReady: classification.productionReady,
    recommendedCommand,
    reason,
    counts: workUnitCountsByStatus(state),
    activeFindings: classification.activeFindings,
    acknowledgedFindings: classification.acknowledgedFindings,
    userActionRequired: allUserActionRequired,
    externalVerificationGaps: classification.externalVerificationGaps,
    agentFixableIssues,
  };
}
