/**
 * M41-WU05 (build spec Sec 11, "Efficiency and Quality Metrics"): pure,
 * honest efficiency arithmetic over already-computed TestImpactSelection
 * data -- mirrors execution-guidance-efficiency-evidence.ts's (M39-WU05)
 * "never a fabricated number" discipline. The naive baseline for a Work
 * Unit is "run the entire candidate inventory"; the actual number is
 * however many targets the selector actually chose.
 */

export interface TestSelectionEfficiencyInput {
  candidateCount: number;
  selectedCount: number;
}

export interface TestSelectionEfficiencyResult {
  candidateCount: number;
  selectedCount: number;
  /** 0 when there is nothing to reduce from (candidateCount == 0); never negative. */
  reductionRatio: number;
  meetsThirtyPercentTarget: boolean;
}

export function computeTestSelectionReduction(input: TestSelectionEfficiencyInput): TestSelectionEfficiencyResult {
  const { candidateCount, selectedCount } = input;
  if (candidateCount <= 0) {
    return { candidateCount, selectedCount, reductionRatio: 0, meetsThirtyPercentTarget: false };
  }
  const rawRatio = 1 - selectedCount / candidateCount;
  const reductionRatio = Math.max(0, rawRatio);
  return { candidateCount, selectedCount, reductionRatio, meetsThirtyPercentTarget: reductionRatio >= 0.3 };
}

export interface MultiWorkUnitFlowSample {
  workUnitId: string;
  candidateCount: number;
  selectedCount: number;
}

export interface MultiWorkUnitEfficiencyResult {
  totalCandidateExecutions: number;
  totalSelectedExecutions: number;
  reductionRatio: number;
  meetsThirtyPercentTarget: boolean;
  perWorkUnit: MultiWorkUnitFlowSample[];
}

/** Build spec Sec 11 target: "at least a 30% reduction in repeated or unrelated focused/impacted test execution on at least one representative multi-WU flow." */
export function computeMultiWorkUnitSelectionEfficiency(samples: readonly MultiWorkUnitFlowSample[]): MultiWorkUnitEfficiencyResult {
  const totalCandidateExecutions = samples.reduce((sum, s) => sum + s.candidateCount, 0);
  const totalSelectedExecutions = samples.reduce((sum, s) => sum + s.selectedCount, 0);
  const { reductionRatio, meetsThirtyPercentTarget } = computeTestSelectionReduction({
    candidateCount: totalCandidateExecutions,
    selectedCount: totalSelectedExecutions,
  });
  return { totalCandidateExecutions, totalSelectedExecutions, reductionRatio, meetsThirtyPercentTarget, perWorkUnit: [...samples] };
}
