import { computeCanonicalPayloadDigest } from "../schema/external-evidence/canonical-json.js";
import type { TestImpactInput, TestTarget } from "../schema/test-impact.schema.js";

/**
 * M41-WU01 (build spec Sec 5.2, 6.1): target-id construction, mandatory-
 * target derivation, and the deterministic canonical input digest. Pure,
 * I/O-free -- callers resolve Git/inventory facts and pass them in.
 */

export function testFileTargetId(path: string): string {
  return `test_file:${path}`;
}

export function validationCommandTargetId(command: string): string {
  return `validation_command:${command}`;
}

export function buildTestFileTarget(entry: { path: string; layer: "unit" | "integration"; domain: string; criticality: string }): TestTarget {
  return {
    id: testFileTargetId(entry.path),
    kind: "test_file",
    locator: entry.path,
    layer: entry.layer,
    domain: entry.domain,
    criticality: entry.criticality,
  };
}

export function buildValidationCommandTarget(command: string): TestTarget {
  return {
    id: validationCommandTargetId(command),
    kind: "validation_command",
    locator: command,
    layer: null,
    domain: null,
    criticality: null,
  };
}

/**
 * Every explicit validationCommand is mandatory by construction (build
 * spec Sec 5.2: "explicit required tests/commands are never removed by
 * the selector"). This is the only source of mandatory targets in
 * WU41-01 -- WU41-02 adds structural/dependency-derived selection on top,
 * never instead.
 */
export function buildMandatoryTargets(input: Pick<TestImpactInput, "explicitValidationCommands">): TestTarget[] {
  return input.explicitValidationCommands.map(buildValidationCommandTarget);
}

/** Deterministic for identical canonical inputs (build spec Sec 6.2 "inputDigest"). */
export function computeTestImpactInputDigest(input: TestImpactInput): string {
  return computeCanonicalPayloadDigest({
    workUnitId: input.workUnitId,
    scopedFiles: [...input.scopedFiles].sort(),
    changedFiles: [...input.changedFiles].sort(),
    explicitValidationCommands: input.explicitValidationCommands,
    inventoryPaths: input.inventory.entries.map((e) => e.path),
    priorFeedback: input.priorFeedback.map((f) => ({
      targetId: f.targetId,
      outcome: f.outcome,
      workUnitId: f.workUnitId,
      changeIdentity: f.changeIdentity,
    })),
  });
}
