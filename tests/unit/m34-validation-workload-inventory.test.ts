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
  // M36-WU02: initGitFixtureRepo (tests/helpers.ts, M35-WU03) wraps a
  // real `git init`/config/commit sequence -- a file calling only this
  // shared helper, with no direct execFileSync("git", ...) of its own,
  // still spawns git transitively and must classify as such.
  return /(?:execFileSync|spawnSync|execFile|spawn)\(\s*["']git["']/.test(text) || /\binitGitFixtureRepo\(/.test(text);
}

function hasDockerSpawn(text: string): boolean {
  // M38-WU02/WU03: runDockerCommand (sandbox-docker-command-runner.ts)
  // wraps the one real execFileSync("docker", ...) call site;
  // constructing a real DockerSandboxBackend instance (`new
  // DockerSandboxBackend(`) is the transitive trigger every
  // sandbox-docker-backend test exercises, and sandbox-docker-
  // backend.test.ts also calls execFileSync("docker", ...) directly for
  // its own inspection assertions. Deliberately requires the
  // *instantiation* syntax, not just the bare class name -- a file that
  // only MENTIONS "DockerSandboxBackend" in a doc comment (e.g.
  // sandbox-command-loop.test.ts's own fake-backend explanation) must
  // not be misclassified as spawning.
  return /execFileSync\(\s*["']docker["']/.test(text) || /\brunDockerCommand\(/.test(text) || /new\s+DockerSandboxBackend\s*\(/.test(text);
}

function hasCliSpawn(text: string): boolean {
  // M36-WU03: runAutonomousCommand/executeAutonomousRun wrap real
  // execFileSync calls -- a test file calling only these, with no direct
  // spawnSync/tsxCli/dist reference of its own, still spawns a real
  // process transitively.
  return (
    /spawnSync\(\s*process\.execPath/.test(text) ||
    /tsxCli/.test(text) ||
    /dist[\\/]index\.js/.test(text) ||
    /\brunAutonomousCommand\(/.test(text) ||
    /\bexecuteAutonomousRun\(/.test(text)
  );
}

/**
 * The 33 files known to spawn a real subprocess (git and/or the CLI) as of
 * the M34-WU01 baseline (docs/engineering/m34-validation-workload-policy.md
 * Sec 1/5), plus the 1 built-binary smoke file WU34-03 added, the 2
 * autonomous-run files M36-WU02 added, the 2 more M36-WU03 added, the
 * 3 more M36-WU04 added, the 1 more M36-WU05 added, the 1 more M37-WU01
 * added, the 1 more M37-WU03 added, the 1 more M37-WU04 added, the
 * 1 more M37-WU05 added, the 1 more M38-WU02 added, and the 1 more
 * M38-WU04 added (48 total). A
 * file added to or removed from this set must be a deliberate, reviewed
 * change to the policy document -- this test does not silently absorb a new
 * spawning file into "already accounted for".
 */
const KNOWN_SPAWNING_FILES = [
  // Git/worktree integration (7) -- +2 in M36-WU02: both call only the
  // shared initGitFixtureRepo helper (no direct execFileSync("git", ...)
  // of their own), detected via hasGitSpawn's initGitFixtureRepo pattern.
  "tests/integration/git-command-runner.test.ts",
  "tests/integration/autonomous-run-preflight.test.ts",
  "tests/integration/autonomous-candidate-intake-service.test.ts",
  "tests/integration/workspace-cli.test.ts",
  "tests/integration/workspace-hardening.test.ts",
  "tests/integration/workspace-service-prepare.test.ts",
  "tests/integration/workspace-service-release-recovery.test.ts",
  // Built-binary smoke (1) -- added WU34-03
  "tests/integration/built-binary-smoke.test.ts",
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
  // M36-WU03 (+2): autonomous-command-runner.test.ts spawns real commands
  // via runAutonomousCommand (git --version, a denied rm, a nonexistent
  // binary); autonomous-run-execution-service.test.ts spawns via both
  // initGitFixtureRepo (setup) and executeAutonomousRun (the real loop).
  "tests/integration/autonomous-command-runner.test.ts",
  "tests/integration/autonomous-run-execution-service.test.ts",
  // M36-WU04 (+3): all three call initGitFixtureRepo for their real
  // disposable-repository fixture; validation-service and
  // evidence-binding-service additionally spawn transitively via
  // runAutonomousCommand/runAutonomousCommandLoop (already covered by
  // hasCliSpawn's runAutonomousCommand pattern for the former; the
  // latter is caught by hasGitSpawn's initGitFixtureRepo pattern either
  // way, since every file here uses that shared fixture).
  "tests/integration/autonomous-run-diff-summary.test.ts",
  "tests/integration/autonomous-run-evidence-binding-service.test.ts",
  "tests/integration/autonomous-run-validation-service.test.ts",
  // M36-WU05 (+1): the dogfood pilot suite runs the full pipeline
  // (initGitFixtureRepo for its fixture, plus the same runAutonomousCommand
  // pattern already covered by hasGitSpawn/hasCliSpawn) against a real
  // disposable target repository.
  "tests/integration/autonomous-run-dogfood-pilot.test.ts",
  // M37-WU01 (+1): the public CLI lifecycle suite spawns git transitively
  // via initGitFixtureRepo (its fixture) and every autonomous-inspect/
  // classify call's real, read-only runRepositoryPreflight.
  "tests/integration/autonomous-cli-lifecycle.test.ts",
  // M37-WU03 (+1): the real (non-simulated) execution suite spawns git
  // transitively via initGitFixtureRepo (its fixture) and the first-ever
  // real `git worktree add`/command execution invoked from a public CLI
  // command (autonomous-agent-import.command.ts -> produceAutonomousEvidencePacket).
  "tests/integration/autonomous-real-execution.test.ts",
  // M37-WU04 (+1): the patch export suite spawns git directly (real
  // checkouts/commits to set up an autonomous/-prefixed branch fixture)
  // and via initGitFixtureRepo.
  "tests/integration/autonomous-run-patch-export-service.test.ts",
  // M37-WU05 (+1): the controlled pilot suite drives the full real,
  // non-simulated CLI surface (classify/approve/run/agent-import/cancel/
  // cleanup/result/status) end-to-end for 10 required scenarios against a
  // real disposable target repository -- spawns git transitively via
  // initGitFixtureRepo and the same real command-execution path already
  // covered by hasGitSpawn/hasCliSpawn for autonomous-real-execution.test.ts.
  "tests/integration/autonomous-controlled-pilot.test.ts",
  // M38-WU02 (+1): spawns a real `docker` subprocess (create/inspect/
  // start/stop/rm) via DockerSandboxBackend, self-skipping when Docker
  // is unavailable on the host running the suite.
  "tests/integration/sandbox-docker-backend.test.ts",
  // M38-WU04 (+1): aiqt autonomous agent-import --live end-to-end,
  // spawns a real `docker` subprocess (via DockerSandboxBackend) plus
  // real `git` (via initGitFixtureRepo's fixture and direct inspection
  // assertions), self-skipping when Docker is unavailable.
  "tests/integration/sandbox-live-execution.test.ts",
].sort();

/**
 * M34-WU02: every one of the (then-33) known-spawning files carries a
 * per-file `vi.setConfig({ testTimeout: ... })` override sourced from the
 * shared tests/workload-timeout-policy.ts constants (see
 * docs/engineering/m34-validation-workload-policy.md Sec 6.1). WU34-03
 * added a 34th spawning file (the built-binary smoke suite), also using the
 * shared constant from its introduction -- so this remains the exact set as
 * KNOWN_SPAWNING_FILES. Before WU34-02, only 4 of the original 33 had an
 * override (all pre-existing, from M30/M33); the other 29 relied on the
 * unmodified 5000ms global default, which is the root cause characterized
 * in WU34-01.
 */
const KNOWN_TIMEOUT_OVERRIDE_FILES = [...KNOWN_SPAWNING_FILES].sort();

describe("M34-WU01: every process-spawning test file is classified (no silent new subprocess-spawning file)", () => {
  it("the set of test files that spawn git or the CLI matches the recorded workload-policy baseline exactly", () => {
    const allFiles = walkTestFiles(testsDir);
    const spawningFiles = allFiles
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return hasGitSpawn(text) || hasCliSpawn(text) || hasDockerSpawn(text);
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
        return hasGitSpawn(text) || hasCliSpawn(text) || hasDockerSpawn(text);
      })
      .map(relPath);
    expect(
      offenders,
      "A file under tests/unit/ spawns a subprocess. This breaks the classification " +
        "assumption that tests/unit/ is entirely the fast-unit workload class.",
    ).toEqual([]);
  });
});

describe("M34-WU02: every known-spawning file now has a class-scoped timeout override (no file outside the approved, recorded set)", () => {
  it("the set of files with a per-file vi.setConfig({testTimeout}) override now equals the full spawning-file set", () => {
    const allFiles = walkTestFiles(testsDir);
    const overrideFiles = allFiles
      .filter((f) => /vi\.setConfig\(\s*\{\s*testTimeout:/.test(readFileSync(f, "utf8")))
      .map(relPath)
      .sort();
    expect(
      overrideFiles,
      "A test file's testTimeout override set changed. Update the recorded " +
        "baseline in docs/engineering/m34-validation-workload-policy.md Sec 2/6.1 and " +
        "KNOWN_TIMEOUT_OVERRIDE_FILES here only as part of a reviewed change.",
    ).toEqual(KNOWN_TIMEOUT_OVERRIDE_FILES);
  });

  it("every override uses the shared workload-timeout-policy constants, not a locally hardcoded literal", () => {
    const allFiles = walkTestFiles(testsDir);
    const offenders: string[] = [];
    for (const f of allFiles) {
      const text = readFileSync(f, "utf8");
      if (/vi\.setConfig\(\s*\{\s*testTimeout:\s*\d/.test(text)) {
        offenders.push(relPath(f));
      }
    }
    expect(
      offenders,
      "A file's vi.setConfig({testTimeout}) uses a hardcoded numeric literal instead of " +
        "importing SPAWNING_SUITE_TEST_TIMEOUT_MS/HEAVY_SPAWNING_TEST_TIMEOUT_MS from " +
        "tests/workload-timeout-policy.ts -- this defeats the single-source-of-truth " +
        "policy WU34-02 established.",
    ).toEqual([]);
  });

  /**
   * M34-WU02 correction: the WU34-01 draft of this test only matched one
   * inline-timeout shape (`\n  <digits>,\n);`, found via
   * tests/integration/cli.test.ts and
   * tests/unit/execution-metadata-limits-stress.test.ts) and MISSED a
   * second, equally common shape already in wide use across this suite:
   * `}, <digits>);` on the line that closes the it() callback. A full scan
   * for the second shape during WU34-02 found 81 occurrences across 18
   * files -- 12 already correctly classified as process-spawning (their
   * inline timeouts sit beside real spawnSync/execFileSync calls), and 6
   * previously uninventoried files that call command functions directly
   * in-process (verified zero spawnSync/execFileSync/tsxCli references) and
   * whose slowness is real in-process filesystem I/O and computation, not
   * subprocess latency -- docs/engineering/m34-validation-workload-policy.md
   * Sec 9.2 records the full accounting and why these 6 remain classified
   * as filesystem-integration rather than reclassified as spawning.
   */
  const KNOWN_SAME_LINE_INLINE_TIMEOUT_COUNTS: Record<string, number> = {
    "tests/integration/checkpoint-advisory-issues-feedback.test.ts": 8,
    "tests/integration/checkpoint-evidence-advisory.test.ts": 13,
    "tests/integration/checkpoint-required-evidence-enforcement.test.ts": 9,
    "tests/integration/cli.test.ts": 4,
    "tests/integration/evidence-advisory-hardening.test.ts": 3,
    "tests/integration/evidence-gate-enforcement-activation-review.test.ts": 5,
    "tests/integration/evidence-gate-exception-lifecycle.test.ts": 6,
    "tests/integration/evidence-gate-full-lifecycle.test.ts": 1,
    "tests/integration/evidence-gate-hardening.test.ts": 7,
    "tests/integration/evidence-gate-simulate.test.ts": 11,
    "tests/integration/execution-adapter-claude-code-full-lifecycle.test.ts": 1,
    "tests/integration/execution-external-hardening.test.ts": 6,
    "tests/integration/execution-full-lifecycle.test.ts": 1,
    "tests/integration/execution-metadata-runlog-recovery.test.ts": 1,
    "tests/integration/execution-next-cancel-safeguard.test.ts": 1,
    "tests/integration/execution-workflow-integration.test.ts": 1,
    "tests/integration/gate-k-dogfood.test.ts": 1,
    "tests/integration/required-evidence-hardening.test.ts": 2,
  };

  /** The 2 sites already known from the WU34-01 draft of this test (a different closing shape). */
  const KNOWN_TRAILING_LINE_INLINE_TIMEOUT_FILES = [
    "tests/integration/cli.test.ts",
    "tests/unit/execution-metadata-limits-stress.test.ts",
  ].sort();

  it("the 'same-line' inline-timeout shape (}, <ms>);) matches the corrected 18-file/81-occurrence baseline exactly", () => {
    const allFiles = walkTestFiles(testsDir);
    const actual: Record<string, number> = {};
    for (const f of allFiles) {
      const text = readFileSync(f, "utf8");
      const matches = [...text.matchAll(/\}, \d{4,7}\);/g)];
      if (matches.length > 0) actual[relPath(f)] = matches.length;
    }
    expect(
      actual,
      "The set (or per-file count) of same-line inline it() timeout arguments changed. " +
        "Update KNOWN_SAME_LINE_INLINE_TIMEOUT_COUNTS here and " +
        "docs/engineering/m34-validation-workload-policy.md Sec 9.2 deliberately.",
    ).toEqual(KNOWN_SAME_LINE_INLINE_TIMEOUT_COUNTS);
  });

  it("the 'trailing-line' inline-timeout shape (\\n  <ms>,\\n);) matches the recorded 2-file baseline exactly", () => {
    const allFiles = walkTestFiles(testsDir);
    const offenders: string[] = [];
    for (const f of allFiles) {
      const text = readFileSync(f, "utf8");
      const matches = [...text.matchAll(/\n\s*(\d{4,7}),\n\s*\);/g)];
      if (matches.length > 0) offenders.push(relPath(f));
    }
    expect(offenders.sort()).toEqual(KNOWN_TRAILING_LINE_INLINE_TIMEOUT_FILES);
  });

  it("the 6 newly-inventoried in-process (non-spawning) heavy-timeout files genuinely spawn no subprocess", () => {
    const nonSpawningHeavyFiles = [
      "tests/integration/checkpoint-advisory-issues-feedback.test.ts",
      "tests/integration/checkpoint-evidence-advisory.test.ts",
      "tests/integration/checkpoint-required-evidence-enforcement.test.ts",
      "tests/integration/evidence-gate-enforcement-activation-review.test.ts",
      "tests/integration/evidence-gate-exception-lifecycle.test.ts",
      "tests/integration/gate-k-dogfood.test.ts",
    ];
    for (const f of nonSpawningHeavyFiles) {
      const text = readFileSync(join(repoRoot, f), "utf8");
      expect(hasGitSpawn(text) || hasCliSpawn(text), `${f} should not spawn a subprocess`).toBe(false);
    }
  });
});

describe("M34-WU01/WU03: architecture/security guard dynamic-discovery inventory", () => {
  const guards = [
    { file: "tests/unit/execution-adapter-boundary-scan.test.ts", listName: "M27_FILES" },
    { file: "tests/unit/generic-execution-boundary-scan.test.ts", listName: "M27R_FILES" },
    { file: "tests/unit/evidence-gate-boundary-scan.test.ts", listName: "M28_FILES" },
  ];

  /**
   * M34-WU03 (LOW-014): the 3 pre-M33 boundary-scan guards were static
   * hand-maintained lists as of WU34-01's characterization (see git history
   * of this describe block for that snapshot). WU34-03 added a
   * readdirSync-based drift-detector describe block to each of the 3 files
   * -- the reviewed M27_FILES/M27R_FILES/M28_FILES arrays remain (a new
   * file still requires deliberate review to add), but a file matching each
   * domain's command-file naming convention can no longer be silently
   * omitted: the drift detector fails loudly instead.
   */
  it("all 3 pre-M33 boundary-scan guards now also use readdirSync-based drift detection (LOW-014 fixed) while retaining their reviewed static list", () => {
    for (const g of guards) {
      const text = readFileSync(join(repoRoot, g.file), "utf8");
      expect(text, `${g.file} should still declare ${g.listName}`).toContain(`const ${g.listName} = [`);
      expect(
        text,
        `${g.file} should now use readdirSync for dynamic discovery (WU34-03) -- if it does not, ` +
          "the LOW-014 fix regressed and Sec 4 of the policy doc must be updated to reflect this.",
      ).toContain("readdirSync");
    }
  });

  it("the 2 M33 guards continue to use dynamic (readdirSync- or live-command-tree-based) discovery", () => {
    const m33ExitTenText = readFileSync(join(repoRoot, "tests/unit/m33-exit10-and-owner-inventory.test.ts"), "utf8");
    expect(m33ExitTenText).toContain("readdirSync");

    const m33MatrixText = readFileSync(join(repoRoot, "tests/unit/m33-cli-contract-matrix.test.ts"), "utf8");
    expect(m33MatrixText).toContain("buildProgram()");
  });
});
