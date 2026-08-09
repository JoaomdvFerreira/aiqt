# IH-04 — Expensive-Layer and Flake Hardening

The intervention's primary lever. `ih01-baseline.md` §4.2–4.3 established
that **33 CLI-spawning files were 88.8% of all test execution time**, and
that the dominant term inside them was not the tests but a per-invocation
TypeScript transform. This Work Unit removes that term at the root.

No test was deleted. No assertion was weakened. No skip or `todo` was
added. No timeout constant was raised.

## 1. The change

Until now every one of the 28 real-CLI integration suites independently
declared:

```ts
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry  = join(repoRoot, "src", "index.ts");
spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
```

Every CLI invocation therefore re-transpiled the entire CLI source graph.
Measured (5-run mean, `aiqt --version`, base commit):

| Entry point | Per spawn |
| --- | --: |
| `tsx src/index.ts` | **2882 ms** |
| `node dist/index.js` | **1076 ms** |

All 28 now spawn the built entry point through one shared constant,
`BUILT_CLI_ENTRY` in [`tests/cli-runner.ts`](../../../../tests/cli-runner.ts).
Each file keeps its own `runCli` wrapper and every argv, assertion, temp
directory and timeout constant is untouched — the only thing that changed
is which entry point the real subprocess executes.

### 1.1 Why this is not a coverage reduction

These suites assert on process-boundary facts: exit status, stdout/stderr
placement, JSON payload shape, and the real `.aiqt/` files left on disk.
None of that changes with the entry point. Three independent reasons this
is failure-detection-equivalent or better:

1. **`dist/index.js` is the artifact `package.json#bin` actually ships.**
   The suite now exercises what users run, not a development-only loader.
2. **The equivalence is itself under test.**
   `tests/integration/built-binary-smoke.test.ts` is deliberately left
   unconverted: it still spawns *both* entry points and asserts they agree
   on `--version`, on `init --json`'s
   status/action/exitCode/nextRecommendedCommand shape, and on a
   parser-level error's exitCode and `blockingIssues[0].id`. The tsx-source
   path therefore remains covered, and the equivalence the other 28 suites
   now rely on is a tested claim rather than an assumption.
3. **Staleness is impossible, not merely unlikely** — see §1.2.

### 1.2 Build freshness is enforced, not assumed

`built-binary-smoke.test.ts` has always required a prior `pnpm build`, with
that requirement left implicit. Survivable for one file; not for the spine.
[`tests/global-setup.ts`](../../../../tests/global-setup.ts) (wired via
`vitest.config.ts`'s `globalSetup`) rebuilds `dist/` when it is missing or
older than the newest file under `src/`, and **fail-closed**: any error
reading either tree triggers the build rather than skipping it. In CI the
single `validate` job runs `pnpm build` immediately before `pnpm test`, so
this is a no-op mtime scan; it only builds for a developer running a bare
`pnpm test`.

### 1.3 Classification kept honest

`src/tooling/test-inventory-classifier.ts`'s `hasCliSpawn`/`hasBuiltBinary`
detectors now recognise `BUILT_CLI_ENTRY`, exactly as they already fold in
the `initGitFixtureRepo` and `runAutonomousCommand` shared-helper
indirections. Verified: `tests/unit/m34-validation-workload-inventory.test.ts`
still matches its recorded spawning-file and timeout-override baselines
with no baseline edit, and `tests/unit/m35-test-inventory-classification.test.ts`
passes unchanged. The refactor is invisible to the inventory, which is the
correct outcome — the same files still spawn the same real processes.

## 2. Measured result

Same machine, same 16-way `threads` pool, same command
(`vitest run --reporter=json`), before and after:

| | Baseline (`679abcd`) | After IH-03 + IH-04 | Δ |
| --- | --: | --: | --: |
| Exit code | **1** | **0** | — |
| Test files | 336 | 336 | 0 |
| Tests | 3510 | 3502 | −8 (IH-03) |
| **Failures** | **17** | **0** | **−17** |
| Summed file duration | 2660s | **1362s** | **−48.8%** |
| Wall-clock | 259s | **112s** | **−56.8%** |

Per-file, across the expensive cluster (all under the same contention):

| File | Before | After | Ratio |
| --- | --: | --: | --: |
| `cli.test.ts` | 257.8s | 103.3s | ×2.50 |
| `m33-result-contract-characterization.test.ts` | 191.6s | 74.9s | ×2.56 |
| `evidence-gate-simulate.test.ts` | 159.1s | 70.5s | ×2.26 |
| `execution-adapter-claude-code-import.test.ts` | 140.5s | 60.0s | ×2.34 |
| `execution-external-import.test.ts` | 123.0s | 55.3s | ×2.23 |
| `execution-import-cli.test.ts` | 93.3s | 35.4s | ×2.63 |
| `evidence-import-cli.test.ts` | 89.2s | 34.5s | ×2.59 |
| `evidence-gate-policy.test.ts` | 87.9s | 39.7s | ×2.21 |
| `workspace-cli.test.ts` | 87.5s | 44.9s | ×1.95 |
| `execution-hardening.test.ts` | 85.1s | 34.3s | ×2.48 |
| `evidence-gate-hardening.test.ts` | 82.0s | 35.2s | ×2.33 |
| `status-parallel-cli.test.ts` | 54.2s | 21.2s | ×2.55 |
| `execution-stale-cli.test.ts` | 49.5s | 18.6s | ×2.66 |

Unconverted files confirm the effect is the conversion and not measurement
drift: `version-check.test.ts` (spawns the *tooling* CLI through tsx, so
deliberately not converted) 51.5s → 48.2s, and `historical-evidence.test.ts`
(git-heavy, no CLI spawn) 50.0s → 59.7s — both within noise, neither
improved.

## 3. Flake outcome — the timeout family is gone

`ih01-isolation-evidence.md` recorded 16 load-induced timeout failures
across 11 files, with a ×2.40 contention amplification, and identified the
per-spawn transform as the root cause. **The identical 16-way local run
now completes with 0 failures**, and the whole-suite amplification factor
falls from ×2.40 (measured on those 11 files) to ×1.95.

This was fixed by removing the cost, not by accommodating it:

- no timeout constant changed (`SPAWNING_SUITE_TEST_TIMEOUT_MS` is still
  15000, `HEAVY_SPAWNING_TEST_TIMEOUT_MS` still 25000);
- no per-file timeout override added or removed;
- no worker-count reduction;
- no rerun-until-green anywhere in this Work Unit.

### 3.1 Family B closed

`ih01-baseline.md` §5.2's pre-existing Windows-only guard failure is fixed.
`tests/unit/m34-validation-workload-inventory.test.ts`'s trailing-line
timeout guard normalizes line endings before matching; its `,\n` separator
previously could not match `,\r\n`, so on any `core.autocrlf=true`
checkout it silently missed `tests/integration/cli.test.ts` and failed on
unmodified `main` while passing on CI's LF checkout. Same assertion, same
recorded baseline, now holds on both line endings. The full local suite
consequently exits 0 on Windows for the first time in this measurement
series.

## 4. Vitest concurrency — measured, and deliberately left unchanged

IH-02 deferred concurrency tuning to this Work Unit on the grounds that a
2.7× change in per-spawn cost invalidates any earlier measurement. Three
full runs of the post-conversion suite, same machine (8 physical / 16
logical cores), varying only `poolOptions.threads.{min,max}Threads`:

| Threads | Wall-clock | Summed file duration | Contention amplification | Failures |
| --: | --: | --: | --: | --: |
| 4 | 210s | 691s | ×1.00 (reference) | **0** |
| 8 | 135s | 883s | ×1.28 | **0** |
| 16 | 112s | 1362s | ×1.97 | **0** |

Two findings:

1. **No stability case for capping.** Zero failures at every level,
   including 16 workers on 8 physical cores — a far harsher condition than
   CI's 4-core runner. The baseline suite failed 16 tests under exactly
   that setting. Lowering concurrency for stability would now be solving a
   problem that no longer exists.
2. **Oversubscription does buy throughput, and is still declined.** 16
   threads on 8 physical cores (2× oversubscribed) beat 8 threads by
   ×1.20, which is real: these tests block on `spawnSync` while the child
   process uses a core. Extrapolated to CI that is roughly one billed
   minute.

**Decision: no `poolOptions` change** — the default
(`availableParallelism()`) is retained. The ×1.20 figure comes from an
8-physical-core Windows machine and would have to be *extrapolated* to a
4-core Linux runner; it is not a measurement of the thing being changed.
The trade is asymmetric: the upside is about one billed minute, the
downside is reintroducing load-induced timeouts on CI, and a rerun costs
far more than a minute — which is precisely why the intervention's flake
policy says to *prefer deterministic, slightly slower single-run behaviour
over parallelism that creates reruns*. The measurement is recorded here so
that a future Work Unit with real hosted per-worker data can revisit it as
a bounded, evidenced change rather than a guess.

`vitest.config.ts`'s only change in this intervention is therefore the
`globalSetup` hook from §1.2.

## 5. Retained expensive spine (explicitly justified)

Not converted, on purpose:

| File | Why it stays expensive |
| --- | --- |
| `tests/integration/built-binary-smoke.test.ts` | The dual-entry-point equivalence proof the other 28 suites now depend on. Must keep spawning tsx. |
| `tests/integration/version-check.test.ts` (48.2s) | Spawns `src/tooling/version-check-cli.ts`, repository tooling that is not part of `dist/`. No built equivalent exists to point it at. |
| `tests/integration/historical-evidence.test.ts` (59.7s) | Real `git` history construction, not CLI spawning. Outside this Work Unit's mechanism. |
| Git/worktree suites (25 files, 222s at baseline) | Already share `initGitFixtureRepo` (M35-WU03). Re-inspected; no further safe batching found that preserves per-test isolation. |

The repository therefore retains a real end-to-end spine: real
subprocesses, real argv, real git, real `.aiqt/` state, real built binary.

## 6. Validation

`pnpm typecheck` ✅ · `pnpm lint` ✅ ·
full local suite **3502 tests, 0 failures, exit 0** (was exit 1 with 17
failures) · `m34-validation-workload-inventory` + `m35-test-inventory-classification`
**16/16** with no baseline edits · `built-binary-smoke` green.

**IH-04 implementation risk: 30/100 (🟡 yellow).** Thirty test files touched
mechanically (spawn target only), plus one classifier detector, one new
shared constant, one new global setup hook. Broad blast radius by file
count, but each diff is a one-line substitution, the whole suite passes
green for the first time in this series, and the entry-point equivalence
the change relies on is itself asserted by a test that was deliberately
left alone.
