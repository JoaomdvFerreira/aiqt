#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAllTestFiles, loadRunJson } from "./test-inventory-classifier.js";

/**
 * M35-WU01 (build spec Sec 7, WU35-01): CLI wrapper around
 * test-inventory-classifier.ts's pure classification logic. Writes the
 * machine-readable inventory docs/engineering/m35-test-suite-inventory.md
 * references. Runtime figures (duration, actual test counts) are
 * optionally merged in from a vitest --reporter=json run, passed via
 * --run-json=<path>. Without that flag, produces full static
 * classification with runtime fields left null.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const testsDir = join(repoRoot, "tests");

function main(): void {
  const runJsonArg = process.argv.find((a) => a.startsWith("--run-json="));
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const runJsonPath = runJsonArg ? runJsonArg.slice("--run-json=".length) : undefined;
  const outPath = outArg ? outArg.slice("--out=".length) : join(repoRoot, "docs", "engineering", "m35-test-suite-inventory.generated.json");

  const runJson = loadRunJson(runJsonPath);
  const rows = classifyAllTestFiles(repoRoot, testsDir, runJson);

  const summary = {
    generatedAt: new Date().toISOString(),
    totalFiles: rows.length,
    totalTestsStatic: rows.reduce((a, r) => a + r.testCountStatic, 0),
    totalTestsActual: runJson.size > 0 ? rows.reduce((a, r) => a + (r.testCountActual ?? 0), 0) : null,
    byLayer: {
      unit: rows.filter((r) => r.layer === "unit").length,
      integration: rows.filter((r) => r.layer === "integration").length,
    },
    byWorkloadClass: Object.fromEntries(
      [...new Set(rows.map((r) => r.workloadClass))].map((c) => [c, rows.filter((r) => r.workloadClass === c).length]),
    ),
    byCriticality: Object.fromEntries(
      [...new Set(rows.map((r) => r.criticality))].map((c) => [c, rows.filter((r) => r.criticality === c).length]),
    ),
    byDomain: Object.fromEntries(
      [...new Set(rows.map((r) => r.domain))].map((d) => [d, rows.filter((r) => r.domain === d).length]),
    ),
    skippedOrConditionalFiles: rows.filter((r) => r.hasSkippedOrConditional).map((r) => r.path),
    platformGuardedFiles: rows.filter((r) => r.hasPlatformGuard).map((r) => r.path),
  };

  writeFileSync(outPath, JSON.stringify({ summary, files: rows }, null, 2), "utf8");
  console.log(`Wrote ${rows.length} classified test files to ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
