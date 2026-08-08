import type { CommandContext } from "../command-context.js";
import type { CommandResult } from "../../core/output/result.js";
import { lookupExecutionGuidanceForCommand, buildValidationResult } from "./validation-shared.js";

/**
 * `aiqt validation select` (build spec Sec 9): read-only compact
 * recommended validation selection for the current bounded Work Unit/
 * change snapshot. Never mutates workflow state.
 */
export interface ValidationSelectOptions {
  workUnit?: string;
}

export function runValidationSelect(ctx: CommandContext, options: ValidationSelectOptions): CommandResult {
  const lookup = lookupExecutionGuidanceForCommand(ctx, options);
  if (!lookup.ok) return lookup.result;

  const { guidance } = lookup;
  const impact = guidance.validation.testImpact;
  const summary = impact
    ? `Recommended validation for "${guidance.workUnitId}": ${impact.summary.selectedCount} target(s) selected (${impact.summary.mandatoryCount} mandatory), ${impact.confidence} confidence, ${impact.escalation}.`
    : `Recommended validation for "${guidance.workUnitId}": ${guidance.validation.requiredNow.map((s) => s.tier).join(" + ") || "none"}.`;

  return buildValidationResult(guidance, summary);
}
