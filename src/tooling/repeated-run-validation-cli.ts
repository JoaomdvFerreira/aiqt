#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * M34-WU03 (build spec Sec 5.5/6.5): runs the official full test command
 * (`vitest run`, exactly what `pnpm test` invokes) N times consecutively
 * and reports per-run pass/fail plus a failure-class breakdown (timeout vs.
 * assertion vs. other), so "5 consecutive clean runs" is evidence this tool
 * produces rather than a manually-repeated command. Exits 0 only if every
 * run passed; exits 1 otherwise, printing which runs failed and why.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const vitestEntry = join(repoRoot, "node_modules", "vitest", "vitest.mjs");

interface RunResult {
  run: number;
  passed: boolean;
  durationMs: number;
  timeoutFailures: number;
  assertionFailures: number;
  otherFailureLines: string[];
}

function classifyFailures(output: string): { timeoutFailures: number; assertionFailures: number; otherFailureLines: string[] } {
  const timeoutFailures = (output.match(/Test timed out in \d+ms/g) ?? []).length;
  const assertionFailures = (output.match(/AssertionError/g) ?? []).length;
  const otherFailureLines: string[] = [];
  const failLineRe = /^\s*(?:FAIL|×|✗)\s.+$/gm;
  for (const match of output.matchAll(failLineRe)) {
    const line = match[0];
    if (!/Test timed out/.test(line) && !/AssertionError/.test(line)) {
      otherFailureLines.push(line.trim());
    }
  }
  return { timeoutFailures, assertionFailures, otherFailureLines };
}

// Written outside the repository (never under .aiqt/ or repoRoot) so this
// tooling cannot be mistaken for AIQT self-management state.
const logDir = join(tmpdir(), "aiqt-repeated-run-validation-logs");

function runOnce(run: number): RunResult {
  const start = Date.now();
  const res = spawnSync(process.execPath, [vitestEntry, "run"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Date.now() - start;
  const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const passed = res.status === 0;
  const { timeoutFailures, assertionFailures, otherFailureLines } = classifyFailures(output);
  if (!passed) {
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `run-${run}-${Date.now()}.log`);
    writeFileSync(logPath, output, "utf8");
    console.log(`  (full output saved to ${logPath})`);
  }
  return { run, passed, durationMs, timeoutFailures, assertionFailures, otherFailureLines };
}

function main(): void {
  const runsArg = process.argv.find((a) => a.startsWith("--runs="));
  const totalRuns = runsArg ? Number.parseInt(runsArg.slice("--runs=".length), 10) : 5;
  if (!Number.isInteger(totalRuns) || totalRuns < 1) {
    console.error(`Invalid --runs value: ${runsArg}`);
    process.exit(2);
  }

  console.log(`M34-WU03 repeated-run validation: ${totalRuns} consecutive run(s) of \`vitest run\`\n`);

  const results: RunResult[] = [];
  for (let i = 1; i <= totalRuns; i++) {
    console.log(`--- run ${i}/${totalRuns} ---`);
    const result = runOnce(i);
    results.push(result);
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `run ${i}: ${status} in ${(result.durationMs / 1000).toFixed(1)}s` +
        (result.passed
          ? ""
          : ` (timeout failures: ${result.timeoutFailures}, assertion failures: ${result.assertionFailures}, other: ${result.otherFailureLines.length})`),
    );
  }

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`run ${r.run}: ${r.passed ? "PASS" : "FAIL"} (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  const allPassed = results.every((r) => r.passed);
  const failedRuns = results.filter((r) => !r.passed);

  if (allPassed) {
    console.log(`\nAll ${totalRuns} consecutive runs passed.`);
    process.exit(0);
  } else {
    console.log(`\n${failedRuns.length}/${totalRuns} run(s) failed.`);
    for (const r of failedRuns) {
      console.log(
        `  run ${r.run}: timeout failures=${r.timeoutFailures}, assertion failures=${r.assertionFailures}, other=${r.otherFailureLines.length}`,
      );
      for (const line of r.otherFailureLines) console.log(`    other: ${line}`);
    }
    process.exit(1);
  }
}

main();
