import { AiqtError } from "../core/output/aiqt-error.js";
import { ExitCode } from "../core/output/exit-codes.js";
import type { WorkUnit } from "../schema/work-unit.schema.js";
import type { Milestone } from "../schema/milestone.schema.js";
import type { StateModel } from "../schema/state.schema.js";

function nonEmptyList(items: readonly string[]): boolean {
  return items.some((item) => item.trim() !== "");
}

function qualityError(workUnitId: string, message: string): AiqtError {
  return new AiqtError(message, ExitCode.ValidationFailed, {
    id: "NEXT-HANDOFF-GATE-FAILED",
    severity: "high",
    area: "workflow",
    message,
    affectedItems: [workUnitId],
    agentCanFix: false,
  });
}

function structuralError(workUnitId: string, message: string): AiqtError {
  return new AiqtError(message, ExitCode.InvalidInput, {
    id: "NEXT-INVALID-WORK-GRAPH-REFERENCE",
    severity: "critical",
    area: "state",
    message,
    affectedItems: [workUnitId],
    agentCanFix: false,
  });
}

/**
 * The agent handoff gate: prevents AIQT from producing vague or unsafe
 * packets. Content/quality failures (missing title, empty scope, etc.)
 * throw with exit code 1. Structural/referential failures (unknown
 * milestone or dependency ids) throw with exit code 3. Both leave state
 * unmutated; the caller is responsible for not applying any partial
 * mutation before this gate passes.
 */
export function runAgentHandoffGate(
  workUnit: WorkUnit,
  milestone: Milestone | null,
  state: StateModel,
): void {
  if (workUnit.status !== "ready") {
    throw qualityError(
      workUnit.id,
      `Work unit "${workUnit.id}" is not ready for handoff (status: ${workUnit.status}).`,
    );
  }
  if (workUnit.title.trim() === "") {
    throw qualityError(workUnit.id, `Work unit "${workUnit.id}" has an empty title.`);
  }
  if (workUnit.objective.trim() === "") {
    throw qualityError(workUnit.id, `Work unit "${workUnit.id}" has an empty objective.`);
  }
  if (!nonEmptyList(workUnit.scope)) {
    throw qualityError(workUnit.id, `Work unit "${workUnit.id}" has no scope items.`);
  }
  if (!nonEmptyList(workUnit.outOfScope)) {
    throw qualityError(workUnit.id, `Work unit "${workUnit.id}" has no outOfScope items.`);
  }
  if (!nonEmptyList(workUnit.acceptanceCriteria)) {
    throw qualityError(
      workUnit.id,
      `Work unit "${workUnit.id}" has no acceptance criteria.`,
    );
  }
  if (!nonEmptyList(workUnit.validationCommands)) {
    throw qualityError(
      workUnit.id,
      `Work unit "${workUnit.id}" has no validation commands.`,
    );
  }

  if (!milestone || milestone.id !== workUnit.milestoneId) {
    throw structuralError(
      workUnit.id,
      `Work unit "${workUnit.id}" references an unknown milestone "${workUnit.milestoneId}".`,
    );
  }
  for (const depId of workUnit.dependencies) {
    if (!state.workGraph.dependencies.some((d) => d.id === depId)) {
      throw structuralError(
        workUnit.id,
        `Work unit "${workUnit.id}" references an unknown dependency "${depId}".`,
      );
    }
  }
}
