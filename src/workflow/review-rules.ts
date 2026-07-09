import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type {
  ReviewFindingCategory,
  ReviewFindingSeverity,
} from "../schema/review-finding.schema.js";
import { isPlanningContextReady } from "./planning-readiness.js";

/**
 * A finding before FIND-### assignment. `ruleKey` is a stable, internal
 * tie-breaker used only for deterministic sorting; it is never exposed on
 * the final ReviewFinding record.
 */
export interface ReviewFindingCandidate {
  ruleKey: string;
  category: ReviewFindingCategory;
  severity: ReviewFindingSeverity;
  blocking: boolean;
  title: string;
  message: string;
  relatedIds: string[];
  suggestedAction: string;
  nextRecommendedCommand: string | null;
}

const ACTIONABLE_STATUSES = new Set(["ready", "in_progress", "needs_review", "done"]);

// ---------------------------------------------------------------------------
// 8.1 Canonical state integrity findings (category: integrity)
// ---------------------------------------------------------------------------

export function collectIntegrityFindings(
  _project: ProjectModel,
  state: StateModel,
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  const milestoneIds = new Set(state.workGraph.milestones.map((m) => m.id));
  const workUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));

  for (const wu of state.workGraph.workUnits) {
    if (!milestoneIds.has(wu.milestoneId)) {
      findings.push({
        ruleKey: `integrity.broken-milestone.${wu.id}`,
        category: "integrity",
        severity: "critical",
        blocking: true,
        title: "Work unit references an unknown milestone",
        message: `Work unit "${wu.id}" references milestoneId "${wu.milestoneId}", which does not exist.`,
        relatedIds: [wu.id, wu.milestoneId],
        suggestedAction: "Repair the work graph in .aiqt/state.json.",
        nextRecommendedCommand: "aiqt review",
      });
    }
  }

  for (const dep of state.workGraph.dependencies) {
    const unknownFrom = !workUnitIds.has(dep.fromId);
    const unknownTo = !workUnitIds.has(dep.toId);
    if (unknownFrom || unknownTo) {
      findings.push({
        ruleKey: `integrity.broken-dependency.${dep.id}`,
        category: "integrity",
        severity: "critical",
        blocking: true,
        title: "Dependency references an unknown work unit",
        message: `Dependency "${dep.id}" references ${unknownFrom ? `unknown fromId "${dep.fromId}"` : ""}${unknownFrom && unknownTo ? " and " : ""}${unknownTo ? `unknown toId "${dep.toId}"` : ""}.`,
        relatedIds: [dep.id, dep.fromId, dep.toId],
        suggestedAction: "Repair the work graph in .aiqt/state.json.",
        nextRecommendedCommand: "aiqt review",
      });
    }
  }

  if (state.currentWorkUnitId !== null && !workUnitIds.has(state.currentWorkUnitId)) {
    findings.push({
      ruleKey: "integrity.missing-current-work-unit",
      category: "integrity",
      severity: "critical",
      blocking: true,
      title: "currentWorkUnitId references a missing work unit",
      message: `state.currentWorkUnitId "${state.currentWorkUnitId}" does not reference an existing work unit.`,
      relatedIds: [state.currentWorkUnitId],
      suggestedAction: "Repair state.currentWorkUnitId in .aiqt/state.json.",
      nextRecommendedCommand: "aiqt review",
    });
  }

  if (state.lastAgentPacket && !workUnitIds.has(state.lastAgentPacket.workUnitId)) {
    findings.push({
      ruleKey: "integrity.missing-packet-work-unit",
      category: "integrity",
      severity: "high",
      blocking: true,
      title: "lastAgentPacket references a missing work unit",
      message: `state.lastAgentPacket.workUnitId "${state.lastAgentPacket.workUnitId}" does not reference an existing work unit.`,
      relatedIds: [state.lastAgentPacket.id, state.lastAgentPacket.workUnitId],
      suggestedAction: "Repair state.lastAgentPacket in .aiqt/state.json.",
      nextRecommendedCommand: "aiqt review",
    });
  }

  for (const checkpoint of state.checkpoints) {
    if (!workUnitIds.has(checkpoint.workUnitId)) {
      findings.push({
        ruleKey: `integrity.checkpoint-missing-work-unit.${checkpoint.id}`,
        category: "integrity",
        severity: "high",
        blocking: true,
        title: "Checkpoint references a missing work unit",
        message: `Checkpoint "${checkpoint.id}" references workUnitId "${checkpoint.workUnitId}", which does not exist.`,
        relatedIds: [checkpoint.id, checkpoint.workUnitId],
        suggestedAction: "Repair state.checkpoints in .aiqt/state.json.",
        nextRecommendedCommand: "aiqt review",
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 8.2 Workflow-position findings (category: workflow) — always non-blocking.
// ---------------------------------------------------------------------------

export function collectWorkflowFindings(
  project: ProjectModel,
  state: StateModel,
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  const hasWorkGraph = state.workGraph.milestones.length > 0;
  const workUnits = state.workGraph.workUnits;

  if (!hasWorkGraph) {
    const ready = isPlanningContextReady(project);
    findings.push({
      ruleKey: "workflow.empty-graph",
      category: "workflow",
      severity: "medium",
      blocking: false,
      title: ready
        ? "Project context is ready, but no work graph exists yet"
        : "Project context is incomplete",
      message: ready
        ? "Planning context is sufficient. Run aiqt plan to generate the work graph."
        : "The project is initialized but not ready for planning.",
      relatedIds: [project.project.id],
      suggestedAction: ready
        ? "Run aiqt plan to generate the work graph."
        : "Run aiqt update to capture project context.",
      nextRecommendedCommand: ready ? "aiqt plan" : "aiqt update",
    });
  }

  if (state.currentWorkUnitId !== null) {
    const wu = workUnits.find((w) => w.id === state.currentWorkUnitId);
    if (wu?.status === "in_progress") {
      findings.push({
        ruleKey: "workflow.current-in-progress",
        category: "workflow",
        severity: "medium",
        blocking: false,
        title: "A work unit is in progress",
        message: `Work unit "${wu.id}" is in progress and awaiting checkpoint capture.`,
        relatedIds: [wu.id],
        suggestedAction: "Run aiqt checkpoint to capture the execution result.",
        nextRecommendedCommand: "aiqt checkpoint",
      });
    }
  }

  const needsReviewUnits = workUnits.filter((wu) => wu.status === "needs_review");
  if (needsReviewUnits.length > 0) {
    findings.push({
      ruleKey: "workflow.needs-review",
      category: "workflow",
      severity: "high",
      blocking: false,
      title: "One or more work units need review",
      message: `${needsReviewUnits.length} work unit(s) have status needs_review.`,
      relatedIds: needsReviewUnits.map((wu) => wu.id),
      suggestedAction: "Resolve needs_review work units outside AIQT, then continue.",
      nextRecommendedCommand: "aiqt review",
    });
  }

  const hasReady = workUnits.some((wu) => wu.status === "ready");
  if (hasReady && state.currentWorkUnitId === null) {
    findings.push({
      ruleKey: "workflow.ready-available",
      category: "workflow",
      severity: "info",
      blocking: false,
      title: "A ready work unit is available",
      message: "At least one ready work unit exists and no work unit is currently active.",
      relatedIds: [project.project.id],
      suggestedAction: "Run aiqt next to select the next ready work unit.",
      nextRecommendedCommand: "aiqt next",
    });
  }

  if (workUnits.length > 0 && workUnits.every((wu) => wu.status === "done")) {
    findings.push({
      ruleKey: "workflow.all-done",
      category: "workflow",
      severity: "info",
      blocking: false,
      title: "All work units are done",
      message: "Every work unit in the work graph has status done.",
      relatedIds: [project.project.id],
      suggestedAction: "Run aiqt export status-report to generate a summary.",
      nextRecommendedCommand: "aiqt export status-report",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 8.3 Context findings (project-level, category: context)
// ---------------------------------------------------------------------------

export function collectContextFindings(
  project: ProjectModel,
  _state: StateModel,
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  const projectId = project.project.id;

  if (project.project.objective.trim() === "") {
    findings.push({
      ruleKey: "context.empty-objective",
      category: "context",
      severity: "medium",
      blocking: false,
      title: "Project objective is empty",
      message: "No project objective has been recorded.",
      relatedIds: [projectId],
      suggestedAction: "Add an objective through aiqt update.",
      nextRecommendedCommand: "aiqt update",
    });
  }

  if (project.project.targetUsers.length === 0) {
    findings.push({
      ruleKey: "context.no-target-users",
      category: "context",
      severity: "medium",
      blocking: false,
      title: "No target users recorded",
      message: "Planning quality improves when at least one target user is recorded.",
      relatedIds: [projectId],
      suggestedAction: "Add target users through aiqt update.",
      nextRecommendedCommand: "aiqt update",
    });
  }

  const hasAnyStructuralContext =
    project.requirements.length > 0 ||
    project.context.constraints.length > 0 ||
    project.context.technologyPreferences.length > 0 ||
    project.context.businessRules.length > 0 ||
    project.context.architectureNotes.length > 0;
  if (!hasAnyStructuralContext) {
    findings.push({
      ruleKey: "context.no-structural-context",
      category: "context",
      severity: "medium",
      blocking: false,
      title: "No requirements, constraints, or architecture context recorded",
      message:
        "No requirements, constraints, technology preferences, business rules, or architecture notes exist.",
      relatedIds: [projectId],
      suggestedAction: "Add durable context through aiqt update.",
      nextRecommendedCommand: "aiqt update",
    });
  }

  for (const q of project.openQuestions) {
    if (q.status === "open" && q.impact === "blocking") {
      findings.push({
        ruleKey: `context.blocking-open-question.${q.id}`,
        category: "context",
        severity: "high",
        blocking: true,
        title: "Blocking open question is unresolved",
        message: `Open question "${q.id}" has impact = blocking and status = open.`,
        relatedIds: [q.id],
        suggestedAction: "Resolve the open question through aiqt update.",
        nextRecommendedCommand: "aiqt update",
      });
    }
  }

  for (const req of project.requirements) {
    if (req.status === "accepted" && req.acceptanceCriteria.length === 0) {
      findings.push({
        ruleKey: `context.accepted-requirement-no-criteria.${req.id}`,
        category: "context",
        severity: "high",
        blocking: true,
        title: "Accepted requirement has no acceptance criteria",
        message: `Requirement "${req.id}" is accepted but has no acceptance criteria.`,
        relatedIds: [req.id],
        suggestedAction: "Add acceptance criteria through aiqt update.",
        nextRecommendedCommand: "aiqt update",
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 8.3 Work-unit quality findings (category: quality)
// ---------------------------------------------------------------------------

export function collectQualityFindings(
  _project: ProjectModel,
  state: StateModel,
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];

  for (const wu of state.workGraph.workUnits) {
    const actionable = ACTIONABLE_STATUSES.has(wu.status);
    const planned = wu.status === "planned";
    if (!actionable && !planned) continue;

    const severity: ReviewFindingSeverity = actionable ? "high" : "medium";
    const blocking = actionable;

    if (wu.validationCommands.length === 0) {
      findings.push({
        ruleKey: `quality.no-validation-commands.${wu.id}`,
        category: "quality",
        severity,
        blocking,
        title: "Work unit has no validation commands",
        message: `Work unit "${wu.id}" (status ${wu.status}) has no validationCommands.`,
        relatedIds: [wu.id],
        suggestedAction: "Add validationCommands to the work unit.",
        nextRecommendedCommand: actionable ? "aiqt review" : null,
      });
    }

    if (wu.acceptanceCriteria.length === 0) {
      findings.push({
        ruleKey: `quality.no-acceptance-criteria.${wu.id}`,
        category: "quality",
        severity,
        blocking,
        title: "Work unit has no acceptance criteria",
        message: `Work unit "${wu.id}" (status ${wu.status}) has no acceptanceCriteria.`,
        relatedIds: [wu.id],
        suggestedAction: "Add acceptanceCriteria to the work unit.",
        nextRecommendedCommand: actionable ? "aiqt review" : null,
      });
    }

    if (actionable) {
      if (wu.scope.length === 0 || wu.outOfScope.length === 0) {
        findings.push({
          ruleKey: `quality.empty-scope.${wu.id}`,
          category: "quality",
          severity: "high",
          blocking: true,
          title: "Work unit has empty scope or outOfScope",
          message: `Work unit "${wu.id}" (status ${wu.status}) has an empty scope or outOfScope list.`,
          relatedIds: [wu.id],
          suggestedAction: "Add scope and outOfScope entries to the work unit.",
          nextRecommendedCommand: "aiqt review",
        });
      }
    } else {
      if (
        wu.scope.length === 0 ||
        wu.outOfScope.length === 0 ||
        wu.suggestedFiles.length === 0
      ) {
        findings.push({
          ruleKey: `quality.vague-scope.${wu.id}`,
          category: "quality",
          severity: "medium",
          blocking: false,
          title: "Planned work unit has vague or empty scope",
          message: `Work unit "${wu.id}" (status planned) has an empty scope, outOfScope, or suggestedFiles list.`,
          relatedIds: [wu.id],
          suggestedAction: "Add scope, outOfScope, and suggestedFiles before this unit becomes ready.",
          nextRecommendedCommand: null,
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 8.4 Checkpoint and execution findings (category: checkpoint)
// ---------------------------------------------------------------------------

export function collectCheckpointFindings(
  _project: ProjectModel,
  state: StateModel,
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  const checkpointsByWorkUnit = new Map<string, typeof state.checkpoints>();
  for (const cp of state.checkpoints) {
    const list = checkpointsByWorkUnit.get(cp.workUnitId) ?? [];
    list.push(cp);
    checkpointsByWorkUnit.set(cp.workUnitId, list);
  }

  for (const wu of state.workGraph.workUnits) {
    const wuCheckpoints = checkpointsByWorkUnit.get(wu.id) ?? [];

    if (wu.status === "done" && wuCheckpoints.length === 0) {
      findings.push({
        ruleKey: `checkpoint.done-no-checkpoint.${wu.id}`,
        category: "checkpoint",
        severity: "high",
        blocking: true,
        title: "Done work unit has no checkpoint record",
        message: `Work unit "${wu.id}" is done but has no checkpoint record.`,
        relatedIds: [wu.id],
        suggestedAction: "Investigate how the work unit was marked done without a checkpoint.",
        nextRecommendedCommand: "aiqt review",
      });
    }

    if (wu.status === "needs_review") {
      const hasOpenHighCriticalIssue = wuCheckpoints.some((cp) =>
        cp.issues.some(
          (issue) =>
            issue.status === "open" &&
            (issue.severity === "high" || issue.severity === "critical"),
        ),
      );
      if (hasOpenHighCriticalIssue) {
        findings.push({
          ruleKey: `checkpoint.needs-review-open-issue.${wu.id}`,
          category: "checkpoint",
          severity: "high",
          blocking: false,
          title: "needs_review work unit has an open high/critical checkpoint issue",
          message: `Work unit "${wu.id}" has an open high or critical severity checkpoint issue.`,
          relatedIds: [wu.id],
          suggestedAction: "Resolve the checkpoint issue outside AIQT.",
          nextRecommendedCommand: "aiqt review",
        });
      }
    }

    if (wu.status === "done" && wuCheckpoints.length > 0) {
      const latest = wuCheckpoints[wuCheckpoints.length - 1];
      if (latest.validationResult === "failed" || latest.validationResult === "partial") {
        findings.push({
          ruleKey: `checkpoint.done-validation-not-passed.${wu.id}`,
          category: "checkpoint",
          severity: "high",
          blocking: true,
          title: "Done work unit's latest checkpoint did not pass validation",
          message: `Work unit "${wu.id}" is done but its latest checkpoint has validationResult "${latest.validationResult}".`,
          relatedIds: [wu.id, latest.id],
          suggestedAction: "Investigate the validation result recorded on this checkpoint.",
          nextRecommendedCommand: "aiqt review",
        });
      }
      if (
        latest.acceptanceCriteriaResult === "failed" ||
        latest.acceptanceCriteriaResult === "partial"
      ) {
        findings.push({
          ruleKey: `checkpoint.done-acceptance-not-passed.${wu.id}`,
          category: "checkpoint",
          severity: "high",
          blocking: true,
          title: "Done work unit's latest checkpoint did not pass acceptance criteria",
          message: `Work unit "${wu.id}" is done but its latest checkpoint has acceptanceCriteriaResult "${latest.acceptanceCriteriaResult}".`,
          relatedIds: [wu.id, latest.id],
          suggestedAction: "Investigate the acceptance criteria result recorded on this checkpoint.",
          nextRecommendedCommand: "aiqt review",
        });
      }
    }
  }

  if (
    state.lastAgentPacket &&
    state.currentWorkUnitId === null &&
    !state.checkpoints.some((cp) => cp.packetId === state.lastAgentPacket!.id)
  ) {
    findings.push({
      ruleKey: "checkpoint.packet-no-checkpoint",
      category: "checkpoint",
      severity: "medium",
      blocking: false,
      title: "Last agent packet has no referencing checkpoint",
      message: `state.lastAgentPacket "${state.lastAgentPacket.id}" is not referenced by any checkpoint, and no work unit is currently in progress.`,
      relatedIds: [state.lastAgentPacket.id],
      suggestedAction: "Investigate why no checkpoint was captured for the last packet.",
      nextRecommendedCommand: null,
    });
  }

  return findings;
}
