# AIQT Milestone 35 Closure Report

## Milestone

**Title:** AIQT Milestone 35: Test Suite Rationalization and CI Acceleration

**Objective:** Reduce AIQT CI duration from more than 11 minutes toward a reliable target below 5 minutes while preserving critical regression coverage and improving the relevance, maintainability, and architectural placement of the 2,000+ test suite.

**Risk classification:** High-risk (per build spec). Highest single Work Unit risk as specified: WU35-03 at 60/100 (actual applied risk: 45/100, see WU35-03's own commit).

**Starting commit:** `fb98d76b0472d0ea0bf2e7a2363455555eb8a78d` (M34 CI reliability confirmation)

**Ending (closure-report) commit:** the commit introducing this file, tagged `m35-wu04-ci-acceleration-and-closure` and `m35-test-suite-rationalization` (see either tag for the exact SHA)

**Package version:** `0.19.0` → `0.20.0` (minor bump, explicitly required and labeled: dropping Node 22 from the mandatory engine range is an incompatible change per `docs/engineering/versioning.md`'s pre-1.0 policy)

**Canonical schema version:** `0.5.0` (unchanged)

## Node Support Decision

**Preferred: Official runtime Node 24; Node 22 unsupported.** Chosen over Transitional (periodic Node 22 compatibility) because this repository has no scheduled-workflow infrastructure to build that on, and adding one would work against this milestone's own CI-reduction objective. `package.json#engines.node` (`>=22.0.0` → `>=24.0.0`), `.github/workflows/validate.yml`'s matrix (removed entirely — `node-version: 24` hardcoded), and `README.md`'s two Node-version references were all reconciled in the same Work Unit (WU35-04) that removed Node 22 from CI, closing the exact gap the build spec's own Sec 2 warns against ("must not promise Node 22 support while never validating it").

## Work Units

| Work Unit | Commit | Tag | Scope |
| --- | --- | --- | --- |
| WU35-01 | `ab93aa8` | `m35-wu01-test-inventory-and-node-contract` | Full static classification of 233 test files (workload class, domain, criticality, subprocess/filesystem/Git/built-binary usage); Node support policy decision; performance-heavy/flaky/duplicate/obsolete/misplaced candidate identification; deletion-evidence policy contract. No test touched. |
| WU35-02 | `31544ca` | `m35-wu02-test-suite-rationalization` | Investigated all 4 candidate clusters WU35-01 flagged by reading actual test files. Zero tests removed or merged — every cluster confirmed non-duplicate/non-obsolete on inspection; one domain's criticality classification (prompt-generation, 18 files) corrected from Low-signal to Normal after the heuristic did not hold under direct reading. |
| WU35-03 | `28a2159` | `m35-wu03-test-layer-runtime-optimization` | Shared Git-fixture-repository helper extracted from 21 files (byte-identical duplicated setup code, verified via `md5sum`); one evidenced CLI-subprocess-to-service-level conversion (`m33-result-contract-characterization.test.ts`'s state/runlog non-mutation test, 136.1s → 62.8s isolated, 54% reduction). Representative end-to-end subprocess spine retained in every touched file. |
| WU35-04 | `41374e1`, `e53c6b6` | `m35-wu04-ci-acceleration-and-closure`, `m35-test-suite-rationalization` (this closure) | Node 22 removed from the mandatory CI matrix; Node 24 made the sole authoritative runtime; `.github/workflows/validate.yml` split from one sequential job into 4 parallel jobs (`quality`, `build`, 3-way sharded `test`, `version-check`) with the build artifact reused across jobs rather than rebuilt; package version bumped 0.19.0→0.20.0 (a real governance-gate finding, caught and fixed by CI itself on the first real run of this topology); this closure report. |

## Before/After Test Counts

| | Before (WU35-01 baseline) | After (WU35-04, final) |
| --- | --- | --- |
| Test files | 232 | 233 (+1: WU35-01's own architecture guard, `tests/unit/m35-test-inventory-classification.test.ts`) |
| Tests | 2401 | 2408 (+7: the new guard's own test count) |
| Files removed/merged | — | 0 |
| Files with corrected classification | — | 18 (prompt-generation, Low-signal → Normal) |

**No test was removed or merged in this milestone.** Every investigated candidate (Sec 5 of `docs/engineering/m35-test-suite-inventory.md`) was confirmed either genuinely non-actionable on direct inspection, or explicitly deferred as a layer/runtime optimization concern rather than a deletion concern. This is consistent with the build spec's own governing principle ("reduce waste, preserve signal, measure everything") and its explicit invariant that raw test count is not a quality metric.

## Critical Coverage Map

All 12 of the build spec's required critical-coverage categories were confirmed non-empty at both WU35-01 and WU35-04 (verified via `tests/unit/m35-test-inventory-classification.test.ts`, which fails loudly if any required domain empties out):

canonical state (4 files) · schema compatibility (13) · persistence/runlog recovery (3) · workflow assessment (11) · corruption repair (6) · CLI machine contract (5) · exit-code invariants (within cli-machine-contract) · built-binary behavior (1) · security/command boundaries (13) · Git/worktree safety (15) · evidence binding (25) · execution lifecycle (31).

**Zero critical coverage was lost or reduced by this milestone.**

## Removed/Merged Tests With Evidence

None. See "Before/After Test Counts" above.

## Layer Migrations

One (WU35-03 Sec 9.2 of `docs/engineering/m35-test-suite-inventory.md`): `m33-result-contract-characterization.test.ts`'s state/runlog non-mutation test moved 6 of its 7 CLI-subprocess calls to direct in-process calls against the same functions (`runReviewCommand`, `runStatus`) the CLI itself dispatches to. Measured effect: 136.1s → 62.8s isolated (54% reduction). All 20 of the file's tests, including its untouched process-level stream-contract tests, still pass.

## Slowest Remaining Suites

Per `docs/engineering/m35-test-suite-inventory.md` Sec 4.5/5.1: 30 files still exceed 10s individually and collectively account for ~96% of total measured execution time (unchanged set from WU35-01, since WU35-03 optimized one representative file from this set rather than all 30). This is recorded as a legitimate, evidenced future opportunity for further WU35-03-style optimization, not a gap this milestone was required to close in full — WU35-03 deliberately prioritized 2 individually-verified changes over an unreviewed sweep across all 30 files.

## Timeout/Assertion Counts

Every full-suite measurement across all 4 Work Units showed either zero failures or exclusively pure-timeout-class failures (verified via isolated re-runs in WU35-03; consistent with the extensively-documented M34 machine-load-contention pattern). **Zero assertion regressions were introduced by this milestone at any point.** The one recurring flaky file (`evidence-advisory-hardening.test.ts`) is unchanged from M34 and remains an open, honestly-documented residual risk, not a new finding.

## Built-Binary Results

`tests/integration/built-binary-smoke.test.ts` (10 tests, from M34-WU03) passed in every CI run gathered for this closure — it is included in whichever of the 3 test shards it lands in, and every shard downloads the `dist/` artifact the `build` job produces, so the built-binary suite always has a real artifact to exercise regardless of shard assignment.

## CI Topology

**Before (M34 baseline):** one sequential job per Node version (`typecheck → lint → build → test → version-check`), matrix `[22, 24]`. Node 24 leg: ~505-520s (~8.5min); Node 22 leg: ~850-860s (~14.2min, the workflow's actual wall-clock since both legs ran in parallel and the slower one determines total time).

**After (this milestone):** 4 parallel jobs, Node 24 only:
- `quality` (typecheck + lint): ~30-40s.
- `build` (`pnpm build`, uploads `dist/` as an artifact): ~28-30s.
- `test` (3-way `vitest --shard` matrix, each downloading the `dist/` artifact): the long pole, ~2m45s-3m37s per shard across 3 confirmed CI runs.
- `version-check` (needs `[build, test]`, downloads `dist/`): ~28s.

## Runtime Confirmation (3 real CI runs, workflow run 30914712860)

| Run | Started | Completed | Wall-clock | Conclusion |
| --- | --- | --- | --- | --- |
| 1 | 13:37:01 | 13:41:46 | 284.0s (4.73 min) | success |
| 2 | 13:42:37 | 13:46:53 | 256.0s (4.27 min) | success |
| 3 | 13:47:35 | 13:52:38 | 303.0s (5.05 min) | success |

**Average: 281.0s (4.68 min). 2 of 3 runs under the 5-minute target; the third (5.05 min) marginally exceeded it.** This is reported honestly rather than rounded favorably — the build spec's own acceptance criterion is "below five minutes **where safely achievable**," and this evidence shows the target is typically but not unconditionally achieved, consistent with real CI-runner scheduling variance (the same variance this repository has independently documented for local-machine timing throughout M34). All 3 runs' `test` shards, `quality`, `build`, and `version-check` jobs passed cleanly with zero failures — the variance is in wall-clock only, not in reliability.

**Reduction from the pre-M35 baseline:** ~505-520s (Node 24, single sequential job) → 281.0s average (4 parallel jobs) — a **~46% wall-clock reduction**, achieved primarily through horizontal job/shard parallelism rather than through reducing the underlying suite's total test-execution cost (which this milestone's investigation found little safe, evidenced opportunity to reduce — see "Before/After Test Counts" above).

## OS Results

Unchanged: `ubuntu-latest` only, no macOS or additional Windows CI runner. Not a regression introduced by this milestone; not resolved by it either — the build spec did not require adding an OS.

## CI/Local Alignment

`pnpm validate` (local) still runs all 5 checks sequentially in one process for developer convenience; CI now runs the same 5 checks distributed across 4 parallel jobs for speed. This is an intentional divergence in *topology*, not in *content* — the exact same commands (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `vitest run` [sharded in CI, unsharded locally], `pnpm version:check`) run in both places; only the process/job boundaries differ.

## Findings Closed or Reduced

- The build spec's core objective (CI duration reduction toward <5 minutes): **substantially achieved** (~46% reduction, 2/3 confirmed runs under target, honestly reported as not unconditionally guaranteed on every single run).
- Node 22/CI-matrix inconsistency risk (build spec Sec 2's explicit warning against promising support without validating it): **closed** — Node 22 removed from `engines.node`, CI, and README simultaneously.
- Test-suite classification/criticality visibility (previously nonexistent): **closed** — every file now has a recorded classification, machine-readable and architecture-guard-enforced.
- Suspected duplicate/obsolete test debt: **investigated, not confirmed** — the suite showed less actual waste than the raw candidate list suggested; this is a genuine, evidenced finding (not an excuse not to look), and is recorded as such rather than forcing an unjustified reduction.
- One real governance-process finding: the version-bump requirement almost shipped missed on the first real CI run of this milestone's own changes, caught by the repository's own `version:check` gate exactly as designed, and fixed in the same Work Unit.

## Residual Risks

- **The <5-minute target is not unconditionally guaranteed** — one of 3 confirmed runs (5.05 min) marginally exceeded it. Further shard-count tuning or rebalancing (the 3 shards are unbalanced by vitest's default file-order sharding, not by measured cost) could tighten this margin in a future Work Unit, but was not required to close this milestone given "where safely achievable" is the spec's own qualifier.
- **29 of the 30 performance-heavy files identified in WU35-01 remain unoptimized** — WU35-03 deliberately optimized one representative file rather than sweeping all 30 without adequate review. This is recorded as a legitimate, bounded future opportunity, not a milestone gap.
- **`@types/node` remains pinned at `^22.5.0`** despite `engines.node` now requiring `>=24.0.0` — considered and deliberately deferred (not required by the build spec's explicit Node-contract-reconciliation list: `engines.node`, README, CI matrix, versioning policy; Node's own type definitions are commonly forward-compatible enough that this was judged non-blocking).
- **The one recurring flaky file** (`evidence-advisory-hardening.test.ts`, unchanged since M34) remains an open, honestly-carried-forward residual risk.
- **The prompt-generation domain's 18-file reclassification (Low-signal → Normal) sampled only 4 files directly** — the remaining 14 were not individually read; the corrected classification is a conservative floor, not a verified claim about every file.

## Recommendation on Autonomous-Runner Planning

Per the build spec's own Sec 11 sequencing note, the previously-drafted autonomous-runner milestone is renumbered **M36 — Autonomous Maintenance Runner and Safety Controls**, and its implementation must not begin until M35 closes successfully. Given this milestone's evidenced, honestly-reported outcomes above (real CI improvement achieved and confirmed across 3 runs; zero critical coverage lost; zero test removed without justification; the one governance-gate finding caught and fixed, not glossed over), **M35 is considered closed, and M36 planning may proceed on this basis.** M36 implementation has not begun as part of this closure.
