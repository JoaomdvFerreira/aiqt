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
  let classified: ReturnType<typeof classifyAllTestFiles>;
  try {
    classified = classifyAllTestFiles(repoRoot, testsDir);
  } catch {
    // Build spec Sec 6.3: "fail clearly when runner/project structure is
    // unsupported rather than fabricate mappings" -- for an advisory
    // caller (execution guidance must never block), "clearly" means an
    // honestly empty inventory, which the selector already turns into a
    // real evidence gap / broadened recommendation, not a silent pass.
    classified = [];
  }

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
