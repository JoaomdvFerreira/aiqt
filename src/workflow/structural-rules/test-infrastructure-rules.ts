import { join } from "node:path";
import type { StructuralFinding } from "../../schema/structural-review.schema.js";
import { buildStructuralFinding } from "../structural-finding-builder.js";
import { classifyAllTestFiles } from "../../tooling/test-inventory-classifier.js";

/**
 * Section 4.6: reuses M35's classifier directly (build spec: "Use M35/
 * M41 owners and live test evidence") -- no second test-classification
 * mechanism. Flags a process-spawning test file (git/CLI subprocess
 * usage) that carries no class-scoped timeout override as the
 * *structural* test-infrastructure hotspot class the recurring M39-M42
 * Windows load/timeout failures belong to -- this rule identifies the
 * architecture-level pattern (a process-heavy file with default
 * timeout budget), never an individual flaky test run, and never
 * classifies a timeout itself as a product defect (dogfood scenario 7).
 */
export function runProcessHeavyTestTimeoutRule(repoRoot: string, reviewCommit: string): StructuralFinding[] {
  const testsDir = join(repoRoot, "tests");
  const classified = classifyAllTestFiles(repoRoot, testsDir);

  const findings: StructuralFinding[] = [];
  for (const file of classified) {
    const isProcessHeavy = file.subprocessUsage.git || file.subprocessUsage.cli || file.subprocessUsage.builtBinary;
    const hasOverride = file.timeoutOverride.vitestSetConfig || file.timeoutOverride.inlinePerTest;
    if (!isProcessHeavy || hasOverride) continue;

    findings.push(
      buildStructuralFinding({
        domain: "test_infrastructure",
        ruleId: "process-heavy-test-no-timeout-override",
        title: `${file.path} spawns a process but carries no class-scoped timeout override`,
        explanation: `${file.path} is classified "${file.workloadClass}" (git=${file.subprocessUsage.git}, cli=${file.subprocessUsage.cli}, builtBinary=${file.subprocessUsage.builtBinary}) with no vi.setConfig/inline timeout override -- the structural pattern behind the recurring Windows load/timeout failure class, not evidence any specific run actually failed.`,
        reviewCommit,
        affectedPaths: [file.path],
        evidence: [
          { evidenceId: "WORKLOAD-CLASS", description: `workloadClass="${file.workloadClass}"`, locator: file.path },
          { evidenceId: "SUBPROCESS-USAGE", description: `git=${file.subprocessUsage.git} cli=${file.subprocessUsage.cli} builtBinary=${file.subprocessUsage.builtBinary}`, locator: file.path },
        ],
        confidence: "strong_signal",
        significance: "low",
        reasonCodes: ["PROCESS_HEAVY_NO_TIMEOUT_OVERRIDE"],
        disposition: "informational",
        eligibleForIntake: false,
        recommendedNextAction: "If this file exhibits real timeout flakiness under load, apply the shared tests/workload-timeout-policy.ts constants per M34 policy -- do not add a local literal.",
        evidenceSignature: `${file.path}::${file.workloadClass}`,
      }),
    );
  }
  return findings;
}
