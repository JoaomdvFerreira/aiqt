# M34-WU01 — Validation Workload Characterization and Policy Contract

Characterization-only deliverable. No timeout, concurrency, `vitest.config.ts`,
package-script, or CI change is made in this Work Unit. Every number below was
measured on this machine (Windows, Node v24.14.0, pnpm 7.33.5) against
commit `68c319f` (M33 closure + M34 planning docs), not carried over from an
earlier milestone's report.

## 1. Test file inventory and workload classification

230 test files (`tests/unit/`: 120, `tests/integration/`: 110), ~2,236 `it()`
call sites, discovered via a recursive filesystem walk (not a hand-maintained
list) and classified by structural signal: real subprocess spawn calls
(`spawnSync`/`execFileSync` against `git` or against the CLI via
`tsxCli`/`dist/index.js`), temp-directory helper usage
(`makeTempDir`/`mkdtempSync`), and file-path domain (`evidence`/`execution`/
`workspace`).

| Class | Files | ~Tests | Definition |
| --- | --- | --- | --- |
| Fast unit | 115 | 1,290 | No subprocess spawn, no temp-directory helper. Pure function/schema/service-level tests. **One known outlier:** `execution-metadata-limits-stress.test.ts` carries its own 20000ms per-`it()` override for a pure-CPU combinatorial test (§2) — its cost driver is CPU computation, not subprocess latency, so it stays classified as fast-unit rather than moving to a spawn-based class. |
| Filesystem integration | 82 | 634 | Uses `makeTempDir`/`mkdtempSync` for real file I/O, but never spawns a subprocess. |
| Process-spawning CLI integration (general) | 5 | ~90 | Spawns the real CLI (`spawnSync(process.execPath, [tsxCli, entry, ...])` or `dist/index.js`) but is not evidence/execution/workspace-domain and does not spawn `git`. |
| Git/worktree integration | 5 | ~60 | Spawns real `git` subprocesses to exercise the M25 managed-workspace/worktree feature *itself* (not just to build fixture state). |
| Evidence/execution/workspace integration | 23 | ~460 | Domain is evidence-gate, execution-adapter/external, or workspace command families; spawns the CLI and, in most cases, also spawns `git init`/`git commit` purely as incidental fixture setup (not testing git itself). |
| Built-binary smoke | 0 | 0 | Does not exist yet. Confirmed via `grep -r "dist/index.js" tests/` → zero matches. Owned by WU34-03. |

**Process-spawning CLI integration (general), 5 files:** `cli.test.ts`,
`import-plan-extend.command.test.ts`,
`m33-result-contract-characterization.test.ts`, `status-parallel-cli.test.ts`,
`version-check.test.ts` (the last of these also spawns real `git` once, to
exercise the version-check tool's own `--base <ref>` comparison — a
release-tooling concern, not a product-command concern, so it stays in this
class rather than "Git/worktree integration").

**Git/worktree integration, 5 files:** `git-command-runner.test.ts`,
`workspace-cli.test.ts`, `workspace-hardening.test.ts`,
`workspace-service-prepare.test.ts`, `workspace-service-release-recovery.test.ts`.

**Evidence/execution/workspace integration, 23 files:**
`evidence-advisory-hardening.test.ts`, `evidence-gate-full-lifecycle.test.ts`,
`evidence-gate-hardening.test.ts`, `evidence-gate-policy.test.ts`,
`evidence-gate-simulate.test.ts`, `evidence-import-cli.test.ts`,
`execution-adapter-claude-code-full-lifecycle.test.ts`,
`execution-adapter-claude-code-hardening.test.ts`,
`execution-adapter-claude-code-import.test.ts`,
`execution-adapter-claude-code-legacy-compat.test.ts`,
`execution-adapter-claude-code-request.test.ts`,
`execution-external-hardening.test.ts`, `execution-external-import.test.ts`,
`execution-external-request.test.ts`, `execution-full-lifecycle.test.ts`,
`execution-hardening.test.ts`, `execution-import-cli.test.ts`,
`execution-metadata-runlog-recovery.test.ts`,
`execution-next-cancel-safeguard.test.ts`, `execution-stale-cli.test.ts`,
`execution-workflow-integration.test.ts`, `required-evidence-hardening.test.ts`,
`workspace-packet-status-integration.test.ts`.

Note on classification method: an earlier pass classified any file that
spawned `git` at all (including fixture-setup-only `git init`/`git commit`
calls) as "Git/worktree integration," which put 23 evidence/execution files
in the wrong bucket purely because they call a shared `initGitRepo`/
`commitAiqtState` test helper for realism. Corrected by distinguishing real
git-*worktree*-feature testing (5 files, all in `src/workspaces/`'s test
surface) from incidental git-commit fixture setup (23 files, evidence/
execution/workspace command-family tests). This distinction matters for
policy: the first class's cost is dominated by real `git worktree add`/
`remove` filesystem operations; the second's is dominated by CLI subprocess
count, with git-commit calls as a smaller fixed addition.

## 2. Existing timeout overrides

Exactly 4 files carry a per-file `vi.setConfig({ testTimeout })` override.
**Two further sites** use a per-`it()` inline third-argument timeout — found
by this Work Unit's own characterization test
(`tests/unit/m34-validation-workload-inventory.test.ts`), not previously
recorded in any prior milestone's timeout inventory (including this
document's own first draft, which initially claimed zero such sites before
the test itself disproved that).

| File | Override | Origin |
| --- | --- | --- |
| `execution-adapter-claude-code-import.test.ts` | `vi.setConfig` 15000ms | M30 correction (`m30-correction-node22-integration-timeouts.md`) |
| `execution-external-import.test.ts` | `vi.setConfig` 15000ms | M30 correction |
| `execution-hardening.test.ts` | `vi.setConfig` 15000ms | M30 correction |
| `m33-result-contract-characterization.test.ts` | `vi.setConfig` 20000ms | M33-WU01, sized for its own heaviest test (13 chained CLI spawns) |
| `tests/integration/cli.test.ts` | inline `it(..., 20000)` | M21 vitest-3 upgrade; a real CLI-subprocess-spawning test (5 chained spawns) |
| `tests/unit/execution-metadata-limits-stress.test.ts` | inline `it(..., 20000)` | Unknown/undocumented at the code site itself; a pure-CPU combinatorial stress test with **no subprocess spawn at all** — its cost class is entirely different from every other override in this table (CPU-bound computation, not subprocess-spawn latency), and it lives under `tests/unit/`, not `tests/integration/`, so it was outside the subprocess-focused inventory this Work Unit otherwise did by hand. |

No test file's timeout configuration was changed to produce this table —
the newly-found `execution-metadata-limits-stress.test.ts` site is reported
exactly as discovered, not modified.

## 3. Measurements

All runs below on this machine, same commit, no other reduction in
background load between runs (a deliberately unfavorable, realistic
condition — not a cherry-picked idle machine).

### 3.1 Official full test command (`pnpm test` = `vitest run`, no flags), twice in a row

| Run | Files passed/total | Tests passed/total | Failures | Wall time |
| --- | --- | --- | --- | --- |
| 1 | 217/230 | 2323/2379 | 56 | 178.6s |
| 2 | 217/230 | 2318/2379 | 61 | 176.1s |

Every failure in both runs was independently confirmed to be exactly
`Error: Test timed out in 5000ms` with **zero** `AssertionError` occurrences
(`grep -c "Test timed out"` → 112 and 122 respectively, counting both the
per-test line and the summary echo; `grep -c "AssertionError"` → 0 in both).
The failing-file set was nearly identical between runs (13 files both times,
with `workspace-hardening.test.ts` swapping for
`m33-result-contract-characterization.test.ts` between run 1 and run 2) —
this is a stable, identifiable set of at-risk files, not uniformly-random
noise across the whole 230-file corpus.

### 3.2 The 13 at-risk files, run together in isolation (excluding the other 217 files)

```
Test Files  12 failed | 1 passed (13)
     Tests  45 failed | 99 passed (144)
  Duration  132.97s
```

**This is the single most important measurement in this Work Unit.** Removing
217 unrelated files from the run barely changed the failure count for these
13 (56→45 failed tests) or the wall time (178.6s→133.0s for 13 files vs. 230).
The instability is not primarily "full-suite dilution" — these 13 files,
run concurrently with only each other, already exceed the 5000ms default.
Their combined subprocess-spawn workload is the dominant cost, not
contention from the other 217 fast/filesystem files.

### 3.3 Reduced worker count (`vitest run --maxWorkers=2`)

```
Test Files  4 failed | 226 passed (230)
     Tests  4 failed | 2375 passed (2379)
  Duration  476.72s
```

Failures dropped sharply (56-61 → 4), but wall time increased **2.7×**
(178.6s → 476.7s). The 4 remaining failures were confirmed pure timeouts
(`cli.test.ts`, `evidence-gate-policy.test.ts`,
`execution-workflow-integration.test.ts`, `workspace-cli.test.ts`).

### 3.4 Raised default timeout only, unchanged concurrency (`vitest run --testTimeout=15000`)

```
Test Files  229 passed | 1 failed (230)
     Tests  2378 passed | 1 failed (2379)
  Duration  170.86s
```

**This is the second most important measurement.** Raising only the default
timeout (no concurrency change at all) reduced failures from 56-61 down to
**1**, at essentially **zero** wall-time cost (170.9s vs. 178.6s baseline —
within normal run-to-run variance, not a real slowdown). The timeout lever is
dramatically more cost-effective than the concurrency lever for this specific
failure mode: better reliability (1 failure vs. 4) at a fraction of the wall-
time cost (170.9s vs. 476.7s).

The one remaining failure was
`m33-result-contract-characterization.test.ts`'s own
"never touch state.json or runlog.jsonl" test, which already carries its own
20000ms file-level override (unaffected by the `--testTimeout=15000` CLI
flag, since a file-level `vi.setConfig` takes precedence for that file) and
still timed out under this run's contention. Isolated (zero concurrent
load), this exact test measured **11.2s** — it chains 13 real CLI subprocess
spawns in one `it()`, the single heaviest test in the entire suite. Its
existing 20000ms budget gives roughly 1.8× headroom over its isolated floor,
which this measurement shows is not always enough under full-suite
contention.

### 3.5 Node version comparison

**Node 22 is genuinely unavailable in this local environment** — confirmed by
checking for `nvm`/`volta`/`fnm`/`n` (none installed) and for any second Node
binary on `PATH` (`where.exe node` → exactly one result, `C:\Program
Files\nodejs\node.exe`, v24.14.0). This is stated explicitly rather than
fabricated or silently omitted. The CI matrix (Node 22 + 24, both required)
remains the authoritative source for Node 22 behavior; M32's and M33's own
real-CI runs already established that the timeout-class failure reproduces
on both legs, consistent with this Work Unit's Node-24-only local evidence
(the failure is CPU/subprocess-cost-bound, not Node-version-specific in
mechanism).

### 3.6 CI vs. local command

`.github/workflows/validate.yml`'s `Test` step runs exactly `pnpm test`
(byte-identical to the local command) — no divergence in the test-invocation
command itself. The divergence is in **step order**: CI runs
`Typecheck → Lint → Test → Build → Version check`. `Test` runs **before**
`Build`, on both Node legs. Combined with §1's confirmation that zero test
files reference `dist/index.js`, this means **the built artifact is never
executed by CI today** — not in the Test step (runs before Build exists) and
not anywhere else (no built-binary smoke suite exists).

### 3.7 Ad hoc built-binary smoke check (not a permanent test)

After `pnpm build`, `node dist/index.js` was run manually (outside the test
suite, in a disposable temp directory, cleaned up afterward) for
`--version`, `--help`, `init --json`, a parser-level error
(`bogus --json`), and `status --json`. All five produced output
substantively consistent with the source-driven (`tsx`) path, including the
M33 parser-error-JSON fix (`bogus --json` correctly returned
`{"status":"failed","action":"cli",...}`). This is informal evidence that
the source/built divergence risk (LOW-013) is not currently *manifesting* as
a real defect — it is a coverage gap, not a confirmed bug — and directly
informs the representative-command list WU34-03 should formalize into a
permanent smoke suite (§6.5).

## 4. Architecture/security allowlist guard inventory

| Guard | File | Discovery mechanism |
| --- | --- | --- |
| M27 execution-adapter boundary scan | `tests/unit/execution-adapter-boundary-scan.test.ts` | **Static.** Hand-maintained `M27_FILES` literal array. |
| M27R generic-execution boundary scan | `tests/unit/generic-execution-boundary-scan.test.ts` | **Static.** Hand-maintained `M27R_FILES` literal array. |
| M28 evidence-gate boundary scan | `tests/unit/evidence-gate-boundary-scan.test.ts` | **Static.** Hand-maintained `M28_FILES` literal array. |
| M33 local-failure-helper / raw-text-bypass architecture guards | `tests/unit/m33-exit10-and-owner-inventory.test.ts` | **Dynamic.** `readdirSync(commandsDir)` walks `src/cli/commands/` live; the file carries a reviewed baseline list (`LOCAL_FAILURE_HELPER_FILES`) only as a change-detector to diff the dynamic result against, not as the discovery mechanism itself. |
| M33 CLI contract matrix | `tests/unit/m33-cli-contract-matrix.test.ts` | **Dynamic.** Walks the real `buildProgram()` commander command tree at test-run time; no allowlist at all. |

Three of five guards (all pre-M33) use a frozen, hand-maintained file list —
a new file added to the `src/execution/`, `src/evidence/`, or generic
external-execution subsystems after the M27/M27R/M28 milestones closed would
not be scanned by these three guards, and nothing would fail to alert a
maintainer of that gap (LOW-014, confirmed still present). The two M33
guards demonstrate the target pattern already exists in this repository and
works (`readdirSync`-based dynamic discovery, or walking a live object
graph) — extending it to the three older guards is in-scope for WU34-03
("Improve dynamic architecture/security discovery where in scope").

## 5. Answers to the Work Unit's required questions

1. **Which tests spawn processes?** 33 of 230 files (5 git-worktree + 5
   general CLI + 23 evidence/execution/workspace), all under
   `tests/integration/`. Zero files under `tests/unit/`.
2. **Which tests use Git/worktrees?** 5 files test the real M25 git-worktree
   feature; a further 23 files incidentally spawn `git init`/`git commit`
   as fixture setup unrelated to git-worktree mechanics (§1).
3. **Which tests are evidence/execution/workspace heavy?** 23 files (§1),
   the largest single spawning class.
4. **Which timeout overrides already exist?** 4 files, all itemized in §2.
5. **Which suites fail only under full concurrency?** Partially answered,
   more precisely than "only under full concurrency": the 13 at-risk files
   fail nearly as much run together in isolation (§3.2) as inside the full
   230-file suite (§3.1) — the dominant driver is these files' own combined
   subprocess cost, not dilution from the other 217 files. Full-suite
   concurrency makes it somewhat worse, but is not the primary cause.
6. **What is the runtime effect of worker count?** Reducing to
   `--maxWorkers=2` cut failures from 56-61 to 4 at a 2.7× wall-time cost
   (§3.3) — a real but expensive lever.
7. **What differs between Node 22 and Node 24?** Not measurable locally;
   Node 22 is genuinely unavailable in this environment (§3.5). Real CI
   remains authoritative and has already shown the same failure class on
   both legs in M30/M32/M33's own closure evidence.
8. **What differs between local and CI?** The test command is identical;
   `Test` runs before `Build` in CI, so the built artifact is never
   exercised (§3.6).
9. **Which command should become authoritative?** See §6.2 — no change
   recommended to the command itself (`pnpm test`/`vitest run`), but a step-
   order change (`Build` before `Test`) is recommended once built-binary
   smoke tests exist (WU34-03), so CI validates what actually ships.

## 6. Policy decisions (target contract for WU34-02; not implemented here)

### 6.1 Timeout policy per workload class

| Class | Recommended `testTimeout` | Basis |
| --- | --- | --- |
| Fast unit | 5000ms (default; unchanged) | Never spawns a process; no measured failure in this class in any run. |
| Filesystem integration | 5000ms (default; unchanged) | No subprocess spawn; no measured failure in this class in any run. |
| Process-spawning CLI integration (general) | 15000ms | Matches the value §3.4 measured as sufficient (1 residual failure suite-wide, that one in a different class) at near-zero wall-time cost. |
| Git/worktree integration | 15000ms | Same basis; these files' git-worktree operations add cost on top of CLI-spawn cost already covered by the 15000ms figure. |
| Evidence/execution/workspace integration | 15000ms baseline; individual files with a measured, documented isolated runtime approaching or exceeding it may set a higher file-level value with the measurement recorded in-file (as `m33-result-contract-characterization.test.ts` already does at 20000ms) | §3.2 shows this class's combined cost is the dominant contributor to suite instability; §3.4 shows 15000ms resolves all but the single heaviest known test in this class. |
| Built-binary smoke | Not yet applicable (class has 0 files) | Recommend matching whichever class the equivalent source-driven test belongs to once WU34-03 adds these tests. |

This is **not** "raise the global default to 15000ms." The recommendation is
a **workload-class-scoped** contract — fast-unit and filesystem-integration
tests keep the tight 5000ms default so a genuine hang or regression in those
~197 files (86% of the suite) still fails fast. Only the 33 process-spawning
files move.

### 6.2 Concurrency policy

**Timeout adjustment, not concurrency reduction, is the recommended primary
lever.** §3.3 vs. §3.4 is the direct evidence: `--maxWorkers=2` bought
reliability at a 2.7× wall-time cost; a class-scoped timeout bought better
reliability (1 residual failure vs. 4) at no measurable wall-time cost.
Global concurrency reduction is **not recommended**. A narrower, class-scoped
concurrency control (e.g. capping how many evidence/execution/workspace-heavy
files run concurrently, without slowing the other 197 files at all) remains
a legitimate secondary option for WU34-02 to evaluate specifically for the
heaviest tier within the evidence/execution/workspace class, but is not
required by this Work Unit's evidence to reach a reliable baseline.

### 6.3 Official validation command

No change recommended to the command itself: `pnpm test` (→ `vitest run`)
remains authoritative, run identically locally and in CI. Recommended
**future** step-order change for WU34-04, contingent on WU34-03 adding
built-binary smoke tests: move `Build` before `Test` in
`.github/workflows/validate.yml` and in any local `pnpm validate` sequence,
so the suite that includes built-binary smoke tests runs against a `dist/`
that actually exists for that same run, and CI validates the artifact it
would actually ship.

### 6.4 Node support policy

Both Node 22 and Node 24 remain required (per `package.json#engines` and the
existing CI matrix). No local Node 22 toolchain exists in this development
environment; real CI stays the authoritative source for Node 22 confirmation
until/unless a local Node 22 install is added. This Work Unit does not
recommend dropping either version or narrowing the matrix.

### 6.5 Repeated-run gate

Recommend the build spec's proposed **5 consecutive full-suite runs**,
gated on WU34-02's workload-class timeout policy landing first (§3.4 shows
that policy alone gets very close to reliable; 5 consecutive runs is the
right acceptance bar to prove it holds, not just one favorable sample).

### 6.6 Built-binary policy (for WU34-03)

Recommend, at minimum, these representative commands run against
`dist/index.js` after `pnpm build` (informally verified in §3.7, not yet a
permanent test): `--version`; `--help`; `init --json` (a real mutating
command); a parser-level error (`bogus --json`, exercising the M33 parser-
JSON path specifically); `status --json` (a read-only command); and one
`--example` case. This set exercises: version/help output, one mutation, the
parser-error adaptation path, a read-only path, and the static-sample path —
without requiring the full evidence/execution/workspace fixture machinery
against the built artifact.

### 6.7 Failure classification

Recommend distinguishing, in any future tooling or reporting:

- **Assertion failure** — an `AssertionError` (or equivalent matcher
  failure) is present in the test's error output.
- **Timeout** — the error message is exactly `Test timed out in <N>ms` with
  no assertion output; the test's logic never actually ran to a failing
  assertion.
- **Process-spawn failure** — an `ENOENT`, non-zero unexpected spawn exit
  code, or a `spawnSync`/`execFileSync` throw, distinguishable from an
  application-level exit code the test intentionally asserts on.
- **Dependency/environment failure** — module-resolution errors, missing
  system binaries (e.g. `git` not on `PATH`), or Node-version API
  mismatches.
- **Platform infrastructure failure** — CI runner failures unrelated to this
  repository's own code (network, disk, runner provisioning).

Every failure measured in this Work Unit (§3.1-§3.4) was independently
confirmed to be exactly the "timeout" class, with zero instances of the
other four classes — this is the evidence base for treating M34 as a
validation-infrastructure milestone rather than a hidden-regression
investigation.

### 6.8 Dynamic guard policy

Recommend the three static guards (§4) migrate to the same
`readdirSync`-over-the-owning-directory pattern the two M33 guards already
use, so a new file added to `src/evidence/`, `src/workflow/` (the
execution-adapter/generic-execution surfaces), or their equivalents after a
milestone closes is scanned automatically rather than silently skipped.
Deferred to WU34-03 per the build spec's own scope assignment
("Improve dynamic architecture/security discovery where in scope").

## 7. Explicit non-changes (scope discipline)

Confirmed by `git diff --stat` before committing this Work Unit: no change
to `vitest.config.ts`, no change to any `vi.setConfig` call or per-test
timeout argument in any existing test file, no change to `package.json`
scripts, no change to `.github/workflows/validate.yml`, no schema-version or
package-version change, no test skipped, no assertion weakened or removed,
no platform exclusion added.

## 8. Residual risks carried into WU34-02

- The single heaviest known test (`m33-result-contract-characterization.test.ts`'s
  read-only-mutation test, 13 chained CLI spawns, ~11.2s isolated floor) may
  still need an isolated-tier concurrency control, not just a timeout value,
  to be reliably green under real CI load — §3.4's one residual failure was
  exactly this test even at a raised default.
- Node 22-specific behavior remains unverified locally; real CI is the only
  current source of truth for that leg.
- The three static architecture/security allowlists (§4) remain a live,
  undiscovered-file risk until WU34-03's dynamic-discovery migration lands.
