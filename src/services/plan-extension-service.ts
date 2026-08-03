import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type { Issue } from "../core/output/issue.js";
import { formatId, nextId, parseIdNumber } from "../state/ids.js";
import { findCycle } from "../workflow/dependency-graph.js";
import { recalculateReadinessAfterDependencyUpdate } from "../workflow/dependency-update-transition.js";
import { recalculateMilestoneStatuses } from "../workflow/checkpoint-status-transitions.js";
import { validateIsolatedAssignmentKeyUniqueness } from "../workflow/workspace-assignment.js";
import { findDuplicate } from "./planning-service.js";
import { applyWorkflowAssessmentToState } from "./workflow-assessment-persistence.js";
import type { PlanExtensionInput, PlanAppendInput } from "../schema/plan-extension-input.schema.js";
import type { ProjectModel } from "../schema/project.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";

const DEFAULT_ASSESSMENT_PROJECT: ProjectModel = {
  version: "1.0.0",
  project: {
    id: "PROJECT-001",
    name: "Project",
    objective: "Maintain the work graph.",
    targetUsers: ["maintainers"],
    preferredAgent: null,
    existingRepositoryPath: null,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  context: {
    constraints: ["Use canonical state."],
    nonGoals: [],
    technologyPreferences: [],
    businessRules: [],
    architectureNotes: [],
  },
  requirements: [],
  decisions: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  quality: {
    acceptanceCriteriaRequired: true,
    validationRequiredBeforeDone: true,
    preferredValidationCommands: [],
  },
};

/**
 * M17/M17-RC1: incremental work-graph mutation over an existing, non-empty
 * graph. AIQT never re-plans an existing graph through ordinary `aiqt plan`
 * -- this module is the one official, transactional path for the two
 * generic operations `aiqt plan --extend` supports:
 *
 *  - append: add milestones/work units/dependencies without touching any
 *    existing record;
 *  - refine: replace one eligible not-started-work work unit with a more
 *    detailed replacement subgraph, preserving it as "replanned" for audit
 *    history and rewiring its boundary dependencies onto the replacement.
 *
 * Both share one candidate-state construction and atomic-persistence model:
 * every function here is pure (throws AiqtError on validation failure, or
 * returns a full candidate StateModel) and never performs I/O itself.
 */

function extendIssue(id: string, blocked: boolean, message: string): Issue {
  return {
    id,
    severity: blocked ? "high" : "critical",
    area: blocked ? "workflow" : "input",
    message,
    agentCanFix: false,
  };
}

/** Blocked (exit 2): structurally valid request, rejected by workflow position or target history. */
function extendBlockedError(id: string, message: string): AiqtError {
  return new AiqtError(message, ExitCode.WorkflowBlocked, extendIssue(id, true, message));
}

/** Invalid (exit 3): malformed/inconsistent input, reference, or graph structure. */
function extendInvalidError(id: string, message: string): AiqtError {
  return new AiqtError(message, ExitCode.InvalidInput, extendIssue(id, false, message));
}

const ELIGIBLE_REFINEMENT_STATUSES: ReadonlySet<WorkUnitStatus> = new Set(["ready", "planned"]);

/** Locate the named refinement target in canonical state, or null if unknown. */
export function findTargetWorkUnit(state: StateModel, targetWorkUnitId: string): WorkUnit | null {
  return state.workGraph.workUnits.find((wu) => wu.id === targetWorkUnitId) ?? null;
}

/**
 * Eligibility gate for `--refine-work-unit`. Status-based ineligibility
 * (in_progress/needs_review/done/replanned/cancelled) and history-based
 * ineligibility (checkpoint, active packet, current work unit, already-
 * refined) are reported with distinct stable error codes, but both map to
 * the same blocked/exit-2 workflow-position outcome. "blocked" in the
 * eligible-status sense means blocked by an unsatisfied dependency, which
 * this engine represents as ordinary "planned" status, not a separate value.
 */
export function checkTargetEligibility(
  state: StateModel,
  workUnit: WorkUnit,
): { eligible: true } | { eligible: false; code: string; message: string } {
  if (!ELIGIBLE_REFINEMENT_STATUSES.has(workUnit.status)) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-TARGET-INELIGIBLE",
      message: `Work unit "${workUnit.id}" has status "${workUnit.status}" and cannot be targeted by --refine-work-unit.`,
    };
  }
  if (workUnit.replacedByWorkUnitIds && workUnit.replacedByWorkUnitIds.length > 0) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-TARGET-INELIGIBLE",
      message: `Work unit "${workUnit.id}" already has replacement metadata recorded.`,
    };
  }
  if (state.currentWorkUnitId === workUnit.id) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-TARGET-HAS-HISTORY",
      message: `Work unit "${workUnit.id}" is the current in-progress work unit and cannot be refined.`,
    };
  }
  if (state.checkpoints.some((c) => c.workUnitId === workUnit.id)) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-TARGET-HAS-HISTORY",
      message: `Work unit "${workUnit.id}" already has a checkpoint recorded and cannot be refined.`,
    };
  }
  if (state.lastAgentPacket?.workUnitId === workUnit.id) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-TARGET-HAS-HISTORY",
      message: `Work unit "${workUnit.id}" has an agent packet recorded and cannot be refined.`,
    };
  }
  return { eligible: true };
}

function allocateSequentialIds(
  prefix: string,
  existingIds: readonly string[],
  count: number,
  separator: string,
): string[] {
  if (count === 0) return [];
  const first = nextId(prefix, existingIds, separator);
  const firstNumber = parseIdNumber(prefix, first, separator)!;
  return Array.from({ length: count }, (_, i) => formatId(prefix, firstNumber + i, separator));
}

/** A shared, order-stable DEP-### id allocator over a growing working set. */
function makeDependencyIdAllocator(existingDependencyIds: readonly string[]) {
  let workingIds = [...existingDependencyIds];
  return function allocateDependencyId(): string {
    const id = nextId("DEP", workingIds, "-");
    workingIds = [...workingIds, id];
    return id;
  };
}

/** Freeze any milestone that was already "done" back to "done", regardless of newly added children. Neither operation may modify a completed milestone. */
function protectCompletedMilestones(
  originalMilestones: readonly Milestone[],
  candidateMilestones: readonly Milestone[],
): Milestone[] {
  const doneIds = new Set(originalMilestones.filter((m) => m.status === "done").map((m) => m.id));
  return candidateMilestones.map((m) => (doneIds.has(m.id) ? { ...m, status: "done" as const } : m));
}

// ---------------------------------------------------------------------------
// Append: add milestones/work units/dependencies without targeting a work unit.
// ---------------------------------------------------------------------------

export interface PlanAppendOutcome {
  /** The full candidate state, ready to persist verbatim (or discard for --preview). */
  state: StateModel;
  addedMilestoneIds: string[];
  addedWorkUnitIds: string[];
  addedDependencyIds: string[];
  /** Always 0: append never touches a completed work unit. */
  completedWorkUnitsModified: 0;
  /** Always 0: append never touches a completed milestone. */
  completedMilestonesModified: 0;
  /** Always 0: a non-zero value would already have thrown PLAN-EXTEND-CYCLE. */
  cyclesIntroduced: 0;
  nextRecommendedCommand: string;
}

/**
 * Build the full candidate state for an append operation. New milestone/
 * work-unit client keys and existing canonical IDs are both accepted
 * wherever a milestone or work unit is referenced (milestoneClientKey on a
 * new work unit, fromClientKey/toClientKey on a new dependency), so a single
 * payload shape supports every append scenario the spec requires: a new
 * milestone, new work under an existing milestone, and dependency-only
 * changes wiring new and/or existing work together.
 */
export function buildPlanAppend(params: {
  project?: ProjectModel;
  state: StateModel;
  input: PlanAppendInput;
  timestamp: string;
}): PlanAppendOutcome {
  const { state, input, timestamp } = params;
  const project = params.project ?? DEFAULT_ASSESSMENT_PROJECT;

  const dupMilestone = findDuplicate(input.milestones, (m) => m.clientKey);
  if (dupMilestone) {
    throw extendInvalidError(
      "PLAN-EXTEND-DUPLICATE-KEY",
      `Duplicate milestone clientKey "${dupMilestone.clientKey}" in append input.`,
    );
  }
  const dupWorkUnit = findDuplicate(input.workUnits, (wu) => wu.clientKey);
  if (dupWorkUnit) {
    throw extendInvalidError(
      "PLAN-EXTEND-DUPLICATE-KEY",
      `Duplicate work unit clientKey "${dupWorkUnit.clientKey}" in append input.`,
    );
  }

  const existingMilestoneIds = new Set(state.workGraph.milestones.map((m) => m.id));
  const existingWorkUnitIds = new Set(state.workGraph.workUnits.map((wu) => wu.id));

  const newMilestoneClientKeys = new Set(input.milestones.map((m) => m.clientKey));

  const newMilestoneIds = allocateSequentialIds(
    "M",
    state.workGraph.milestones.map((m) => m.id),
    input.milestones.length,
    "",
  );
  const newWorkUnitIds = allocateSequentialIds(
    "WU",
    state.workGraph.workUnits.map((wu) => wu.id),
    input.workUnits.length,
    "",
  );
  const milestoneIdByClientKey = new Map(input.milestones.map((m, i) => [m.clientKey, newMilestoneIds[i]]));
  const workUnitIdByClientKey = new Map(input.workUnits.map((wu, i) => [wu.clientKey, newWorkUnitIds[i]]));

  /** A milestone reference may be a new clientKey or an existing canonical id. */
  function resolveMilestoneId(key: string): string | null {
    if (milestoneIdByClientKey.has(key)) return milestoneIdByClientKey.get(key)!;
    if (existingMilestoneIds.has(key)) return key;
    return null;
  }

  /** A work-unit reference may be a new clientKey or an existing canonical id. */
  function resolveWorkUnitId(key: string): string | null {
    if (workUnitIdByClientKey.has(key)) return workUnitIdByClientKey.get(key)!;
    if (existingWorkUnitIds.has(key)) return key;
    return null;
  }

  for (const wu of input.workUnits) {
    if (resolveMilestoneId(wu.milestoneClientKey) === null) {
      throw extendInvalidError(
        "PLAN-EXTEND-MILESTONE-INVALID",
        `Work unit "${wu.clientKey}" references unknown milestoneClientKey "${wu.milestoneClientKey}".`,
      );
    }
  }

  // Every newly declared milestone must be referenced by at least one new work unit.
  const referencedNewMilestoneClientKeys = new Set(
    input.workUnits
      .map((wu) => wu.milestoneClientKey)
      .filter((key) => newMilestoneClientKeys.has(key)),
  );
  for (const milestone of input.milestones) {
    if (!referencedNewMilestoneClientKeys.has(milestone.clientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-MILESTONE-INVALID",
        `Milestone "${milestone.clientKey}" has no referencing work units in the append input.`,
      );
    }
  }

  for (const dep of input.dependencies) {
    if (resolveWorkUnitId(dep.fromClientKey) === null || resolveWorkUnitId(dep.toClientKey) === null) {
      throw extendInvalidError(
        "PLAN-EXTEND-DEPENDENCY-INVALID",
        `Append dependency references an unknown work unit (from "${dep.fromClientKey}" to "${dep.toClientKey}").`,
      );
    }
    if (resolveWorkUnitId(dep.fromClientKey) === resolveWorkUnitId(dep.toClientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-CYCLE",
        `Work unit "${dep.fromClientKey}" cannot depend on itself.`,
      );
    }
  }

  const dupDependency = findDuplicate(
    input.dependencies,
    (d) => `${resolveWorkUnitId(d.fromClientKey)} ${resolveWorkUnitId(d.toClientKey)} ${d.type}`,
  );
  if (dupDependency) {
    throw extendInvalidError(
      "PLAN-EXTEND-DEPENDENCY-INVALID",
      `Duplicate dependency from "${dupDependency.fromClientKey}" to "${dupDependency.toClientKey}" of type "${dupDependency.type}".`,
    );
  }

  const allocateDependencyId = makeDependencyIdAllocator(state.workGraph.dependencies.map((d) => d.id));
  const newDependencies: Dependency[] = input.dependencies.map((dep) => ({
    id: allocateDependencyId(),
    fromId: resolveWorkUnitId(dep.fromClientKey)!,
    toId: resolveWorkUnitId(dep.toClientKey)!,
    type: dep.type,
    reason: dep.reason ?? null,
  }));

  // Full-graph cycle validation (self-dependency already rejected above).
  const allNodeIds = [...existingWorkUnitIds, ...newWorkUnitIds];
  const allBlockingEdges = [
    ...state.workGraph.dependencies
      .filter((d) => d.type === "blocks" || d.type === "requires")
      .map((d) => ({ from: d.fromId, to: d.toId })),
    ...newDependencies
      .filter((d) => d.type === "blocks" || d.type === "requires")
      .map((d) => ({ from: d.fromId, to: d.toId })),
  ];
  const cycle = findCycle(allNodeIds, allBlockingEdges);
  if (cycle) {
    throw extendInvalidError(
      "PLAN-EXTEND-CYCLE",
      `Circular blocking dependency detected across the existing and new graph: ${cycle.join(" -> ")}.`,
    );
  }

  // ---- build candidate work units (new + existing dependency bookkeeping). ----
  const incomingDependencyIdsByNewWorkUnitId = new Map<string, string[]>();
  for (const id of newWorkUnitIds) incomingDependencyIdsByNewWorkUnitId.set(id, []);
  const addedIncomingDependencyIdsByExistingWorkUnitId = new Map<string, string[]>();
  for (const dep of newDependencies) {
    if (incomingDependencyIdsByNewWorkUnitId.has(dep.toId)) {
      incomingDependencyIdsByNewWorkUnitId.get(dep.toId)!.push(dep.id);
    } else if (existingWorkUnitIds.has(dep.toId)) {
      const list = addedIncomingDependencyIdsByExistingWorkUnitId.get(dep.toId) ?? [];
      list.push(dep.id);
      addedIncomingDependencyIdsByExistingWorkUnitId.set(dep.toId, list);
    }
  }

  const newWorkUnits: WorkUnit[] = input.workUnits.map((wu, i) => ({
    id: newWorkUnitIds[i],
    milestoneId: resolveMilestoneId(wu.milestoneClientKey)!,
    title: wu.title,
    objective: wu.objective,
    scope: wu.scope,
    outOfScope: wu.outOfScope,
    acceptanceCriteria: wu.acceptanceCriteria,
    agentContextRefs: wu.agentContextRefs,
    suggestedFiles: wu.suggestedFiles,
    validationCommands: wu.validationCommands,
    // Provisional -- recomputed below via the same centralized readiness
    // service M12 introduced, restricted to only the newly added work units.
    status: "planned",
    dependencies: incomingDependencyIdsByNewWorkUnitId.get(newWorkUnitIds[i]) ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    executionMetadata: wu.executionMetadata,
  }));

  // Existing work units are never re-planned or re-statused by append; only
  // their `dependencies` bookkeeping list may gain newly added incoming ids.
  const candidateExistingWorkUnits: WorkUnit[] = state.workGraph.workUnits.map((wu) => {
    const addedDepIds = addedIncomingDependencyIdsByExistingWorkUnitId.get(wu.id);
    if (addedDepIds && addedDepIds.length > 0) {
      return { ...wu, dependencies: [...wu.dependencies, ...addedDepIds], updatedAt: timestamp };
    }
    return wu;
  });

  const candidateWorkUnitsUnready = [...candidateExistingWorkUnits, ...newWorkUnits];
  const candidateDependencies = [...state.workGraph.dependencies, ...newDependencies];

  const recalculated = recalculateReadinessAfterDependencyUpdate(
    candidateWorkUnitsUnready,
    candidateDependencies,
    timestamp,
  );

  // Append must never change the status of an existing work unit -- only
  // newly added work units may adopt the recalculated status. New blocking
  // edges only ever add constraints (nothing is removed), so an existing
  // "ready"/"planned" unit could in principle be recomputed differently;
  // this guard makes that impossible regardless.
  const newWorkUnitIdSet = new Set(newWorkUnitIds);
  const originalStatusById = new Map(candidateExistingWorkUnits.map((wu) => [wu.id, wu]));
  const finalWorkUnits = recalculated.workUnits.map((wu) => {
    if (newWorkUnitIdSet.has(wu.id)) return wu;
    const original = originalStatusById.get(wu.id)!;
    return wu.status === original.status ? wu : { ...original };
  });

  // M24 §4.3/§19.10: isolated assignment-key uniqueness validated over the
  // full candidate graph (existing + newly appended), before any mutation
  // is returned to the caller.
  const isolatedKeyCheck = validateIsolatedAssignmentKeyUniqueness(finalWorkUnits);
  if (!isolatedKeyCheck.ok) {
    throw extendInvalidError(
      "PLAN-EXTEND-ISOLATED-ASSIGNMENT-KEY-REUSED",
      `Isolated workspace assignmentKey(s) reused across non-terminal work units: ${isolatedKeyCheck.duplicateKeys.join(", ")}.`,
    );
  }

  const newMilestones: Milestone[] = input.milestones.map((m) => ({
    id: milestoneIdByClientKey.get(m.clientKey)!,
    title: m.title,
    objective: m.objective,
    status: "planned",
    workUnitIds: finalWorkUnits
      .filter((wu) => wu.milestoneId === milestoneIdByClientKey.get(m.clientKey))
      .map((wu) => wu.id),
  }));

  // Existing milestones that gained new children may have their derived
  // status recomputed (e.g. now "ready" because a new child is ready);
  // completed milestones are always frozen regardless.
  const existingMilestonesWithNewChildren = state.workGraph.milestones.map((m) => ({
    ...m,
    workUnitIds: [
      ...m.workUnitIds,
      ...newWorkUnits.filter((wu) => wu.milestoneId === m.id).map((wu) => wu.id),
    ],
  }));

  const recomputedMilestones = recalculateMilestoneStatuses(finalWorkUnits, [
    ...existingMilestonesWithNewChildren,
    ...newMilestones,
  ]);
  const candidateMilestones = protectCompletedMilestones(state.workGraph.milestones, recomputedMilestones);

  const candidateStateUnassessed: StateModel = {
    ...state,
    workGraph: {
      milestones: candidateMilestones,
      workUnits: finalWorkUnits,
      dependencies: candidateDependencies,
    },
    lastUpdatedAt: timestamp,
  };
  const candidateState = applyWorkflowAssessmentToState(project, candidateStateUnassessed);
  const nextRecommendedCommand = candidateState.nextRecommendedCommand ?? "aiqt review";

  return {
    state: candidateState,
    addedMilestoneIds: newMilestoneIds,
    addedWorkUnitIds: newWorkUnitIds,
    addedDependencyIds: newDependencies.map((d) => d.id),
    completedWorkUnitsModified: 0,
    completedMilestonesModified: 0,
    cyclesIntroduced: 0,
    nextRecommendedCommand,
  };
}

// ---------------------------------------------------------------------------
// Refine: replace one eligible work unit with a detailed replacement subgraph.
// ---------------------------------------------------------------------------

export interface PlanRefinementOutcome {
  /** The full candidate state, ready to persist verbatim (or discard for --preview). */
  state: StateModel;
  targetWorkUnitId: string;
  targetOriginalStatus: WorkUnitStatus;
  reason: string;
  addedMilestoneIds: string[];
  addedWorkUnitIds: string[];
  addedDependencyIds: string[];
  entryWorkUnitIds: string[];
  exitWorkUnitIds: string[];
  copiedIncomingDependencyIds: string[];
  copiedOutgoingDependencyIds: string[];
  /** Always 0: refinement never touches a completed work unit. */
  completedWorkUnitsModified: 0;
  /** Always 0: refinement never touches a completed milestone. */
  completedMilestonesModified: 0;
  /** Always 0: a non-zero value would already have thrown PLAN-EXTEND-CYCLE. */
  cyclesIntroduced: 0;
  nextRecommendedCommand: string;
}

/**
 * Build the full candidate state for a refinement operation. Pure and
 * side-effect free -- throws AiqtError on any validation failure, with no
 * partial mutation ever visible to the caller. The caller decides whether to
 * persist the returned candidate state (apply) or discard it (--preview).
 */
export function buildPlanRefinement(params: {
  project?: ProjectModel;
  state: StateModel;
  targetWorkUnitId: string;
  input: PlanExtensionInput;
  timestamp: string;
}): PlanRefinementOutcome {
  const { state, targetWorkUnitId, input, timestamp } = params;
  const project = params.project ?? DEFAULT_ASSESSMENT_PROJECT;

  const target = findTargetWorkUnit(state, targetWorkUnitId);
  if (!target) {
    throw extendInvalidError(
      "PLAN-EXTEND-TARGET-NOT-FOUND",
      `Refinement target work unit "${targetWorkUnitId}" was not found in the current work graph.`,
    );
  }

  const eligibility = checkTargetEligibility(state, target);
  if (!eligibility.eligible) {
    throw extendBlockedError(eligibility.code, eligibility.message);
  }

  // ---- payload structural validation (mirrors buildWorkGraphFromPlanInput). ----
  const dupMilestone = findDuplicate(input.milestones, (m) => m.clientKey);
  if (dupMilestone) {
    throw extendInvalidError(
      "PLAN-EXTEND-DUPLICATE-KEY",
      `Duplicate milestone clientKey "${dupMilestone.clientKey}" in refinement input.`,
    );
  }
  const dupWorkUnit = findDuplicate(input.workUnits, (wu) => wu.clientKey);
  if (dupWorkUnit) {
    throw extendInvalidError(
      "PLAN-EXTEND-DUPLICATE-KEY",
      `Duplicate work unit clientKey "${dupWorkUnit.clientKey}" in refinement input.`,
    );
  }

  const milestoneClientKeys = new Set(input.milestones.map((m) => m.clientKey));
  const workUnitClientKeys = new Set(input.workUnits.map((wu) => wu.clientKey));

  for (const wu of input.workUnits) {
    if (!milestoneClientKeys.has(wu.milestoneClientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-MILESTONE-INVALID",
        `Work unit "${wu.clientKey}" references unknown milestoneClientKey "${wu.milestoneClientKey}".`,
      );
    }
  }

  const referencedMilestoneClientKeys = new Set(input.workUnits.map((wu) => wu.milestoneClientKey));
  for (const milestone of input.milestones) {
    if (!referencedMilestoneClientKeys.has(milestone.clientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-MILESTONE-INVALID",
        `Milestone "${milestone.clientKey}" has no referencing work units in the refinement input.`,
      );
    }
  }

  for (const dep of input.dependencies) {
    if (!workUnitClientKeys.has(dep.fromClientKey) || !workUnitClientKeys.has(dep.toClientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-DEPENDENCY-INVALID",
        `Refinement dependency references a work unit outside the new payload (from "${dep.fromClientKey}" to "${dep.toClientKey}").`,
      );
    }
    if (dep.fromClientKey === dep.toClientKey) {
      throw extendInvalidError(
        "PLAN-EXTEND-CYCLE",
        `Work unit "${dep.fromClientKey}" cannot depend on itself.`,
      );
    }
  }

  const dupDependency = findDuplicate(
    input.dependencies,
    (d) => `${d.fromClientKey} ${d.toClientKey} ${d.type}`,
  );
  if (dupDependency) {
    throw extendInvalidError(
      "PLAN-EXTEND-DEPENDENCY-INVALID",
      `Duplicate dependency from "${dupDependency.fromClientKey}" to "${dupDependency.toClientKey}" of type "${dupDependency.type}".`,
    );
  }

  // ---- entry/exit key validation. ----
  for (const key of input.extension.entryWorkUnitClientKeys) {
    if (!workUnitClientKeys.has(key)) {
      throw extendInvalidError(
        "PLAN-EXTEND-ENTRY-INVALID",
        `Entry work unit clientKey "${key}" does not reference a work unit in the refinement payload.`,
      );
    }
  }
  for (const key of input.extension.exitWorkUnitClientKeys) {
    if (!workUnitClientKeys.has(key)) {
      throw extendInvalidError(
        "PLAN-EXTEND-EXIT-INVALID",
        `Exit work unit clientKey "${key}" does not reference a work unit in the refinement payload.`,
      );
    }
  }

  // ---- ID allocation, continuing from the current highest canonical ID. ----
  const existingMilestoneIds = state.workGraph.milestones.map((m) => m.id);
  const existingWorkUnitIds = state.workGraph.workUnits.map((wu) => wu.id);

  const newMilestoneIds = allocateSequentialIds("M", existingMilestoneIds, input.milestones.length, "");
  const newWorkUnitIds = allocateSequentialIds("WU", existingWorkUnitIds, input.workUnits.length, "");

  const milestoneIdByClientKey = new Map(input.milestones.map((m, i) => [m.clientKey, newMilestoneIds[i]]));
  const workUnitIdByClientKey = new Map(input.workUnits.map((wu, i) => [wu.clientKey, newWorkUnitIds[i]]));

  const entryWorkUnitIds = input.extension.entryWorkUnitClientKeys.map(
    (key) => workUnitIdByClientKey.get(key)!,
  );
  const exitWorkUnitIds = input.extension.exitWorkUnitClientKeys.map(
    (key) => workUnitIdByClientKey.get(key)!,
  );

  // At least one declared entry must not be blocked by another new work
  // unit's payload dependency, or no declared entry is an actual graph
  // entry into the replacement subgraph.
  const payloadBlockingTargets = new Set(
    input.dependencies
      .filter((d) => d.type === "blocks" || d.type === "requires")
      .map((d) => workUnitIdByClientKey.get(d.toClientKey)!),
  );
  if (!entryWorkUnitIds.some((id) => !payloadBlockingTargets.has(id))) {
    throw extendInvalidError(
      "PLAN-EXTEND-ENTRY-INVALID",
      "At least one declared entry work unit must not be blocked by another new work unit's dependency.",
    );
  }

  const allocateDependencyId = makeDependencyIdAllocator(state.workGraph.dependencies.map((d) => d.id));

  const payloadDependencies: Dependency[] = input.dependencies.map((dep) => ({
    id: allocateDependencyId(),
    fromId: workUnitIdByClientKey.get(dep.fromClientKey)!,
    toId: workUnitIdByClientKey.get(dep.toClientKey)!,
    type: dep.type,
    reason: dep.reason ?? null,
  }));

  // ---- boundary rewiring. Both blocking types are preserved exactly;
  // relates_to is never copied automatically. ----
  const incomingBlocking = state.workGraph.dependencies.filter(
    (d) => d.toId === target.id && (d.type === "blocks" || d.type === "requires"),
  );
  const outgoingBlocking = state.workGraph.dependencies.filter(
    (d) => d.fromId === target.id && (d.type === "blocks" || d.type === "requires"),
  );

  const copiedIncoming: Dependency[] = [];
  for (const dep of incomingBlocking) {
    for (const entryId of entryWorkUnitIds) {
      copiedIncoming.push({
        id: allocateDependencyId(),
        fromId: dep.fromId,
        toId: entryId,
        type: dep.type,
        reason: dep.reason,
      });
    }
  }

  const copiedOutgoing: Dependency[] = [];
  for (const dep of outgoingBlocking) {
    for (const exitId of exitWorkUnitIds) {
      copiedOutgoing.push({
        id: allocateDependencyId(),
        fromId: exitId,
        toId: dep.toId,
        type: dep.type,
        reason: dep.reason,
      });
    }
  }

  const allNewDependencies = [...payloadDependencies, ...copiedIncoming, ...copiedOutgoing];

  // ---- full-graph validation (self-dependency already rejected above; duplicate/missing-reference already rejected above). ----
  const allNodeIds = [...existingWorkUnitIds, ...newWorkUnitIds];
  const allBlockingEdges = [
    ...state.workGraph.dependencies
      .filter((d) => d.type === "blocks" || d.type === "requires")
      .map((d) => ({ from: d.fromId, to: d.toId })),
    ...allNewDependencies
      .filter((d) => d.type === "blocks" || d.type === "requires")
      .map((d) => ({ from: d.fromId, to: d.toId })),
  ];
  const cycle = findCycle(allNodeIds, allBlockingEdges);
  if (cycle) {
    throw extendInvalidError(
      "PLAN-EXTEND-CYCLE",
      `Circular blocking dependency detected across the existing and new graph: ${cycle.join(" -> ")}.`,
    );
  }

  // ---- build candidate work units (new + mutated existing). ----
  const incomingDependencyIdsByNewWorkUnitId = new Map<string, string[]>();
  for (const id of newWorkUnitIds) incomingDependencyIdsByNewWorkUnitId.set(id, []);
  for (const dep of [...payloadDependencies, ...copiedIncoming]) {
    const list = incomingDependencyIdsByNewWorkUnitId.get(dep.toId);
    if (list) list.push(dep.id);
  }

  const newWorkUnits: WorkUnit[] = input.workUnits.map((wu, i) => ({
    id: newWorkUnitIds[i],
    milestoneId: milestoneIdByClientKey.get(wu.milestoneClientKey)!,
    title: wu.title,
    objective: wu.objective,
    scope: wu.scope,
    outOfScope: wu.outOfScope,
    acceptanceCriteria: wu.acceptanceCriteria,
    agentContextRefs: wu.agentContextRefs,
    suggestedFiles: wu.suggestedFiles,
    validationCommands: wu.validationCommands,
    // Provisional -- recomputed for the whole candidate graph below via the
    // same centralized readiness service M12 already uses.
    status: "planned",
    dependencies: incomingDependencyIdsByNewWorkUnitId.get(newWorkUnitIds[i]) ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
    executionMetadata: wu.executionMetadata,
  }));

  const addedOutgoingDependencyIdsByExistingWorkUnitId = new Map<string, string[]>();
  for (const dep of copiedOutgoing) {
    const list = addedOutgoingDependencyIdsByExistingWorkUnitId.get(dep.toId) ?? [];
    list.push(dep.id);
    addedOutgoingDependencyIdsByExistingWorkUnitId.set(dep.toId, list);
  }

  const candidateExistingWorkUnits: WorkUnit[] = state.workGraph.workUnits.map((wu) => {
    if (wu.id === target.id) {
      return {
        ...wu,
        status: "replanned" as const,
        replanReason: input.extension.reason,
        replacedByWorkUnitIds: newWorkUnitIds,
        updatedAt: timestamp,
      };
    }
    const addedDepIds = addedOutgoingDependencyIdsByExistingWorkUnitId.get(wu.id);
    if (addedDepIds && addedDepIds.length > 0) {
      return { ...wu, dependencies: [...wu.dependencies, ...addedDepIds], updatedAt: timestamp };
    }
    return wu;
  });

  const candidateWorkUnitsUnready = [...candidateExistingWorkUnits, ...newWorkUnits];
  const candidateDependencies = [...state.workGraph.dependencies, ...allNewDependencies];

  // Recompute readiness for the whole candidate graph through the same
  // centralized bidirectional service M12 introduced for dependency updates
  // -- not a second readiness engine.
  const readiness = recalculateReadinessAfterDependencyUpdate(
    candidateWorkUnitsUnready,
    candidateDependencies,
    timestamp,
  );

  // M24 §4.3/§19.10: isolated assignment-key uniqueness validated over the
  // full candidate graph (existing + newly refined-in), before any mutation
  // is returned to the caller. The replanned original is excluded
  // automatically -- it is now a terminal ("replanned") status.
  const isolatedKeyCheck = validateIsolatedAssignmentKeyUniqueness(readiness.workUnits);
  if (!isolatedKeyCheck.ok) {
    throw extendInvalidError(
      "PLAN-REFINE-ISOLATED-ASSIGNMENT-KEY-REUSED",
      `Isolated workspace assignmentKey(s) reused across non-terminal work units: ${isolatedKeyCheck.duplicateKeys.join(", ")}.`,
    );
  }

  const newMilestones: Milestone[] = input.milestones.map((m) => ({
    id: milestoneIdByClientKey.get(m.clientKey)!,
    title: m.title,
    objective: m.objective,
    status: "planned",
    workUnitIds: readiness.workUnits
      .filter((wu) => wu.milestoneId === milestoneIdByClientKey.get(m.clientKey))
      .map((wu) => wu.id),
  }));

  const recomputedMilestones = recalculateMilestoneStatuses(readiness.workUnits, [
    ...state.workGraph.milestones,
    ...newMilestones,
  ]);
  const candidateMilestones = protectCompletedMilestones(state.workGraph.milestones, recomputedMilestones);

  const candidateStateUnassessed: StateModel = {
    ...state,
    workGraph: {
      milestones: candidateMilestones,
      workUnits: readiness.workUnits,
      dependencies: candidateDependencies,
    },
    lastUpdatedAt: timestamp,
  };
  const candidateState = applyWorkflowAssessmentToState(project, candidateStateUnassessed);
  const nextRecommendedCommand = candidateState.nextRecommendedCommand ?? "aiqt review";

  return {
    state: candidateState,
    targetWorkUnitId: target.id,
    targetOriginalStatus: target.status,
    reason: input.extension.reason,
    addedMilestoneIds: newMilestoneIds,
    addedWorkUnitIds: newWorkUnitIds,
    addedDependencyIds: allNewDependencies.map((d) => d.id),
    entryWorkUnitIds,
    exitWorkUnitIds,
    copiedIncomingDependencyIds: copiedIncoming.map((d) => d.id),
    copiedOutgoingDependencyIds: copiedOutgoing.map((d) => d.id),
    completedWorkUnitsModified: 0,
    completedMilestonesModified: 0,
    cyclesIntroduced: 0,
    nextRecommendedCommand,
  };
}
