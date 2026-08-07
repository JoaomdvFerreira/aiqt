import type { ExecutionGuidance } from "../schema/execution-guidance.schema.js";

/**
 * M39-WU03 (build spec Sec 9, "aiqt next" example block): pure rendering
 * helpers for the shared ExecutionGuidance contract. No command wiring
 * happens here -- `aiqt next`/`aiqt next --preview` calling these
 * functions is later Work-Unit integration (build spec Sec 9 assigns
 * packet integration to WU39-04). These functions exist so that
 * rendering logic is not duplicated per surface once that wiring lands:
 * a human-output renderer and a prompt-driver note both call the same
 * two functions below rather than each formatting `ExecutionGuidance`
 * independently.
 */

function contextCounts(guidance: ExecutionGuidance): { mustRead: number; shouldRead: number; referenceOnly: number } {
  let mustRead = 0;
  let shouldRead = 0;
  let referenceOnly = 0;
  for (const item of guidance.context.items) {
    if (item.priority === "must_read") mustRead += 1;
    else if (item.priority === "should_read") shouldRead += 1;
    else referenceOnly += 1;
  }
  return { mustRead, shouldRead, referenceOnly };
}

function formatConfigured(guidance: ExecutionGuidance): string {
  const concrete = guidance.agent.concreteRecommendation;
  if (!concrete) return "none (generic guidance only)";
  return `${concrete.agent} / ${concrete.model ?? "unspecified"} / ${concrete.effort ?? "unspecified"}`;
}

function formatDeferred(guidance: ExecutionGuidance): string {
  if (guidance.validation.deferred.length === 0) return "none";
  const tiers = guidance.validation.deferred.map((step) => step.tier).join(", ");
  return `${tiers} -> ${guidance.validation.fullSuiteRequiredAt}`;
}

/**
 * Renders the exact compact block shape from the build spec's Sec 9
 * "aiqt next" example. Never embeds context item paths/reasons or
 * validation reasons -- those stay in the structured `ExecutionGuidance`
 * object for a `--json` caller; this is the concise human summary only.
 */
export function renderExecutionGuidanceHuman(guidance: ExecutionGuidance): string {
  const counts = contextCounts(guidance);
  const lines = [
    "Execution Guidance",
    `Complexity: ${guidance.complexity.value}`,
    `Reasoning: ${guidance.agent.reasoningEffort}`,
    `Agent class: ${guidance.agent.recommendedClass}`,
    `Configured: ${formatConfigured(guidance)}`,
    `Context: ${counts.mustRead} must-read, ${counts.shouldRead} should-read, ${counts.referenceOnly} reference-only`,
    `Validation now: ${guidance.validation.requiredNow.map((step) => step.tier).join(" + ") || "none"}`,
    `Deferred: ${formatDeferred(guidance)}`,
    `Subagents: ${guidance.subagents.mode}`,
    `Output: ${guidance.output.passingCommandDetail === "summary" ? "summarize success" : guidance.output.passingCommandDetail}; retain detailed failures`,
  ];
  return lines.join("\n");
}

/**
 * One short instruction line for a prompt-driver surface (build spec Sec
 * 9, "Prompt/autonomous integration"): tells the agent to follow the
 * generated guidance and expand context only on evidence of
 * insufficiency, never to re-investigate broadly by default.
 */
export function renderExecutionGuidancePromptNote(guidance: ExecutionGuidance): string {
  return (
    `Follow the generated Execution Guidance for this Work Unit ` +
    `(complexity: ${guidance.complexity.value}, reasoning: ${guidance.agent.reasoningEffort}). ` +
    `Expand context beyond the listed must-read/should-read items only when evidence shows it is insufficient; ` +
    `do not re-investigate the repository broadly by default.`
  );
}
