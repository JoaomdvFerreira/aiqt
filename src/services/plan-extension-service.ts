import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type { Issue } from "../core/output/issue.js";
import { formatId, nextId, parseIdNumber } from "../state/ids.js";
import { findCycle } from "../workflow/dependency-graph.js";
import { recalculateReadinessAfterDependencyUpdate } from "../workflow/dependency-update-transition.js";
import { recalculateMilestoneStatuses } from "../workflow/checkpoint-status-transitions.js";
import { findDuplicate } from "./planning-service.js";
import type { PlanExtensionInput } from "../schema/plan-extension-input.schema.js";
import type { StateModel } from "../schema/state.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { WorkUnit, WorkUnitStatus } from "../schema/work-unit.schema.js";
import type { Dependency } from "../schema/dependency.schema.js";

/**
 * M17: incremental work-graph extension and roadmap-placeholder replacement.
 * AIQT never re-plans an existing graph through `aiqt plan` (F3.1) -- this
 * module is the one official, transactional path that may add milestones,
 * work units, and dependencies to a non-empty graph and replace exactly one
 * not-started roadmap placeholder, without deleting any historical record.
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

/** Blocked (exit 2): structurally valid request, rejected by workflow position or placeholder history. */
function extendBlockedError(id: string, message: string): AiqtError {
  return new AiqtError(message, ExitCode.WorkflowBlocked, extendIssue(id, true, message));
}

/** Invalid (exit 3): malformed/inconsistent input, reference, or graph structure. */
function extendInvalidError(id: string, message: string): AiqtError {
  return new AiqtError(message, ExitCode.InvalidInput, extendIssue(id, false, message));
}

const ELIGIBLE_PLACEHOLDER_STATUSES: ReadonlySet<WorkUnitStatus> = new Set(["ready", "planned"]);

/** §8: locate the named placeholder in canonical state, or null if unknown. */
export function findPlaceholderWorkUnit(state: StateModel, placeholderId: string): WorkUnit | null {
  return state.workGraph.workUnits.find((wu) => wu.id === placeholderId) ?? null;
}

/**
 * §8.1/§8.2/§8.3: eligibility gate for --replace-placeholder. Status-based
 * ineligibility (in_progress/needs_review/done/replanned/cancelled) and
 * history-based ineligibility (checkpoint, active packet, current work unit,
 * already replanned) are reported with distinct stable error codes, but both
 * map to the same blocked/exit-2 workflow-position outcome.
 */
export function checkPlaceholderEligibility(
  state: StateModel,
  workUnit: WorkUnit,
): { eligible: true } | { eligible: false; code: string; message: string } {
  if (!ELIGIBLE_PLACEHOLDER_STATUSES.has(workUnit.status)) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-PLACEHOLDER-INELIGIBLE",
      message: `Work unit "${workUnit.id}" has status "${workUnit.status}" and cannot be targeted by --replace-placeholder.`,
    };
  }
  if (workUnit.replacedByWorkUnitIds && workUnit.replacedByWorkUnitIds.length > 0) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-PLACEHOLDER-INELIGIBLE",
      message: `Work unit "${workUnit.id}" already has replacement metadata recorded.`,
    };
  }
  if (state.currentWorkUnitId === workUnit.id) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-PLACEHOLDER-HAS-HISTORY",
      message: `Work unit "${workUnit.id}" is the current in-progress work unit and cannot be replaced.`,
    };
  }
  if (state.checkpoints.some((c) => c.workUnitId === workUnit.id)) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-PLACEHOLDER-HAS-HISTORY",
      message: `Work unit "${workUnit.id}" already has a checkpoint recorded and cannot be replaced.`,
    };
  }
  if (state.lastAgentPacket?.workUnitId === workUnit.id) {
    return {
      eligible: false,
      code: "PLAN-EXTEND-PLACEHOLDER-HAS-HISTORY",
      message: `Work unit "${workUnit.id}" has an agent packet recorded and cannot be replaced.`,
    };
  }
  return { eligible: true };
}

export interface PlanExtensionOutcome {
  /** The full candidate state, ready to persist verbatim (or discard for --preview). */
  state: StateModel;
  placeholderWorkUnitId: string;
  placeholderOriginalStatus: WorkUnitStatus;
  reason: string;
  addedMilestoneIds: string[];
  addedWorkUnitIds: string[];
  addedDependencyIds: string[];
  entryWorkUnitIds: string[];
  exitWorkUnitIds: string[];
  copiedIncomingDependencyIds: string[];
  copiedOutgoingDependencyIds: string[];
  /** Always 0: extension never touches a completed work unit. */
  completedWorkUnitsModified: 0;
  /** Always 0: extension never touches a completed milestone. */
  completedMilestonesModified: 0;
  /** Always 0: a non-zero value would already have thrown PLAN-EXTEND-CYCLE. */
  cyclesIntroduced: 0;
  nextRecommendedCommand: string;
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

/**
 * §10: build the full candidate state for a plan extension. Pure and
 * side-effect free -- throws AiqtError on any validation failure, with no
 * partial mutation ever visible to the caller. The caller decides whether to
 * persist the returned candidate state (apply) or discard it (--preview).
 */
export function buildPlanExtension(params: {
  state: StateModel;
  placeholderWorkUnitId: string;
  input: PlanExtensionInput;
  timestamp: string;
}): PlanExtensionOutcome {
  const { state, placeholderWorkUnitId, input, timestamp } = params;

  const placeholder = findPlaceholderWorkUnit(state, placeholderWorkUnitId);
  if (!placeholder) {
    throw extendInvalidError(
      "PLAN-EXTEND-PLACEHOLDER-NOT-FOUND",
      `Placeholder work unit "${placeholderWorkUnitId}" was not found in the current work graph.`,
    );
  }

  const eligibility = checkPlaceholderEligibility(state, placeholder);
  if (!eligibility.eligible) {
    throw extendBlockedError(eligibility.code, eligibility.message);
  }

  // ---- payload structural validation (mirrors buildWorkGraphFromPlanInput). ----
  const dupMilestone = findDuplicate(input.milestones, (m) => m.clientKey);
  if (dupMilestone) {
    throw extendInvalidError(
      "PLAN-EXTEND-DUPLICATE-KEY",
      `Duplicate milestone clientKey "${dupMilestone.clientKey}" in extension input.`,
    );
  }
  const dupWorkUnit = findDuplicate(input.workUnits, (wu) => wu.clientKey);
  if (dupWorkUnit) {
    throw extendInvalidError(
      "PLAN-EXTEND-DUPLICATE-KEY",
      `Duplicate work unit clientKey "${dupWorkUnit.clientKey}" in extension input.`,
    );
  }

  const milestoneClientKeys = new Set(input.milestones.map((m) => m.clientKey));
  const workUnitClientKeys = new Set(input.workUnits.map((wu) => wu.clientKey));

  for (const wu of input.workUnits) {
    if (!milestoneClientKeys.has(wu.milestoneClientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-DEPENDENCY-INVALID",
        `Work unit "${wu.clientKey}" references unknown milestoneClientKey "${wu.milestoneClientKey}".`,
      );
    }
  }

  const referencedMilestoneClientKeys = new Set(input.workUnits.map((wu) => wu.milestoneClientKey));
  for (const milestone of input.milestones) {
    if (!referencedMilestoneClientKeys.has(milestone.clientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-DEPENDENCY-INVALID",
        `Milestone "${milestone.clientKey}" has no referencing work units in the extension input.`,
      );
    }
  }

  for (const dep of input.dependencies) {
    if (!workUnitClientKeys.has(dep.fromClientKey) || !workUnitClientKeys.has(dep.toClientKey)) {
      throw extendInvalidError(
        "PLAN-EXTEND-DEPENDENCY-INVALID",
        `Extension dependency references a work unit outside the new payload (from "${dep.fromClientKey}" to "${dep.toClientKey}").`,
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

  // ---- entry/exit key validation (§7.2/§7.3). ----
  for (const key of input.extension.entryWorkUnitClientKeys) {
    if (!workUnitClientKeys.has(key)) {
      throw extendInvalidError(
        "PLAN-EXTEND-ENTRY-INVALID",
        `Entry work unit clientKey "${key}" does not reference a work unit in the extension payload.`,
      );
    }
  }
  for (const key of input.extension.exitWorkUnitClientKeys) {
    if (!workUnitClientKeys.has(key)) {
      throw extendInvalidError(
        "PLAN-EXTEND-EXIT-INVALID",
        `Exit work unit clientKey "${key}" does not reference a work unit in the extension payload.`,
      );
    }
  }

  // ---- ID allocation, continuing from the current highest canonical ID. ----
  const existingMilestoneIds = state.workGraph.milestones.map((m) => m.id);
  const existingWorkUnitIds = state.workGraph.workUnits.map((wu) => wu.id);
  const existingDependencyIds = state.workGraph.dependencies.map((d) => d.id);

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

  // §7.2: at least one declared entry must not be blocked by another new
  // work unit's payload dependency, or no declared entry is an actual graph
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

  let depWorkingIds = [...existingDependencyIds];
  function allocateDependencyId(): string {
    const id = nextId("DEP", depWorkingIds, "-");
    depWorkingIds = [...depWorkingIds, id];
    return id;
  }

  const payloadDependencies: Dependency[] = input.dependencies.map((dep) => ({
    id: allocateDependencyId(),
    fromId: workUnitIdByClientKey.get(dep.fromClientKey)!,
    toId: workUnitIdByClientKey.get(dep.toClientKey)!,
    type: dep.type,
    reason: dep.reason ?? null,
  }));

  // ---- §9: boundary rewiring. Both blocking types are preserved exactly;
  // relates_to is never copied automatically (§9.3). ----
  const incomingBlocking = state.workGraph.dependencies.filter(
    (d) => d.toId === placeholder.id && (d.type === "blocks" || d.type === "requires"),
  );
  const outgoingBlocking = state.workGraph.dependencies.filter(
    (d) => d.fromId === placeholder.id && (d.type === "blocks" || d.type === "requires"),
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

  // ---- §9.5: full-graph validation (self-dependency already rejected above; duplicate/missing-reference already rejected above). ----
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
  }));

  const addedOutgoingDependencyIdsByExistingWorkUnitId = new Map<string, string[]>();
  for (const dep of copiedOutgoing) {
    const list = addedOutgoingDependencyIdsByExistingWorkUnitId.get(dep.toId) ?? [];
    list.push(dep.id);
    addedOutgoingDependencyIdsByExistingWorkUnitId.set(dep.toId, list);
  }

  const candidateExistingWorkUnits: WorkUnit[] = state.workGraph.workUnits.map((wu) => {
    if (wu.id === placeholder.id) {
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

  // §13: recompute readiness for the whole candidate graph through the same
  // centralized bidirectional service M12 introduced for dependency updates
  // -- not a second readiness engine.
  const readiness = recalculateReadinessAfterDependencyUpdate(
    candidateWorkUnitsUnready,
    candidateDependencies,
    timestamp,
  );

  const newMilestones: Milestone[] = input.milestones.map((m) => ({
    id: milestoneIdByClientKey.get(m.clientKey)!,
    title: m.title,
    objective: m.objective,
    status: "planned",
    workUnitIds: readiness.workUnits
      .filter((wu) => wu.milestoneId === milestoneIdByClientKey.get(m.clientKey))
      .map((wu) => wu.id),
  }));

  const candidateMilestones = recalculateMilestoneStatuses(readiness.workUnits, [
    ...state.workGraph.milestones,
    ...newMilestones,
  ]);

  const nextRecommendedCommand = "aiqt next";

  const candidateState: StateModel = {
    ...state,
    workGraph: {
      milestones: candidateMilestones,
      workUnits: readiness.workUnits,
      dependencies: candidateDependencies,
    },
    nextRecommendedCommand,
    lastUpdatedAt: timestamp,
  };

  return {
    state: candidateState,
    placeholderWorkUnitId: placeholder.id,
    placeholderOriginalStatus: placeholder.status,
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
