/**
 * M39-WU05 (build spec Sec 8, "Evidence"): pure, honest efficiency-evidence
 * arithmetic over already-computed `ExecutionGuidance`/checkpoint data --
 * never a fabricated number, never a provider/billing call. Missing
 * provider telemetry stays outside scope entirely (there is none to
 * report); this module only derives ratios from data AIQT already
 * computed for its own guidance.
 */

export interface ContextFootprintComparison {
  /** Estimated tokens a naive, non-continuation-aware repeat would require (e.g. re-including a dependency's full context as this Work Unit's own must/should-read set). */
  baselineEstimatedTokens: number;
  /** Estimated tokens actually recommended (real `ExecutionGuidance.context.estimatedTokens`). */
  actualEstimatedTokens: number;
}

export interface ContextFootprintReductionResult {
  baselineEstimatedTokens: number;
  actualEstimatedTokens: number;
  /** 0 when there is nothing to reduce from (baseline == 0); never negative -- a caller passing a smaller baseline than actual gets 0, not a fabricated negative "reduction". */
  reductionRatio: number;
  meetsThirtyPercentTarget: boolean;
}

/** Honest ratio, not a target-seeking calculation: reports whatever the real numbers say, including below the build spec's informal 30% target. */
export function computeContextFootprintReduction(input: ContextFootprintComparison): ContextFootprintReductionResult {
  const { baselineEstimatedTokens, actualEstimatedTokens } = input;
  if (baselineEstimatedTokens <= 0) {
    return { baselineEstimatedTokens, actualEstimatedTokens, reductionRatio: 0, meetsThirtyPercentTarget: false };
  }
  const rawRatio = 1 - actualEstimatedTokens / baselineEstimatedTokens;
  const reductionRatio = Math.max(0, rawRatio);
  return {
    baselineEstimatedTokens,
    actualEstimatedTokens,
    reductionRatio,
    meetsThirtyPercentTarget: reductionRatio >= 0.3,
  };
}

/** Bounded checkpoint-text size (summary + filesChanged + open issue titles) vs. the actual capsule's own bounded output, both measured in characters -- the concrete, honest proxy for "continuation must not become a raw session/log dump." */
export interface ContinuationCompactnessInput {
  rawUpstreamCheckpointCharCount: number;
  capsuleCharCount: number;
}

export function computeContinuationCompactness(input: ContinuationCompactnessInput): number {
  if (input.rawUpstreamCheckpointCharCount <= 0) return 0;
  return Math.max(0, 1 - input.capsuleCharCount / input.rawUpstreamCheckpointCharCount);
}
