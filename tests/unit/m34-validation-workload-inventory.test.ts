import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * M34-WU01: characterization-only inventory tests. These prove the file-by-
 * file classification recorded in
 * docs/engineering/m34-validation-workload-policy.md stays accurate as the
 * suite evolves -- they are change detectors (fail loudly when a NEW file
 * enters a risk category without deliberate review), not an implementation
 * of any timeout or concurrency policy. No test's runtime behavior, no
 * vi.setConfig call, and no vitest.config.ts value is touched by this file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const testsDir = join(repoRoot, "tests");

const SELF_PATH = fileURLToPath(import.meta.url);

function walkTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkTestFiles(full, out);
    // Exclude this file itself: its own source text contains the literal
    // spawn-detection patterns (inside string/regex literals) it scans
    // OTHER files for, which would otherwise self-match as a false
    // positive "spawning file".
    else if (entry.endsWith(".test.ts") && full !== SELF_PATH) out.push(full);
  }
  return out;
}

function relPath(full: string): string {
  return relative(repoRoot, full).replace(/\\/g, "/");
}

function hasGitSpawn(text: string): boolean {
  return /(?:execFileSync|spawnSync|execFile|spawn)\(\s*["']git["']/.test(text);
}

function hasCliSpawn(text: string): boolean {
  return /spawnSync\(\s*process\.execPath/.test(text) || /tsxCli/.test(text) || /dist[\\/]index\.js/.test(text);
}

/**
 * The exact 33 files known to spawn a real subprocess (git and/or the CLI)
 * as of the M34-WU01 baseline (docs/engineering/m34-validation-workload-
 * policy.md Sec 1/5). A file added to or removed from this set must be a
 * deliberate, reviewed change to the policy document -- this test does not
 * silently absorb a new spawning file into "already accounted for".
 */
const KNOWN_SPAWNING_FILES = [
  // Git/worktree integration (5)
  "tests/integration/git-command-runner.test.ts",
  "tests/integration/workspace-cli.test.ts",
  "tests/integration/workspace-hardening.test.ts",
  "tests/integration/workspace-service-prepare.test.ts",
  "tests/integration/workspace-service-release-recovery.test.ts",
  // Process-spawning CLI integration, general (5)
  "tests/integration/cli.test.ts",
  "tests/integration/import-plan-extend.command.test.ts",
  "tests/integration/m33-result-contract-characterization.test.ts",
  "tests/integration/status-parallel-cli.test.ts",
  "tests/integration/version-check.test.ts",
  // Evidence/execution/workspace integration (23)
  "tests/integration/evidence-advisory-hardening.test.ts",
  "tests/integration/evidence-gate-full-lifecycle.test.ts",
  "tests/integration/evidence-gate-hardening.test.ts",
  "tests/integration/evidence-gate-policy.test.ts",
  "tests/integration/evidence-gate-simulate.test.ts",
  "tests/integration/evidence-import-cli.test.ts",
  "tests/integration/execution-adapter-claude-code-full-lifecycle.test.ts",
  "tests/integration/execution-adapter-claude-code-hardening.test.ts",
  "tests/integration/execution-adapter-claude-code-import.test.ts",
  "tests/integration/execution-adapter-claude-code-legacy-compat.test.ts",
  "tests/integration/execution-adapter-claude-code-request.test.ts",
  "tests/integration/execution-external-hardening.test.ts",
  "tests/integration/execution-external-import.test.ts",
  "tests/integration/execution-external-request.test.ts",
  "tests/integration/execution-full-lifecycle.test.ts",
  "tests/integration/execution-hardening.test.ts",
  "tests/integration/execution-import-cli.test.ts",
  "tests/integration/execution-metadata-runlog-recovery.test.ts",
  "tests/integration/execution-next-cancel-safeguard.test.ts",
  "tests/integration/execution-stale-cli.test.ts",
  "tests/integration/execution-workflow-integration.test.ts",
  "tests/integration/required-evidence-hardening.test.ts",
  "tests/integration/workspace-packet-status-integration.test.ts",
].sort();

/** The exact 4 files carrying a per-file vi.setConfig({testTimeout}) override. */
const KNOWN_TIMEOUT_OVERRIDE_FILES = [
  "tests/integration/execution-adapter-claude-code-import.test.ts",
  "tests/integration/execution-external-import.test.ts",
  "tests/integration/execution-hardening.test.ts",
  "tests/integration/m33-result-contract-characterization.test.ts",
].sort();

describe("M34-WU01: every process-spawning test file is classified (no silent new subprocess-spawning file)", () => {
  it("the set of test files that spawn git or the CLI matches the recorded workload-policy baseline exactly", () => {
    const allFiles = walkTestFiles(testsDir);
    const spawningFiles = allFiles
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return hasGitSpawn(text) || hasCliSpawn(text);
      })
      .map(relPath)
      .sort();

    expect(
      spawningFiles,
      "A test file's subprocess-spawning status changed since the M34-WU01 baseline. " +
        "If a file now spawns git/the CLI (or no longer does), update " +
        "docs/engineering/m34-validation-workload-policy.md's classification AND " +
        "KNOWN_SPAWNING_FILES here deliberately -- this list must not silently drift, " +
        "since it is the input to this repository's timeout/concurrency policy.",
    ).toEqual(KNOWN_SPAWNING_FILES);
  });

  it("no test file outside tests/integration/ spawns a subprocess (fast-unit/filesystem-integration classes stay spawn-free)", () => {
    const unitFiles = walkTestFiles(join(testsDir, "unit"));
    const offenders = unitFiles
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return hasGitSpawn(text) || hasCliSpawn(text);
      })
      .map(relPath);
    expect(
      offenders,
      "A file under tests/unit/ spawns a subprocess. This breaks the classification " +
        "assumption that tests/unit/ is entirely the fast-unit workload class.",
    ).toEqual([]);
  });
});

describe("M34-WU01: timeout-override inventory (no override outside the approved, recorded set)", () => {
  it("the set of files with a per-file vi.setConfig({testTimeout}) override matches the recorded baseline exactly", () => {
    const allFiles = walkTestFiles(testsDir);
    const overrideFiles = allFiles
      .filter((f) => /vi\.setConfig\(\s*\{\s*testTimeout:/.test(readFileSync(f, "utf8")))
      .map(relPath)
      .sort();
    expect(
      overrideFiles,
      "A test file's testTimeout override set changed. This Work Unit (WU34-01) " +
        "does not add or remove any override -- if this fails, something outside " +
        "this Work Unit's scope touched timeout configuration. Update the recorded " +
        "baseline in docs/engineering/m34-validation-workload-policy.md Sec 2 and " +
        "KNOWN_TIMEOUT_OVERRIDE_FILES here only as part of a reviewed WU34-02+ change.",
    ).toEqual(KNOWN_TIMEOUT_OVERRIDE_FILES);
  });

  it("the 2 known per-it() inline numeric timeout arguments are still the only such sites", () => {
    // A trailing numeric literal as the it() callback's sibling argument,
    // anchored to a line ending in `,\n    <digits>,\n  );` immediately
    // after a callback's closing brace -- deliberately narrow (a general
    // regex over arbitrary code bodies is too fragile/false-positive-prone
    // to be a reliable inventory signal here; this anchors on the specific
    // known sites' shape instead of attempting an exhaustive AST-level
    // check). Two sites are known: tests/integration/cli.test.ts (a real
    // CLI-subprocess-spawning test, M21 vitest-3-upgrade rationale) and
    // tests/unit/execution-metadata-limits-stress.test.ts (a pure-CPU
    // combinatorial stress test with no subprocess spawn at all -- found
    // BY this characterization test during M34-WU01, not previously
    // recorded in any prior milestone's timeout inventory).
    const allFiles = walkTestFiles(testsDir);
    const offenders: string[] = [];
    for (const f of allFiles) {
      const text = readFileSync(f, "utf8");
      const matches = [...text.matchAll(/\n\s*(\d{4,7}),\n\s*\);/g)];
      if (matches.length > 0) offenders.push(`${relPath(f)} (${matches.length})`);
    }
    expect(
      offenders,
      "A new per-it() inline numeric timeout argument appeared (or a known one " +
        "disappeared). Update this test and Sec 2 of the policy doc deliberately if " +
        "this is an intentional, reviewed change.",
    ).toEqual(["tests/integration/cli.test.ts (1)", "tests/unit/execution-metadata-limits-stress.test.ts (1)"]);
  });
});

describe("M34-WU01: architecture/security guard dynamic-discovery inventory", () => {
  const guards = [
    { file: "tests/unit/execution-adapter-boundary-scan.test.ts", listName: "M27_FILES", dynamic: false },
    { file: "tests/unit/generic-execution-boundary-scan.test.ts", listName: "M27R_FILES", dynamic: false },
    { file: "tests/unit/evidence-gate-boundary-scan.test.ts", listName: "M28_FILES", dynamic: false },
    { file: "tests/unit/m33-exit10-and-owner-inventory.test.ts", listName: null, dynamic: true },
    { file: "tests/unit/m33-cli-contract-matrix.test.ts", listName: null, dynamic: true },
  ];

  it("exactly the recorded 3 pre-M33 boundary-scan guards still use a static, hand-maintained file list (LOW-014, not yet fixed -- WU34-03 scope)", () => {
    for (const g of guards.filter((x) => !x.dynamic)) {
      const text = readFileSync(join(repoRoot, g.file), "utf8");
      expect(text, `${g.file} should still declare ${g.listName}`).toContain(`const ${g.listName} = [`);
      expect(
        text,
        `${g.file} should NOT yet use readdirSync for discovery -- if it does, the WU34-01 ` +
          "inventory is stale and Sec 4 of the policy doc must be updated to reflect the fix.",
      ).not.toContain("readdirSync");
    }
  });

  it("exactly the recorded 2 M33 guards use dynamic (readdirSync- or live-command-tree-based) discovery", () => {
    const m33ExitTenText = readFileSync(join(repoRoot, "tests/unit/m33-exit10-and-owner-inventory.test.ts"), "utf8");
    expect(m33ExitTenText).toContain("readdirSync");

    const m33MatrixText = readFileSync(join(repoRoot, "tests/unit/m33-cli-contract-matrix.test.ts"), "utf8");
    expect(m33MatrixText).toContain("buildProgram()");
  });
});
