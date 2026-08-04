# AIQT Milestone 34 Closure Report

## Milestone

**Title:** AIQT Milestone 34: Deterministic Test Execution and Validation Gate Hardening

**Objective:** Make AIQT's official validation command deterministic, repeatable, and trustworthy across supported Node versions and operating systems.

**Risk classification:** Medium-to-high (per build spec). Highest single Work Unit risk: WU34-02 at 50/100.

**Starting commit:** `de02cb47716a93457637aa63aa57b3bbe10bd25a` (`m33-unified-cli-result-contract`, `v0.19.0`)

**Ending (closure-report) commit:** the commit introducing this file, tagged `m34-wu04-validation-gate-closure` and `m34-deterministic-validation-gate` (see `git log --oneline -1 docs/engineering/m34-closure-report.md` or either tag for the exact SHA)

**Package version:** `0.19.0` (unchanged — no product behavior, schema, or contract change in this milestone)

**Canonical schema version:** `0.5.0` (unchanged)

## Work Units

| Work Unit | Commit | Tag | Scope |
| --- | --- | --- | --- |
| WU34-01 | `3909db1` | `m34-wu01-validation-workload-policy` | Full test/helper/spawn/timeout inventory; classified all 231 test files into 6 workload classes; measured full-suite failure rate (56-61 failures/run baseline) and root-caused it to concurrent subprocess-spawn cost under the unmodified 5000ms global default; defined the class-scoped timeout/concurrency/repeated-run/built-binary/dynamic-guard policy in `docs/engineering/m34-validation-workload-policy.md` (characterization only, no runtime change). |
| WU34-02 | `3be8fe1` | `m34-wu02-systemic-test-runtime-controls` | Implemented `tests/workload-timeout-policy.ts` (2 shared constants: `SPAWNING_SUITE_TEST_TIMEOUT_MS`=15000, `HEAVY_SPAWNING_TEST_TIMEOUT_MS`=25000); migrated all 33 known-spawning test files onto it via `vi.setConfig`; corrected a self-discovered inventory gap (a second inline-timeout shape, 81 occurrences/18 files WU34-01 had missed); measured 5 full-suite runs, reducing failures from the 56-61 baseline to 0-2/run including one fully clean run. |
| WU34-03 | `3a78dfe` | `m34-wu03-built-binary-repeated-validation` | Added `tests/integration/built-binary-smoke.test.ts` (10 tests: representative commands against `dist/index.js`, plus source-vs-built consistency checks); migrated all 3 static M27/M27R/M28 boundary-scan guards to dynamic (`readdirSync`-based) drift detection alongside their reviewed static lists (LOW-014); added `src/tooling/repeated-run-validation-cli.ts` (`pnpm test:repeated`) and ran the 5-consecutive-run gate, honestly recording a 2/5 local pass rate root-caused to machine-level contention after ~19 consecutive full-suite runs in one session, not a code defect; re-confirmed no local Node 22 toolchain (CI matrix remains authoritative). |
| WU34-04 | *(this commit; see tags)* | `m34-wu04-validation-gate-closure`, `m34-deterministic-validation-gate` | Reordered `.github/workflows/validate.yml`'s `Build` step before `Test` (so the built-binary smoke suite has a real `dist/` to exercise) and added `pnpm build` to the `validate` script in the same position; updated `README.md`'s Development section to document `pnpm validate`'s corrected sequence, `pnpm test:repeated`, and point to the workload policy document for timeout troubleshooting; produced this closure report. |

## Workload Classification (established WU34-01, unchanged since)

| Class | Files | Timeout policy |
| --- | --- | --- |
| Fast unit | ~197 | 5000ms default (unchanged) |
| Filesystem integration | (subset of the above; includes 6 heavy in-process files identified in WU34-02 §9.2) | 5000ms default (unchanged); 6 files carry pre-existing, untouched per-test inline overrides for real in-process I/O cost |
| Process-spawning CLI integration (general) | 5 | 15000ms (`SPAWNING_SUITE_TEST_TIMEOUT_MS`) |
| Git/worktree integration | 5 | 15000ms (same constant) |
| Evidence/execution/workspace integration | 23 | 15000ms baseline; 2 files (heaviest measured cost) at 25000ms (`HEAVY_SPAWNING_TEST_TIMEOUT_MS`) |
| Built-binary smoke | 1 (added WU34-03) | 15000ms (`SPAWNING_SUITE_TEST_TIMEOUT_MS`) |

34 files total carry a class-scoped `vi.setConfig({ testTimeout })` override sourced from the single shared `tests/workload-timeout-policy.ts` module. The remaining ~197 files keep the unmodified 5000ms global default. Full detail: `docs/engineering/m34-validation-workload-policy.md`.

## Timeout and Concurrency Policy

- **Timeout, not concurrency reduction, is the primary lever** (WU34-01 §6.2 measurement: `--maxWorkers=2` cost 2.7× wall-time for worse reliability than a class-scoped timeout raise at near-zero cost).
- No change to `vitest.config.ts`'s global default or to Vitest's worker/concurrency configuration at any point in this milestone.
- Two-tier, evidence-based per-class constants (15000ms general / 25000ms heavy-exception), each file's use documented in-file with the measurement that justifies it.
- 81 pre-existing inline per-test timeout overrides (a differently-shaped, differently-motivated pattern — real in-process filesystem/computation cost, not subprocess-spawn cost) were inventoried but deliberately left untouched; consolidating them is recorded as a future opportunity, not required for this milestone.

## Before/After Runtime Measurements

| Stage | Result |
| --- | --- |
| WU34-01 baseline (unmodified suite, full concurrency) | 56-61 failures/run, all confirmed pure-timeout |
| WU34-02 after class-scoped policy (5 runs) | 0-2 failures/run; 1 fully clean run (231/231) |
| WU34-03 5-consecutive-run gate (this session, after ~19 prior full-suite runs) | 2/5 passed, 3/5 failed with 2 pure-timeout failures each, spread across 3 different files at 3 different tiers — root-caused to session-accumulated machine contention (diagnostic run showed a 77s test-collection phase vs. the normal sub-second figure), not a policy or code defect |

## Node 22/24 Results

No Node 22 toolchain is available in this development environment at any point in this milestone (no `nvm`/`fnm`/`volta`, only Node 24 installed locally). This was established at WU34-01 and re-confirmed unchanged at WU34-03. `.github/workflows/validate.yml`'s existing matrix (`node-version: [22, 24]`, unmodified by this milestone) remains the sole authoritative source for Node 22 behavior. **This milestone does not itself prove a Node 22 CI run** — that requires this branch to actually run in CI, which requires a push this session did not perform (no push occurred at any point in this milestone, consistent with session policy).

## Operating-System Results

All measurement in this milestone was performed locally on Windows (this development environment). `.github/workflows/validate.yml` runs on `ubuntu-latest`. No macOS or additional Windows CI runner exists in the current workflow. This milestone did not add or change CI's OS matrix — it is unchanged from pre-M34 and remains `ubuntu-latest` only for both Node versions.

## Built-Binary Results

`tests/integration/built-binary-smoke.test.ts` (10 tests, added WU34-03) exercises `dist/index.js` directly: `--version`, `--help`, a parser-level error path, `plan --example`, `init --json` (mutating), `status --json` (read-only), plus 3 tests asserting `--version`/`init --json`/the parser-error path produce identical `status`/`action`/`exitCode`/`nextRecommendedCommand`/`blockingIssues[0].id` values between the tsx-source and built-`dist` entry points. All 10 pass when run against a freshly built `dist/` (`pnpm build` run first). **This milestone corrects the interim gap WU34-03 flagged**: CI's `Build` step now runs before `Test` (this commit), and the local `validate` script now includes `build` in the same position, so this suite has a real `dist/index.js` in both environments going forward.

## Five-Run Reliability Evidence

**Not achieved as a clean 5/5 local run in this milestone.** WU34-03's measurement: 2 of 5 consecutive local runs passed; the 3 failing runs each showed exactly 2 pure-timeout failures (zero assertion failures) in different files, and a follow-up diagnostic run's anomalous 77-second test-collection phase indicates real machine-level resource contention after this single development session's ~19 consecutive full-suite `vitest run` invocations across WU34-01 through WU34-03 — not a defect in this milestone's own changes. A further single full-suite run during WU34-04's own validation (after the `Build`-before-`Test` reorder landed) again showed the same 76-second collect-phase anomaly and 2 file failures (230/232 files, 2399/2401 tests; all 4 individual test failures confirmed pure `Test timed out`, zero `AssertionError`s) — consistent with, not worse than, WU34-03's finding, and confirming the anomaly is stable and reproducible on this specific machine in its current state rather than a one-off fluke. Per the build spec's own §5.5 framing (explicitly CI-inclusive: "across Node 22 and Node 24 **and supported CI platforms**") and the precedent already established for Node 22 (§6.4: CI is authoritative where no local toolchain exists), **this milestone records CI — a fresh runner per invocation — as the authoritative environment for this gate**, not a single local machine already run near-continuously for hours in one session. `pnpm test:repeated` (added WU34-03) is the durable tool for re-running this gate, locally or in CI, going forward.

## CI/Local Alignment

Both now run the identical sequence: `typecheck → lint → build → test → version:check` (CI's `validate.yml`, reordered this Work Unit; local `pnpm validate`, updated to match in the same commit). No divergence between the two beyond CI's additional PR/push-comparison version-check steps (which have no local equivalent by design — they require GitHub PR/push event metadata).

## Findings Closed or Reduced

- **HIGH-013** (official `pnpm test` fails on a clean baseline): **substantially reduced, not fully eliminated.** WU34-02's class-scoped policy cut full-suite failures from a 56-61/run baseline to 0-2/run in that Work Unit's own measurement, including a fully clean run. WU34-03's later 5-run gate showed regression to 2/5 clean under sustained same-session machine load — root-caused to environment, not the policy — but this means **the finding cannot be closed on local evidence alone**; CI confirmation remains the outstanding step (see Residual Risks).
- **MED-016** (the previous 15-second invocation is not reliably deterministic): **addressed by the class-scoped, evidence-based policy** replacing the prior single blanket value; residual variance is now honestly characterized (WU34-02 §9.3, WU34-03 §10.3) rather than hidden.
- **LOW-013** (CLI tests primarily execute source rather than `dist`): **closed for the representative command set** via `built-binary-smoke.test.ts` (WU34-03); the full evidence/execution/workspace fixture suites remain source-only, matching the build spec's own scope (§6.6 does not require duplicating every integration test against `dist`).
- **LOW-014** (some architecture/security guards use frozen hand-maintained allowlists): **closed for the 3 identified guards** (M27/M27R/M28 boundary scans, WU34-03) via added `readdirSync`-based drift detection; non-command files in each guard's static list (schema/workflow/service/state files) remain a documented residual scope limit, since they are not filename-convention-discoverable the same way.
- Node 22 vs. Node 24 variance: **not independently measured** in this milestone (no local Node 22 toolchain in any Work Unit); the existing, unmodified CI matrix remains the sole source of truth, as already established pre-M34.
- Full-suite concurrency and subprocess startup costs: **measured and characterized** (WU34-01 §3), the direct evidence basis for WU34-02's policy.
- CI/local command drift: **closed** (this Work Unit's `Build`-before-`Test` reorder in both places).

## Remaining Validation Risks

- **The 5-consecutive-clean-runs gate has not been proven on a real CI runner.** This milestone's own local measurement is honest but explicitly insufficient (per its own reasoning above) to claim this gate closed. The next actual push to `main` (or a PR) will be the first real test of this gate under the now-corrected `Build`-before-`Test` ordering and the WU34-02 timeout policy together — this has not happened in this session, since no push occurred.
- **The single heaviest known test** (`m33-result-contract-characterization.test.ts`'s 13-chained-CLI-spawn test, ~11.2s isolated floor) and the promoted `evidence-advisory-hardening.test.ts` case remain the two files on the `HEAVY_SPAWNING_TEST_TIMEOUT_MS` tier specifically because ordinary headroom was measured insufficient for them; they are the most likely files to reappear in any future flaky-run investigation.
- **81 pre-existing inline per-test timeout overrides** (WU34-02 §9.2, 18 files) were inventoried but not migrated onto the shared policy constants; they are a distinct cost class (in-process I/O/computation, not subprocess-spawn) and were left untouched deliberately, but remain a documented future consolidation opportunity.
- **The three migrated architecture/security guards' non-command files** (schema/workflow/service/state files in the M27/M27R/M28 static lists) remain undiscoverable by the same dynamic mechanism — a new schema or workflow file added to one of these domains after this milestone still requires a manually reviewed addition to the static list, with no automated detector catching its omission.
- **macOS is not in the CI matrix.** This was true before M34 and remains true after; not a regression introduced by this milestone, but also not resolved by it.

## Validation

Standard validation commands run at every Work Unit:

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm build`
- `corepack pnpm version:check`
- `git diff --check`

`corepack pnpm test` (the full suite) was run repeatedly across all four Work Units — WU34-01's characterization measurements, WU34-02's 5-run validation, WU34-03's 5-run gate plus 1 diagnostic run — never claimed to pass 100% cleanly at every single invocation; every failure across every run was individually confirmed to be exactly `Test timed out in <N>ms` with zero `AssertionError`s, and the honest per-run results are recorded in `docs/engineering/m34-validation-workload-policy.md` rather than summarized as an unqualified "passing."

## Breaking Changes

None. This milestone changes only test infrastructure, CI step ordering, package scripts, and documentation. No product behavior, schema, CLI contract, or package version changed.

## Recommendation

The class-scoped timeout policy is a measured, substantial improvement over the pre-M34 baseline (56-61 failures/run → 0-2/run in controlled measurement), and CI/local commands are now aligned on an identical, correctly-ordered sequence. However, **this milestone cannot honestly claim the build spec's own §8 gate ("five consecutive clean runs pass") is met** — the only 5-run measurement performed showed 2/5 passing, on a local machine whose own diagnostic evidence points to session-accumulated contention rather than a code or policy defect. The corrected `Build`-before-`Test` ordering and `pnpm test:repeated` tooling this Work Unit adds are exactly what is needed to obtain that proof on a real CI runner or a freshly-idle local machine — but obtaining it is now a documented next step, not a claimed result of this session's work.

**Autonomous execution remains deferred**, per the build spec's own §10: this milestone's own honest gap (the unproven 5-consecutive-run gate) is itself a direct reason it must stay deferred until a real CI run confirms the gate, not merely because the build spec says so in the abstract. No autonomous maintenance runner, background scheduling, model invocation, or code-modification capability was introduced or enabled by this milestone.
