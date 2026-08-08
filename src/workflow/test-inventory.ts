import { classifyAllTestFiles } from "../tooling/test-inventory-classifier.js";
import type { TestInventoryEntry, TestInventorySnapshot } from "../schema/test-impact.schema.js";

/**
 * M41-WU01 (build spec Sec 6.3): bounded, deterministic test-inventory
 * discovery. Reuses M35's classifyAllTestFiles (already deterministic --
 * static classification only, no test execution) rather than duplicating
 * a second discovery mechanism; only the fields M41 actually needs are
 * carried forward. `now` is injectable for deterministic tests.
 */
export function buildTestInventory(repoRoot: string, testsDir: string, now: () => string = () => new Date().toISOString()): TestInventorySnapshot {
  const classified = classifyAllTestFiles(repoRoot, testsDir);

  const entries: TestInventoryEntry[] = classified
    .map((c) => ({
      path: c.path,
      layer: c.layer,
      domain: c.domain,
      criticality: c.criticality,
      testCountStatic: c.testCountStatic,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return { generatedAt: now(), entries };
}
