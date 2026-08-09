#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runVersionCheck, type VersionCheckResult } from "./version-check.js";

/**
 * `pnpm pr:ready` -- a fast, fail-closed pre-PR gate scoped to exactly one
 * thing: repository version governance (docs/governance/versioning.md).
 * Exists because PR #17 was opened with a workflow-file change and only
 * discovered a missing version bump after CI ran `version-check` --
 * wasted round-trip this gate exists to catch locally in seconds, before
 * `gh pr create`.
 *
 * Deliberately narrow: this does NOT typecheck, lint, build, or run the
 * full test suite (those are `pnpm validate`'s job, and CI's `Validate`
 * workflow remains the authoritative gate regardless of what this script
 * reports). It reuses `runVersionCheck` -- the exact function `pnpm
 * version:check` and CI's `version-check` job both call -- rather than
 * re-implementing any classification/comparison logic, so this can never
 * drift from what CI actually enforces.
 */

interface ParsedArgs {
  base: string;
  error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let base = "main";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue; // pnpm's own "--" forwarding separator (see version-check-cli.ts).
    if (arg === "--base") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { base, error: "--base requires a value (a git ref)." };
      }
      base = value;
      i++;
    } else if (arg.startsWith("--base=")) {
      base = arg.slice("--base=".length);
      if (base === "") return { base, error: "--base requires a non-empty value." };
    } else {
      return { base, error: `Unknown argument "${arg}". Supported: --base <ref>.` };
    }
  }
  return { base };
}

function printFailure(label: string, result: VersionCheckResult): void {
  process.stderr.write(`pr:ready: ${label} FAILED\n`);
  for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
  if (result.errors.length === 0) {
    process.stderr.write(`  - (no specific error reported; see "pnpm version:check${result.mode === "comparison" ? ` -- --base ${result.baseRef}` : ""}" for full detail)\n`);
  }
}

function main(): void {
  const { base, error } = parseArgs(process.argv.slice(2));
  if (error) {
    process.stderr.write(`pr:ready: ${error}\n`);
    process.exitCode = 3;
    return;
  }

  const cwd = process.cwd();

  // 1. Local structural consistency (semver validity, runtime/lockfile
  // drift) -- the same check `pnpm version:check` (no args) runs.
  const local = runVersionCheck({ cwd });
  if (local.status !== "passed") {
    printFailure("local version consistency (pnpm version:check)", local);
    process.stderr.write(`pr:ready: fix the above, then re-run "pnpm pr:ready" before opening a PR.\n`);
    process.exitCode = local.exitCode || 1;
    return;
  }

  // 2. Base-comparison: is a version bump required, and if so, present?
  // The same check CI's "Version check (base comparison)" step runs.
  const comparison = runVersionCheck({ cwd, base });
  if (comparison.status !== "passed") {
    printFailure(`version governance vs "${base}" (pnpm version:check -- --base ${base})`, comparison);
    process.stderr.write(
      `pr:ready: a version bump is required (see docs/governance/versioning.md's SemVer policy for patch/minor/major), then re-run "pnpm pr:ready" before opening a PR.\n`,
    );
    process.exitCode = comparison.exitCode || 1;
    return;
  }

  // 3. Focused package-version test -- only "when applicable": the
  // milestone protocol's own pre-PR audit rule is "if package.json's
  // version changed, run tests/unit/package-version.test.ts". Skipped
  // entirely (fast path) when this branch didn't touch the version.
  if (comparison.versionChanged) {
    const here = dirname(fileURLToPath(import.meta.url));
    const vitestEntry = join(here, "..", "..", "node_modules", "vitest", "vitest.mjs");
    const testFile = join(here, "..", "..", "tests", "unit", "package-version.test.ts");
    const run = spawnSync(process.execPath, [vitestEntry, "run", testFile], { cwd, stdio: "inherit" });
    if (run.status !== 0) {
      process.stderr.write(`\npr:ready: tests/unit/package-version.test.ts FAILED -- fix it, then re-run "pnpm pr:ready" before opening a PR.\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write(
    `pr:ready -- PASSED (currentVersion: ${comparison.currentVersion}, base: ${base}, versionChanged: ${comparison.versionChanged}${comparison.versionChanged ? `, increment: ${comparison.increment}` : ""})\n`,
  );
  process.stdout.write("Safe to open a PR: repository version governance is satisfied.\n");
  process.exitCode = 0;
}

main();
