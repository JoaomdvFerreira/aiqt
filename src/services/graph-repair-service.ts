import type { GraphValidationResult } from "./graph-validation-service.js";

export interface GraphRepairSuggestion {
  findingRule: string;
  dependencyId: string;
  recommendedCommand: string;
  confidence: "high" | "medium" | "low";
}

export interface GraphRepairPlan {
  wouldMutate: false;
  suggestions: GraphRepairSuggestion[];
  investigationGuidance: string[];
}

/**
 * M12 §8.4: read-only dry-run repair planning built from `aiqt graph
 * validate` findings. Only warnings with a single, unambiguous, deterministic
 * fix (currently: late-stage-relates-to, since relates_to -> blocks is the
 * one well-defined correction) become copy-paste-runnable
 * `aiqt dependency update` suggestions. Everything else -- broken references,
 * dependency cycles, stale readiness, mixed-inbound-dependency-types --
 * has more than one plausible fix and is surfaced as investigation guidance
 * only. Never mutates state, files, or runlog.
 */
export function buildGraphRepairPlan(validation: GraphValidationResult): GraphRepairPlan {
  const suggestions: GraphRepairSuggestion[] = [];
  const investigationGuidance: string[] = [];

  for (const warning of validation.warnings) {
    if (warning.rule === "late-stage-relates-to" && warning.dependencyId) {
      suggestions.push({
        findingRule: warning.rule,
        dependencyId: warning.dependencyId,
        recommendedCommand: `aiqt dependency update ${warning.dependencyId} --type blocks --reason "Late-stage relates_to dependency likely represents an unmodeled blocking prerequisite."`,
        confidence: "medium",
      });
      continue;
    }
    investigationGuidance.push(`[${warning.rule}] ${warning.message}`);
  }

  for (const error of validation.blockingErrors) {
    investigationGuidance.push(`[${error.rule}] ${error.message}`);
  }

  return { wouldMutate: false, suggestions, investigationGuidance };
}
