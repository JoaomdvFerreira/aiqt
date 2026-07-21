import type { ScopeClaim } from "../schema/evidence.schema.js";
import type {
  ProjectIssue,
  ProjectIssueTransition,
  ProjectIssueTransitionReason,
} from "../schema/project-issue.schema.js";
import { findProjectIssueByKey } from "../services/project-issue-service.js";

/** M22 §6.4: exactly one initial lifecycle -- never both. */
export type FindingRoute = "checkpoint_issue" | "project_issue";

/**
 * M22 §6.3: scope claims that, on their own, always trigger the
 * ProjectIssue route regardless of any other signal.
 */
const PROJECT_LEVEL_SCOPES: ReadonlySet<ScopeClaim> = new Set([
  "cross_work_unit",
  "milestone",
  "project",
  "release",
  "architecture",
  "security",
  "legal_compliance",
  "governance",
  "external_setup",
]);

export interface RoutingSignals {
  hasValidCheckpoint: boolean;
  scopeClaim: ScopeClaim;
  spansMultipleCheckpoints: boolean;
  spansMultipleWorkUnitsOrMilestones: boolean;
  /** True only when remediation is possible via replacement execution, checkpoint amendment, or replacement evidence for the SAME work unit (M22 §6.2). */
  remediableWithinExecution: boolean;
}

/**
 * M22 §6.2/§6.3: the exact F-06 decision. CheckpointIssue is chosen only
 * when every §6.2 condition holds; any single §6.3 trigger forces
 * ProjectIssue. There is no third outcome and no dual-creation path here --
 * callers apply exactly one route.
 */
export function decideFindingRoute(signals: RoutingSignals): FindingRoute {
  if (!signals.hasValidCheckpoint) return "project_issue";
  if (signals.spansMultipleCheckpoints) return "project_issue";
  if (signals.spansMultipleWorkUnitsOrMilestones) return "project_issue";
  if (PROJECT_LEVEL_SCOPES.has(signals.scopeClaim)) return "project_issue";
  if (!signals.remediableWithinExecution) return "project_issue";
  return "checkpoint_issue";
}

export interface RoutingResolution {
  route: FindingRoute;
  issueKey: string;
  /** False when an existing CheckpointIssue or ProjectIssue already owns this canonical key -- the caller must link, not create. */
  isNewRecord: boolean;
}

/**
 * M22 §6.1 steps 4-5: search existing records by canonical key BEFORE
 * applying the route decision. An existing record's lifecycle always wins
 * -- this is what makes repeated application of the same logical finding
 * idempotent and prevents the no-dual-creation rule from ever being
 * violated by a second normalization pass.
 */
export function resolveFindingRoute(
  signals: RoutingSignals,
  issueKey: string,
  existingProjectIssueKeys: ReadonlySet<string>,
  existingCheckpointIssueKeys: ReadonlySet<string>,
): RoutingResolution {
  if (existingProjectIssueKeys.has(issueKey)) {
    return { route: "project_issue", issueKey, isNewRecord: false };
  }
  if (existingCheckpointIssueKeys.has(issueKey)) {
    return { route: "checkpoint_issue", issueKey, isNewRecord: false };
  }
  return { route: decideFindingRoute(signals), issueKey, isNewRecord: true };
}

export interface ProjectIssueSeedFields {
  title: string;
  description: string;
  severity: ProjectIssue["severity"];
  sourceType: ProjectIssue["sourceType"];
  sourceRefs: string[];
  affectedWorkUnitIds: string[];
  affectedMilestoneIds: string[];
  evidenceIds: string[];
  checkpointRefs: string[];
  ownerRef: string | null;
  promotionRefs: string[];
}

export interface ApplyTransitionParams {
  issueKey: string;
  checkpointId: string;
  checkpointIssueRef: string;
  reason: ProjectIssueTransitionReason;
  evidenceIds: readonly string[];
  existingProjectIssues: readonly ProjectIssue[];
  existingTransitions: readonly ProjectIssueTransition[];
  timestamp: string;
  nextProjectIssueId: string;
  nextTransitionId: string;
  projectIssueSeedFields: ProjectIssueSeedFields;
}

export interface ApplyTransitionResult {
  changed: boolean;
  projectIssue: ProjectIssue;
  /** Null on an idempotent replay -- no second transition is ever created for the same issueKey. */
  transition: ProjectIssueTransition | null;
}

/**
 * M22 §5.6/§6.4: explicit, append-only CheckpointIssue -> ProjectIssue
 * transition. The original CheckpointIssue is never touched by this
 * function (callers pass only its reference, not the record itself); the
 * canonical `issueKey` is preserved unchanged on both the transition and
 * the (new-or-existing) ProjectIssue, which is exactly what keeps
 * promotion-to-repair-work-unit deduplication (keyed by issueKey in
 * src/services/issue-service.ts) working across the transition.
 */
export function applyCheckpointToProjectIssueTransition(
  params: ApplyTransitionParams,
): ApplyTransitionResult {
  const existingTransition = params.existingTransitions.find((t) => t.issueKey === params.issueKey);
  const existingProjectIssue = findProjectIssueByKey(params.issueKey, params.existingProjectIssues);

  if (existingTransition) {
    // Idempotent replay: only one transition to the same ProjectIssue ever
    // exists for the same canonical condition (M22 §5.6).
    return {
      changed: false,
      projectIssue: existingProjectIssue ?? buildProjectIssue(params, existingTransition.to.projectIssueId),
      transition: null,
    };
  }

  const projectIssue = existingProjectIssue ?? buildProjectIssue(params, params.nextProjectIssueId);

  const transition: ProjectIssueTransition = {
    transitionId: params.nextTransitionId,
    issueKey: params.issueKey,
    from: {
      lifecycle: "checkpoint_issue",
      checkpointId: params.checkpointId,
      checkpointIssueRef: params.checkpointIssueRef,
    },
    to: { lifecycle: "project_issue", projectIssueId: projectIssue.projectIssueId },
    reason: params.reason,
    evidenceIds: [...params.evidenceIds],
    createdAt: params.timestamp,
  };

  return { changed: true, projectIssue, transition };
}

export interface ResolveOrCreateProjectIssueParams {
  issueKey: string;
  existingProjectIssues: readonly ProjectIssue[];
  nextProjectIssueId: string;
  timestamp: string;
  projectIssueSeedFields: ProjectIssueSeedFields;
}

export interface ResolveOrCreateProjectIssueResult {
  changed: boolean;
  projectIssue: ProjectIssue;
}

/**
 * M23-WU06: `applyCheckpointToProjectIssueTransition` always requires a
 * `checkpointId`/`checkpointIssueRef` -- there was previously no path to
 * create or link a standalone ProjectIssue with no originating checkpoint
 * (e.g. a finding imported with no checkpoint binding at all, or an
 * explicitly project-scoped finding). This is a legitimate additive
 * extension of the same M22-owned routing module, not a duplicate
 * algorithm: it reuses `findProjectIssueByKey` for the link case and only
 * constructs a new record (with no transition, since there is nothing to
 * transition from) when genuinely new.
 */
export function resolveOrCreateProjectIssue(
  params: ResolveOrCreateProjectIssueParams,
): ResolveOrCreateProjectIssueResult {
  const existing = findProjectIssueByKey(params.issueKey, params.existingProjectIssues);
  if (existing) {
    return { changed: false, projectIssue: existing };
  }
  const projectIssue: ProjectIssue = {
    projectIssueId: params.nextProjectIssueId,
    issueKey: params.issueKey,
    ...params.projectIssueSeedFields,
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };
  return { changed: true, projectIssue };
}

function buildProjectIssue(params: ApplyTransitionParams, projectIssueId: string): ProjectIssue {
  return {
    projectIssueId,
    issueKey: params.issueKey,
    ...params.projectIssueSeedFields,
    createdAt: params.timestamp,
    updatedAt: params.timestamp,
  };
}
