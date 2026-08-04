import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAllTestFiles } from "../../src/tooling/test-inventory-classifier.js";

/**
 * M35-WU01: architecture guard proving every tests/**\/*.test.ts file is
 * classified (build spec Sec 9, "every test file is classified") -- not a
 * timing measurement, not a duplicate/obsolete verdict. Runs the same pure
 * classifier docs/engineering/m35-test-suite-inventory.md is generated
 * from, with no vitest --reporter=json input (runtime fields stay null),
 * so this guard never depends on a fresh, potentially machine-load-
 * sensitive full-suite run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const testsDir = join(repoRoot, "tests");

function countTestFilesOnDisk(dir: string, count = 0): number {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) count = countTestFilesOnDisk(full, count);
    else if (entry.endsWith(".test.ts")) count += 1;
  }
  return count;
}

describe("M35-WU01: every test file receives a full classification", () => {
  const rows = classifyAllTestFiles(repoRoot, testsDir);

  it("classifies exactly as many files as exist on disk under tests/ (no file silently skipped)", () => {
    expect(rows.length).toBe(countTestFilesOnDisk(testsDir));
  });

  it("every file has a non-empty workload class, domain, and criticality", () => {
    const incomplete = rows.filter(
      (r) => !r.workloadClass || !r.domain || !r.criticality,
    );
    expect(incomplete.map((r) => r.path)).toEqual([]);
  });

  it("every file's criticality is one of the build spec's 9 recognized classes", () => {
    const VALID = new Set([
      "Critical",
      "High-value",
      "Normal",
      "Low-signal",
      "Duplicate",
      "Obsolete",
      "Misplaced",
      "Flaky",
      "Performance-heavy",
    ]);
    const invalid = rows.filter((r) => !VALID.has(r.criticality));
    expect(invalid.map((r) => ({ path: r.path, criticality: r.criticality }))).toEqual([]);
  });

  it("no file is classified into the fallback 'uncategorized' domain (every file matched a real rule)", () => {
    const uncategorized = rows.filter((r) => r.domain === "uncategorized");
    expect(
      uncategorized.map((r) => r.path),
      "A test file matched none of the domain-classification rules in test-inventory-classifier.ts. " +
        "Add a rule for it (or its new naming pattern) as part of a reviewed change -- do not let a " +
        "file silently fall through to 'uncategorized'.",
    ).toEqual([]);
  });

  it("the confirmed WU35-01 baseline has zero skipped or conditional tests", () => {
    const skipped = rows.filter((r) => r.hasSkippedOrConditional);
    expect(
      skipped.map((r) => r.path),
      "A test file now uses it.skip/describe.skip/it.todo/skipIf. The WU35-01 baseline recorded " +
        "zero such files (build spec Sec 4, 'zero skipped tests'). If this is intentional, update " +
        "docs/engineering/m35-test-suite-inventory.md Sec 3 deliberately -- it must not drift silently.",
    ).toEqual([]);
  });

  it("the confirmed WU35-01 baseline's one platform-guarded file is unchanged", () => {
    const guarded = rows.filter((r) => r.hasPlatformGuard).map((r) => r.path).sort();
    expect(guarded).toEqual(["tests/unit/prompt-out-path.test.ts"]);
  });

  it("the critical-coverage domains from the build spec's minimum list are all non-empty", () => {
    const REQUIRED_CRITICAL_DOMAINS = [
      "canonical-state",
      "schema-compatibility",
      "persistence-runlog",
      "workflow-assessment",
      "corruption-repair",
      "cli-machine-contract",
      "built-binary",
      "security-boundary",
      "git-worktree-safety",
      "evidence-binding",
      "execution-lifecycle",
    ];
    const byDomain = new Map<string, number>();
    for (const r of rows) byDomain.set(r.domain, (byDomain.get(r.domain) ?? 0) + 1);
    const empty = REQUIRED_CRITICAL_DOMAINS.filter((d) => !byDomain.get(d));
    expect(
      empty,
      "A domain the build spec names as required critical coverage has zero classified files. " +
        "This would mean that coverage area silently lost all its test files.",
    ).toEqual([]);
  });
});
