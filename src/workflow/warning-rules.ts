import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { ReviewFindingCandidate } from "./review-rules.js";

/**
 * M9 §11.1: keywords that suggest a work unit is late-stage/polish work
 * rather than core functionality. Matched case-insensitively against title
 * and objective.
 */
const LATE_STAGE_KEYWORDS: readonly string[] = [
  "i18n",
  "accessibility",
  "release",
  "hardening",
  "readiness",
  "polish",
  "content pass",
  "production",
];

function matchesLateStageKeyword(wu: WorkUnit): boolean {
  const text = `${wu.title} ${wu.objective}`.toLowerCase();
  return LATE_STAGE_KEYWORDS.some((keyword) => text.includes(keyword));
}

/**
 * §11.1 Suspicious late-stage readiness: warn (non-blocking) when a
 * late-stage-looking work unit is ready while other, non-late-stage work
 * units in the graph are not yet done.
 */
export function collectSuspiciousLateStageReadinessWarnings(
  state: StateModel,
): ReviewFindingCandidate[] {
  const workUnits = state.workGraph.workUnits;
  const lateStageReady = workUnits.filter(
    (wu) => wu.status === "ready" && matchesLateStageKeyword(wu),
  );
  if (lateStageReady.length === 0) return [];

  const earlierCoreWorkIncomplete = workUnits.some(
    (wu) => !matchesLateStageKeyword(wu) && wu.status !== "done",
  );
  if (!earlierCoreWorkIncomplete) return [];

  return lateStageReady.map((wu) => ({
    ruleKey: `warning.suspicious-late-stage-ready.${wu.id}`,
    findingKey: `workunit:${wu.id}:suspicious-late-stage-ready`,
    category: "graph" as const,
    severity: "medium" as const,
    blocking: false,
    title: "Late-stage work unit is ready while earlier core work is incomplete",
    message: `Work unit "${wu.id}" looks late-stage (title/objective matches a late-stage keyword) and is ready, while other non-late-stage work units are not yet done.`,
    relatedIds: [wu.id],
    suggestedAction:
      "Confirm sequencing: consider deferring this work unit until earlier core work is done.",
    nextRecommendedCommand: null,
  }));
}

/**
 * §11.2 Mixed inbound dependency types: warn (non-blocking) when a work unit
 * has both a blocking (blocks/requires) inbound dependency and an
 * informational relates_to inbound dependency, keyed by the relates_to
 * dependency id -- the same family as the original WU023/WU025 incident.
 */
export function collectMixedInboundDependencyWarnings(
  state: StateModel,
): ReviewFindingCandidate[] {
  const findings: ReviewFindingCandidate[] = [];
  for (const wu of state.workGraph.workUnits) {
    const incoming = state.workGraph.dependencies.filter((d) => d.toId === wu.id);
    const hasBlockingInbound = incoming.some(
      (d) => d.type === "blocks" || d.type === "requires",
    );
    if (!hasBlockingInbound) continue;

    const relatesToInbound = incoming.filter((d) => d.type === "relates_to");
    for (const dep of relatesToInbound) {
      findings.push({
        ruleKey: `warning.mixed-inbound-dependency.${dep.id}`,
        findingKey: `dependency:${dep.id}:mixed-inbound-dependency-type`,
        category: "graph",
        severity: "low",
        blocking: false,
        title: "Work unit has both blocking and relates_to inbound dependencies",
        message: `Work unit "${wu.id}" has a relates_to dependency "${dep.id}" alongside a blocking/requires inbound dependency.`,
        relatedIds: [wu.id, dep.id],
        suggestedAction:
          "Check whether the relates_to edge is actually a prerequisite and should be blocks/requires instead.",
        nextRecommendedCommand: null,
      });
    }
  }
  return findings;
}

/**
 * §11.3 Potential orphaned requirement fragment: a heuristic, non-blocking
 * warning. Flags a work unit that is the only one referencing a specific
 * requirement id (via agentContextRefs) when that requirement has more than
 * one acceptance criterion but the work unit's own scope has fewer entries
 * than that -- a rough signal the requirement may only be partially covered.
 * This is intentionally simple and must not become a semantic
 * requirement-coverage engine.
 */
export function collectOrphanedRequirementFragmentWarnings(
  project: ProjectModel,
  state: StateModel,
): ReviewFindingCandidate[] {
  const referencingUnitsByRequirement = new Map<string, WorkUnit[]>();
  for (const wu of state.workGraph.workUnits) {
    for (const ref of wu.agentContextRefs) {
      if (ref === "requirements") continue; // bare category ref, not a specific requirement
      const requirement = project.requirements.find((r) => r.id === ref);
      if (!requirement) continue;
      const list = referencingUnitsByRequirement.get(requirement.id) ?? [];
      list.push(wu);
      referencingUnitsByRequirement.set(requirement.id, list);
    }
  }

  const findings: ReviewFindingCandidate[] = [];
  for (const [requirementId, units] of referencingUnitsByRequirement) {
    if (units.length !== 1) continue; // another unit obviously covers the rest
    const requirement = project.requirements.find((r) => r.id === requirementId)!;
    const wu = units[0];
    if (
      requirement.acceptanceCriteria.length > 1 &&
      wu.scope.length < requirement.acceptanceCriteria.length
    ) {
      findings.push({
        ruleKey: `warning.orphaned-requirement-fragment.${wu.id}`,
        findingKey: `workunit:${wu.id}:possible-orphaned-requirement-fragment`,
        category: "graph",
        severity: "low",
        blocking: false,
        title: "Work unit may cover only part of a referenced requirement",
        message: `Work unit "${wu.id}" is the only work unit referencing requirement "${requirementId}" (${requirement.acceptanceCriteria.length} acceptance criteria), but its own scope has fewer entries than that, and no other work unit references this requirement.`,
        relatedIds: [wu.id, requirementId],
        suggestedAction:
          "Confirm the requirement is fully covered across the work graph, or add a follow-up work unit for the remainder.",
        nextRecommendedCommand: null,
      });
    }
  }
  return findings;
}

/**
 * M12 §8.3/§11: warn (non-blocking) when a work unit's stored status
 * ("ready" or "planned") no longer matches what its current blocking/requires
 * dependencies imply -- e.g. after a dependency type is changed but before
 * readiness is recalculated, or in any other drift scenario. Only "ready"
 * and "planned" are considered; done/in_progress/needs_review/cancelled/
 * replanned are terminal or active states this warning does not second-guess.
 */
export function collectStaleReadinessWarnings(state: StateModel): ReviewFindingCandidate[] {
  const workUnits = state.workGraph.workUnits;
  const statusById = new Map(workUnits.map((wu) => [wu.id, wu.status]));
  const findings: ReviewFindingCandidate[] = [];

  for (const wu of workUnits) {
    if (wu.status !== "ready" && wu.status !== "planned") continue;

    const incomingBlocking = state.workGraph.dependencies.filter(
      (d) => d.toId === wu.id && (d.type === "blocks" || d.type === "requires"),
    );
    const allSourcesDone = incomingBlocking.every((d) => statusById.get(d.fromId) === "done");
    const expected: "ready" | "planned" = allSourcesDone ? "ready" : "planned";
    if (expected === wu.status) continue;

    findings.push({
      ruleKey: `warning.stale-readiness.${wu.id}`,
      findingKey: `workunit:${wu.id}:stale-readiness`,
      category: "graph",
      severity: "medium",
      blocking: false,
      title: "Work unit readiness state is stale relative to its dependencies",
      message: `Work unit "${wu.id}" has status "${wu.status}", but its blocking/requires dependencies imply it should be "${expected}".`,
      relatedIds: [wu.id],
      suggestedAction: "Run aiqt graph validate or aiqt graph repair --dry-run to investigate.",
      nextRecommendedCommand: "aiqt graph validate",
    });
  }

  return findings;
}

/**
 * M12 §8.3/§11: the DEP-031-style dogfood pattern -- a relates_to dependency
 * landing on a late-stage-looking work unit (reusing the same
 * LATE_STAGE_KEYWORDS heuristic) whose source work unit is not yet done. This
 * often means the relates_to edge is actually an unmodeled blocking
 * prerequisite.
 */
export function collectLateStageRelatesToWarnings(state: StateModel): ReviewFindingCandidate[] {
  const workUnitById = new Map(state.workGraph.workUnits.map((wu) => [wu.id, wu]));
  const findings: ReviewFindingCandidate[] = [];

  for (const dep of state.workGraph.dependencies) {
    if (dep.type !== "relates_to") continue;
    const target = workUnitById.get(dep.toId);
    const source = workUnitById.get(dep.fromId);
    if (!target || !source) continue;
    if (!matchesLateStageKeyword(target)) continue;
    if (source.status === "done") continue;

    findings.push({
      ruleKey: `warning.late-stage-relates-to.${dep.id}`,
      findingKey: `dependency:${dep.id}:late-stage-relates-to`,
      category: "graph",
      severity: "medium",
      blocking: false,
      title: "Late-stage work unit has an unresolved relates_to dependency",
      message: `Dependency "${dep.id}" is relates_to from "${dep.fromId}" (not done) into late-stage work unit "${dep.toId}". This may actually be an unmodeled blocking prerequisite.`,
      relatedIds: [dep.id, dep.fromId, dep.toId],
      suggestedAction: `Consider aiqt dependency update ${dep.id} --type blocks if "${dep.fromId}" is really a prerequisite.`,
      nextRecommendedCommand: null,
    });
  }

  return findings;
}

/** M9 §11/M12 §8.3: all lightweight, non-blocking graph and plan-quality warnings. */
export function collectGraphAndPlanQualityWarnings(
  project: ProjectModel,
  state: StateModel,
): ReviewFindingCandidate[] {
  return [
    ...collectSuspiciousLateStageReadinessWarnings(state),
    ...collectMixedInboundDependencyWarnings(state),
    ...collectOrphanedRequirementFragmentWarnings(project, state),
    ...collectStaleReadinessWarnings(state),
    ...collectLateStageRelatesToWarnings(state),
  ];
}
