import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestInventory } from "../../src/workflow/test-inventory.js";
import {
  buildMandatoryTargets,
  buildTestFileTarget,
  buildValidationCommandTarget,
  computeTestImpactInputDigest,
  testFileTargetId,
  validationCommandTargetId,
} from "../../src/workflow/test-impact-input.js";
import type { TestImpactInput, TestInventorySnapshot } from "../../src/schema/test-impact.schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const testsDir = join(repoRoot, "tests");

describe("buildTestInventory: bounded, deterministic discovery (M41-WU01)", () => {
  it("is deterministic for the same repository snapshot", () => {
    const a = buildTestInventory(repoRoot, testsDir, () => "2026-01-01T00:00:00.000Z");
    const b = buildTestInventory(repoRoot, testsDir, () => "2026-01-01T00:00:00.000Z");
    expect(a).toEqual(b);
  });

  it("includes this very test file, with bounded fields only (no file content)", () => {
    const inventory = buildTestInventory(repoRoot, testsDir);
    const self = inventory.entries.find((e) => e.path === "tests/unit/test-inventory-impact.test.ts");
    expect(self).toBeDefined();
    expect(self?.layer).toBe("unit");
    expect(typeof self?.domain).toBe("string");
    expect(typeof self?.testCountStatic).toBe("number");
  });

  it("entries are stably sorted by path", () => {
    const inventory = buildTestInventory(repoRoot, testsDir);
    const paths = inventory.entries.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
  });
});

describe("target-id construction and mandatory targets (M41-WU01, build spec Sec 5.2)", () => {
  it("test-file and validation-command target ids are stable and kind-prefixed", () => {
    expect(testFileTargetId("tests/unit/foo.test.ts")).toBe("test_file:tests/unit/foo.test.ts");
    expect(validationCommandTargetId("pnpm typecheck")).toBe("validation_command:pnpm typecheck");
  });

  it("buildTestFileTarget/buildValidationCommandTarget carry the expected kind and locator", () => {
    const fileTarget = buildTestFileTarget({ path: "tests/unit/foo.test.ts", layer: "unit", domain: "d", criticality: "Normal" });
    expect(fileTarget.kind).toBe("test_file");
    expect(fileTarget.locator).toBe("tests/unit/foo.test.ts");

    const cmdTarget = buildValidationCommandTarget("pnpm typecheck");
    expect(cmdTarget.kind).toBe("validation_command");
    expect(cmdTarget.locator).toBe("pnpm typecheck");
    expect(cmdTarget.layer).toBeNull();
  });

  it("every explicit validation command becomes a mandatory target -- nothing is dropped", () => {
    const targets = buildMandatoryTargets({ explicitValidationCommands: ["pnpm typecheck", "pnpm lint", "vitest run tests/unit/foo.test.ts"] });
    expect(targets).toHaveLength(3);
    expect(targets.map((t) => t.locator)).toEqual(["pnpm typecheck", "pnpm lint", "vitest run tests/unit/foo.test.ts"]);
  });

  it("no explicit commands means no mandatory targets (never fabricated)", () => {
    expect(buildMandatoryTargets({ explicitValidationCommands: [] })).toEqual([]);
  });
});

describe("computeTestImpactInputDigest: deterministic canonical digest (M41-WU01, build spec Sec 6.2)", () => {
  const emptyInventory: TestInventorySnapshot = { generatedAt: "2026-01-01T00:00:00.000Z", entries: [] };

  const baseInput: TestImpactInput = {
    workUnitId: "wu-1",
    scopedFiles: ["src/a.ts", "src/b.ts"],
    changedFiles: ["src/a.ts"],
    explicitValidationCommands: ["pnpm typecheck"],
    inventory: emptyInventory,
    priorFeedback: [],
  };

  it("produces an identical digest for identical canonical inputs", () => {
    const d1 = computeTestImpactInputDigest(baseInput);
    const d2 = computeTestImpactInputDigest({ ...baseInput });
    expect(d1).toBe(d2);
    expect(d1).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of scopedFiles/changedFiles array order (canonically sorted)", () => {
    const reordered: TestImpactInput = { ...baseInput, scopedFiles: ["src/b.ts", "src/a.ts"] };
    expect(computeTestImpactInputDigest(baseInput)).toBe(computeTestImpactInputDigest(reordered));
  });

  it("changes when any bound fact changes", () => {
    const changed: TestImpactInput = { ...baseInput, changedFiles: ["src/c.ts"] };
    expect(computeTestImpactInputDigest(baseInput)).not.toBe(computeTestImpactInputDigest(changed));
  });
});
