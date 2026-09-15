import type { CommandContext } from "../command-context.js";
import { makeResult, familyFailureResult, type CommandResult } from "../../core/output/result.js";
import { ExitCode } from "../../core/output/exit-codes.js";
import { aiqtDirExists, loadProject } from "./load-project.js";
import { buildExecutionGuidanceForWorkUnit } from "./next-selection-helpers.js";
import type { ExecutionGuidance } from "../../schema/execution-guidance.schema.js";

/**
 * M41-WU03 (build spec Sec 9): shared read-only lookup for `aiqt
 * validation select`/`explain`. Reuses the exact same
 * buildExecutionGuidanceForWorkUnit `next`/`next --preview` already call
 * -- one selection owner, no second signal-gathering path, so a Work
 * Unit's `aiqt validation select` output and its `aiqt next --preview`
 * guidance can never disagree.
 */
export interface ValidationLookupOptions {
  workUnit?: string;
}

export type ValidationLookupOutcome = { ok: true; guidance: ExecutionGuidance } | { ok: false; result: CommandResult };

export function validationFailure(summary: string, exitCode: number, issueId: string): CommandResult {
  return familyFailureResult({ action: "validation", area: "validation", summary, exitCode, issueId });
}

export function lookupExecutionGuidanceForCommand(ctx: CommandContext, options: ValidationLookupOptions): ValidationLookupOutcome {
  if (!options.workUnit) {
    return { ok: false, result: validationFailure("aiqt validation select/explain requires --work-unit <id>.", ExitCode.HumanInputRequired, "VALIDATION-NO-WORK-UNIT") };
  }
  if (!aiqtDirExists(ctx)) {
    return { ok: false, result: validationFailure("No AIQT project found. Run aiqt init to create the canonical state files.", ExitCode.InvalidInput, "VALIDATION-NO-PROJECT") };
  }
  const { paths, project, state } = loadProject(ctx);
  const workUnit = state.workGraph.workUnits.find((w) => w.id === options.workUnit);
  if (!workUnit) {
    return { ok: false, result: validationFailure(`No Work Unit "${options.workUnit}" exists.`, ExitCode.InvalidInput, "VALIDATION-WORK-UNIT-NOT-FOUND") };
  }
  const guidance = buildExecutionGuidanceForWorkUnit(workUnit, paths.root, state, project.project.existingRepositoryPath);
  return { ok: true, guidance };
}

/** Compact result envelope shared by both commands (read-only, never mutates workflow state). */
export function buildValidationResult(guidance: ExecutionGuidance, summary: string): CommandResult {
  const impact = guidance.validation.testImpact;
  return makeResult({
    status: "passed",
    action: "validation",
    summary,
    exitCode: ExitCode.Success,
    data: {
      workUnitId: guidance.workUnitId,
      requiredNow: guidance.validation.requiredNow,
      deferred: guidance.validation.deferred,
      fullSuiteRequiredAt: guidance.validation.fullSuiteRequiredAt,
      testImpact: impact,
    },
  });
}
