import { TEST_IMPACT_SELECTION_VERSION } from "../schema/test-impact.schema.js";
import type {
  SelectedTestTarget,
  TestImpactConfidence,
  TestImpactEvidenceGap,
  TestImpactInput,
  TestImpactReasonCode,
  TestImpactSelection,
  TestEscalationOutcome,
  TestTarget,
} from "../schema/test-impact.schema.js";
import { buildMandatoryTargets, buildTestFileTarget, computeTestImpactInputDigest, testFileTargetId } from "./test-impact-input.js";
import { detectBroadBlastRadius } from "./test-impact-blast-radius.js";

/**
 * M41-WU02 (build spec Sec 7.1): the single deterministic selection
 * owner. Precedence, in order, never letting a lower-priority signal
 * remove a higher-priority one:
 *   1. mandatory explicit validation requirements
 *   2. directly changed/runnable tests
 *   3. scoped/changed-path naming-convention evidence (medium confidence
 *      -- this repository has no real dependency graph; a stem-match
 *      heuristic is the only bounded, deterministic path evidence
 *      available without a heavyweight coverage/dependency engine,
 *      which build spec Sec 4 explicitly rules out)
 *   4. unresolved prior relevant failures (basic promotion; WU41-04 adds
 *      staleness/trust filtering upstream of this function)
 *   5. broad-blast-radius fallback -- escalates to full, never silently
 *      narrows an ambiguous case.
 */

function sourceStem(path: string): string | null {
  const m = /([^/]+)\.(?:ts|tsx|js)$/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

function testStem(path: string): string {
  const m = /([^/]+)\.test\.ts$/.exec(path);
  return (m ? m[1] : path).toLowerCase();
}

function stemMatches(candidateTestStem: string, changedSourceStem: string): boolean {
  return candidateTestStem === changedSourceStem || candidateTestStem.startsWith(`${changedSourceStem}-`) || candidateTestStem.startsWith(`${changedSourceStem}.`);
}

class SelectionAccumulator {
  private readonly byId = new Map<string, SelectedTestTarget>();
  private nextOrder = 0;

  add(target: TestTarget, mandatory: boolean, reasonCode: TestImpactReasonCode, reasonText: string): void {
    const existing = this.byId.get(target.id);
    if (existing) {
      if (!existing.reasonCodes.includes(reasonCode)) existing.reasonCodes.push(reasonCode);
      existing.reasons.push(reasonText);
      if (mandatory) existing.mandatory = true;
      return;
    }
    this.byId.set(target.id, { target, order: this.nextOrder++, mandatory, reasonCodes: [reasonCode], reasons: [reasonText] });
  }

  values(): SelectedTestTarget[] {
    return [...this.byId.values()].sort((a, b) => a.order - b.order);
  }
}

export function selectTestImpact(input: TestImpactInput): TestImpactSelection {
  const evidenceGaps: TestImpactEvidenceGap[] = [];
  const accumulator = new SelectionAccumulator();

  // 1. mandatory explicit validation requirements.
  for (const target of buildMandatoryTargets(input)) {
    accumulator.add(target, true, "explicit_requirement", `Explicit validation requirement: "${target.locator}".`);
  }

  const inventoryByPath = new Map(input.inventory.entries.map((e) => [e.path, e] as const));

  // 2. directly changed/runnable tests.
  for (const changed of input.changedFiles) {
    const entry = inventoryByPath.get(changed);
    if (entry) {
      accumulator.add(buildTestFileTarget(entry), false, "changed_test", `"${changed}" is itself a changed, runnable test file.`);
    }
  }

  // 3. scoped/changed-path naming-convention evidence.
  const candidateSourcePaths = [...new Set([...input.scopedFiles, ...input.changedFiles])].filter((p) => !inventoryByPath.has(p));
  let anyUnmatchedSource = false;
  for (const sourcePath of candidateSourcePaths) {
    const stem = sourceStem(sourcePath);
    if (!stem) {
      evidenceGaps.push({ code: "UNSUPPORTED-PATH-SHAPE", message: `"${sourcePath}" is not a recognizable source file; impact could not be bounded by path evidence.` });
      anyUnmatchedSource = true;
      continue;
    }
    const matches = input.inventory.entries.filter((e) => stemMatches(testStem(e.path), stem));
    if (matches.length === 0) {
      evidenceGaps.push({ code: "NO-CONVENTION-MATCH", message: `No naming-convention test match found for "${sourcePath}"; impact could not be bounded by path evidence alone.` });
      anyUnmatchedSource = true;
      continue;
    }
    for (const m of matches) {
      accumulator.add(buildTestFileTarget(m), false, "scoped_file_match", `"${m.path}" name-matches changed/scoped source "${sourcePath}".`);
    }
  }

  // 4. unresolved prior relevant failures (basic promotion).
  for (const fb of input.priorFeedback) {
    if (fb.outcome !== "failed") continue;
    const entry = [...inventoryByPath.values()].find((e) => testFileTargetId(e.path) === fb.targetId);
    if (entry) {
      accumulator.add(buildTestFileTarget(entry), false, "prior_relevant_failure", `Prior relevant failure for work unit "${fb.workUnitId}" (source: ${fb.evidenceSource}).`);
    }
  }

  // 5. broad-blast-radius escalation.
  const blast = detectBroadBlastRadius([...input.scopedFiles, ...input.changedFiles]);

  const selectedTargets = accumulator.values();
  const mandatoryTargetIds = selectedTargets.filter((t) => t.mandatory).map((t) => t.target.id);

  let confidence: TestImpactConfidence;
  let escalation: TestEscalationOutcome;
  let recommendedTier: string;
  let fullSuiteDeferred = true;
  let fullSuiteDeferredReason: string | null =
    "Deferred to milestone closure per milestone-protocol.md Sec 4; ordinary Work Units must not default to full.";

  if (blast.escalate) {
    evidenceGaps.push(...blast.reasons.map((r) => ({ code: "BROAD-BLAST-RADIUS", message: r })));
    confidence = "low";
    escalation = "full_required";
    recommendedTier = "full";
    fullSuiteDeferred = false;
    fullSuiteDeferredReason = null;
  } else if (anyUnmatchedSource) {
    confidence = selectedTargets.length > mandatoryTargetIds.length ? "medium" : "low";
    escalation = "broaden_required";
    recommendedTier = "impacted";
  } else if (selectedTargets.length === 0) {
    confidence = "low";
    escalation = "insufficient_evidence";
    recommendedTier = "focused";
  } else {
    confidence = "high";
    escalation = candidateSourcePaths.length > 0 ? "selected_impacted" : "selected_focused";
    recommendedTier = candidateSourcePaths.length > 0 ? "impacted" : "focused";
  }

  return {
    selectionVersion: TEST_IMPACT_SELECTION_VERSION,
    inputDigest: computeTestImpactInputDigest(input),
    selectedTargets,
    mandatoryTargetIds,
    recommendedTier,
    confidence,
    escalation,
    evidenceGaps,
    fullSuiteDeferred,
    fullSuiteDeferredReason,
    summary: {
      candidateCount: input.inventory.entries.length,
      selectedCount: selectedTargets.length,
      mandatoryCount: mandatoryTargetIds.length,
    },
  };
}
