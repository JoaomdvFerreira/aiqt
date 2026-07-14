import { nextId } from "../state/ids.js";
import { recalculateMilestoneStatuses } from "./checkpoint-status-transitions.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { WorkGraph } from "../schema/work-graph.schema.js";

/** M11 §11.1: the fixed title used to find-or-reuse the single repair milestone. Never "M-REPAIR" -- always a canonical M### id. */
export const REPAIR_MILESTONE_TITLE = "Review Repair Work";

export interface RepairMilestoneResolution {
  milestone: Milestone;
  milestones: Milestone[];
  created: boolean;
}

/**
 * §11.1: find the existing repair milestone (matched by its fixed title) or
 * create the next canonical M### milestone, e.g. M009. Never invents a
 * non-canonical id such as M-REPAIR.
 */
export function findOrCreateRepairMilestone(workGraph: WorkGraph): RepairMilestoneResolution {
  const existing = workGraph.milestones.find((m) => m.title === REPAIR_MILESTONE_TITLE);
  if (existing) {
    return { milestone: existing, milestones: workGraph.milestones, created: false };
  }

  const milestoneId = nextId(
    "M",
    workGraph.milestones.map((m) => m.id),
    "",
  );
  const newMilestone: Milestone = {
    id: milestoneId,
    title: REPAIR_MILESTONE_TITLE,
    objective: "Track and resolve promoted repair issues.",
    status: "planned",
    workUnitIds: [],
  };
  return {
    milestone: newMilestone,
    milestones: [...workGraph.milestones, newMilestone],
    created: true,
  };
}

export interface PromotedWorkUnitParams {
  workGraph: WorkGraph;
  milestoneId: string;
  title: string;
  issueMessage: string;
  validationCommands: readonly string[];
  timestamp: string;
}

/**
 * §11.2: build the canonical repair WorkUnit. Every required field
 * (title/objective/scope/outOfScope/acceptanceCriteria/validationCommands)
 * is guaranteed non-empty. A promoted work unit has no dependencies, so it
 * always satisfies the readiness gate and is created "ready" (§11.4).
 */
export function buildPromotedWorkUnit(params: PromotedWorkUnitParams): WorkUnit {
  const { workGraph, milestoneId, title, issueMessage, validationCommands, timestamp } = params;
  const workUnitId = nextId(
    "WU",
    workGraph.workUnits.map((wu) => wu.id),
    "",
  );

  return {
    id: workUnitId,
    milestoneId,
    title,
    objective: `Repair: ${issueMessage}`,
    scope: [issueMessage],
    outOfScope: ["Do not modify unrelated work units or canonical schema."],
    acceptanceCriteria: ["Issue is resolved and validation passes."],
    agentContextRefs: [],
    suggestedFiles: [],
    validationCommands: [...validationCommands],
    status: "ready",
    dependencies: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface ApplyPromotionResult {
  workGraph: WorkGraph;
  workUnit: WorkUnit;
  milestone: Milestone;
  milestoneCreated: boolean;
}

/**
 * §11: apply a full promotion to the work graph -- find-or-create the
 * repair milestone, append the new repair work unit, link it into the
 * milestone's workUnitIds, and recompute every milestone's status from its
 * (possibly new) children. Pure and side-effect free.
 */
export function applyIssuePromotion(params: {
  workGraph: WorkGraph;
  title: string;
  issueMessage: string;
  validationCommands: readonly string[];
  timestamp: string;
}): ApplyPromotionResult {
  const { workGraph, title, issueMessage, validationCommands, timestamp } = params;

  const resolution = findOrCreateRepairMilestone(workGraph);
  const workUnit = buildPromotedWorkUnit({
    workGraph,
    milestoneId: resolution.milestone.id,
    title,
    issueMessage,
    validationCommands,
    timestamp,
  });

  const workUnits = [...workGraph.workUnits, workUnit];
  const milestonesWithLinkedWorkUnit = resolution.milestones.map((m) =>
    m.id === resolution.milestone.id ? { ...m, workUnitIds: [...m.workUnitIds, workUnit.id] } : m,
  );
  const milestones = recalculateMilestoneStatuses(workUnits, milestonesWithLinkedWorkUnit);
  const milestone = milestones.find((m) => m.id === resolution.milestone.id)!;

  return {
    workGraph: { ...workGraph, workUnits, milestones },
    workUnit,
    milestone,
    milestoneCreated: resolution.created,
  };
}
