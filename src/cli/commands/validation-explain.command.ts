import type { CommandContext } from "../command-context.js";
import type { CommandResult } from "../../core/output/result.js";
import { lookupExecutionGuidanceForCommand, buildValidationResult } from "./validation-shared.js";
import { renderTestImpactExplain } from "../../workflow/execution-guidance-render.js";

/**
 * `aiqt validation explain` (build spec Sec 9): the richer view -- per-
 * target reason codes/text and evidence gaps -- without mutating
 * workflow state. `data.testImpact` is identical to `select`'s; only the
 * human-mode rendering (and this command's `data.explain` text) differs,
 * keeping human/JSON substantively aligned (build spec Sec 6.2).
 */
export interface ValidationExplainOptions {
  workUnit?: string;
}

export function runValidationExplain(ctx: CommandContext, options: ValidationExplainOptions): CommandResult {
  const lookup = lookupExecutionGuidanceForCommand(ctx, options);
  if (!lookup.ok) return lookup.result;

  const { guidance } = lookup;
  const explainText = renderTestImpactExplain(guidance);
  const result = buildValidationResult(guidance, `Test-impact explanation for "${guidance.workUnitId}".`);
  return { ...result, data: { ...(result.data as object), explain: explainText } };
}
