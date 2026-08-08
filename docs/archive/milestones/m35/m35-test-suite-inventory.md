# AIQT Milestone 35 — Test Suite Inventory (WU35-01)

## Purpose

The complete evidence base required before any test is deleted, merged, rewritten, or moved (build spec Sec 7, WU35-01). This document classifies every test file and summarizes measurements; `docs/engineering/m35-test-suite-inventory.generated.json` is the full machine-readable per-file record this document summarizes (233 rows, one per file — regenerable via `npx tsx src/tooling/test-inventory-cli.ts`).

**A note on the 232 vs. 233 figure used throughout this document:** all runtime measurements in Sec 4 were captured from a `vitest run --reporter=json` executed against the 232 test files that existed *before* this Work Unit added its own architecture guard, `tests/unit/m35-test-inventory-classification.test.ts` (Sec 8 below) — the same self-reference timing issue M34's own inventory test (`tests/unit/m34-validation-workload-inventory.test.ts`) had, and resolved the same way: measure the pre-existing baseline, then add the guard afterward rather than re-running the full suite an extra time solely to include the newest self-referential file. Sec 3's classification counts (233 files, 61 Critical) reflect the final post-WU35-01 state including that new file; Sec 4's runtime figures (232 files, 2401 tests) reflect the pre-WU35-01 measurement run.

**No test was deleted, merged, rewritten, skipped, or moved as part of this Work Unit.**

## 1. Baseline

| | |
| --- | --- |
| Branch | `main` |
| Starting commit | `fb98d76b0472d0ea0bf2e7a2363455555eb8a78d` |
| Package version | `0.19.0` |
| Canonical schema version | `0.5.0` |
| Node | v24.14.0 |
| pnpm | 7.33.5 |
| OS | Windows 10 Pro for Workstations, build 19045 |
| CPU | AMD Ryzen 7 3800X, 8 cores / 16 logical processors |
| Memory | 16,700,712 KB (~16 GB) total, ~3.7 GB free at measurement time |

M34 evidence verified complete before this Work Unit began: all 6 `m34-*` tags present (`m34-wu01-validation-workload-policy` through `m34-wu04-validation-gate-closure`, plus `m34-deterministic-validation-gate` and `m34-validation-gate-ci-confirmed`); `docs/m34-closure-report.md`, `docs/m34-validation-workload-policy.md`, `docs/m34-ci-reliability-confirmation.md` all present; `tests/workload-timeout-policy.ts` and `src/tooling/repeated-run-validation-cli.ts` both present.

## 2. Node Support Contract

### Current state (before this Work Unit)

- `package.json#engines.node`: `">=22.0.0"`
- CI matrix (`.github/workflows/validate.yml`): `node-version: [22, 24]`, both mandatory per-commit
- `README.md`: "the supported Node.js versions (`package.json#engines`, currently 22 and 24)"
- No Node-version-specific statement exists in `docs/engineering/versioning.md` or any release-policy document
- No scheduled/periodic GitHub Actions workflow exists in this repository (`validate.yml` is the sole workflow; no `schedule:` trigger anywhere)

These four sources are currently mutually consistent (all say "Node 22 and 24, both mandatory"), so there is no pre-existing inconsistency to reconcile in this Work Unit — the inconsistency this Work Unit prevents is a *future* one, if Node 22 were dropped from CI without updating the other three.

### Decision

Per the build spec's explicit choice (Sec 2) and the direct, real-time instruction already given during the M34 CI reliability confirmation ("no need to run the Node 22 as it's going to be removed"):

```text
Preferred:
Official runtime: Node 24
Node 22: unsupported
```

**Rationale for Preferred over Transitional:** Transitional requires standing periodic-compatibility CI infrastructure (a scheduled workflow) that does not currently exist anywhere in this repository — choosing it would mean *adding* new CI surface area in a milestone whose stated goal is reducing CI surface area and duration. Preferred requires no new infrastructure, only removing the Node 22 matrix leg and updating three documentation/config surfaces. This is also consistent with the already-observed CI evidence: across the M34 confirmation's 3 fully-completed Node 22 runs, results were identical to Node 24 (same pass/fail, same test counts) — there is no known Node 22–specific behavior this repository currently depends on or tests for.

### Required later changes (deferred to WU35-04 per this Work Unit's scope)

| Surface | Current | Required change |
| --- | --- | --- |
| `package.json#engines.node` | `">=22.0.0"` | `">=24.0.0"` |
| `.github/workflows/validate.yml` | `node-version: [22, 24]` | `node-version: [24]` (or remove the matrix entirely if only one version remains) |
| `README.md` line 159 | "currently 22 and 24" | "currently 24" (or equivalent) |
| `docs/engineering/versioning.md` | no Node-version statement | none required (no existing claim to correct) |

**Versioning impact:** none. This is a support-contract change, not a semver-relevant behavior change under `docs/engineering/versioning.md`'s policy (that policy governs the CLI's own behavior/schema/contract, not the repository's own CI/engines metadata). No package version bump is implied by this decision alone.

**Not implemented in this Work Unit**, per its explicit scope boundary ("defer actual CI removal to WU35-04 unless repository governance explicitly requires the support contract to change now" — no such requirement was found; the current state is self-consistent, so there is no urgency forcing an earlier change).

## 3. Inventory Summary

| Metric | Value |
| --- | --- |
| Total test files (final, including this Work Unit's own architecture guard) | 233 |
| Total test files measured for runtime (Sec 4, pre-WU35-01 baseline) | 232 |
| Total tests (actual, from a full `vitest run --reporter=json`) | 2401 |
| Total tests (static `it(` count — undercounts `it.each`-generated cases) | 2265 |
| Layer: `tests/unit/` | 122 files |
| Layer: `tests/integration/` | 111 files |
| Skipped or conditional tests (`it.skip`/`describe.skip`/`it.todo`/`skipIf`) | **0 files** (WU35-01 baseline; see the M38-WU02 addendum below for the one deliberate departure) |
| Platform-specific tests (`process.platform` branches) | **1 file** (WU35-01 baseline; see the M38-WU02 addendum below) |

**M38-WU02/WU04 addendum (deliberate departures from the "zero skipped tests" baseline above):** `tests/integration/sandbox-docker-backend.test.ts` (WU38-02) and `tests/integration/sandbox-live-execution.test.ts` (WU38-04) both use `describe.skipIf(!dockerAvailable)` for their real-container assertions; the former also has a `process.platform !== "linux"` branch for one internal-consistency check. Docker is an external host dependency this repository's own CI provides (Linux/`ubuntu-latest`, per `docs/engineering/m38-sandbox-platform-decision.md`) but that is not guaranteed on every developer machine (this project was developed partly on Windows, which has no Docker installed at all) -- each suite probes real availability via `DockerSandboxBackend.checkAvailability()` and skips with a logged reason when absent, never silently passing and never failing the whole run over an environment precondition outside the code's control. These are the two reviewed exceptions to the WU35-01 "zero skipped tests" invariant; `tests/unit/m35-test-inventory-classification.test.ts`'s own guard tests were updated in each commit to expect exactly these files in the skipped-file/platform-guarded-file baselines, so any further, undocumented drift still fails loudly.

### 3.1 Workload class distribution

| Workload class | Files | Basis |
| --- | --- | --- |
| Fast unit | 121 | `tests/unit/`, no subprocess/built-binary spawn detected |
| Filesystem integration | 77 | `tests/integration/`, no subprocess spawn, uses `makeTempDir`/`copyFixture`/`contextFor` |
| CLI subprocess integration (general) | 11 | spawns the CLI (`tsx` or `dist/index.js`), no Git spawn |
| Git/worktree integration | 4 | spawns `git` directly, no CLI spawn |
| Evidence/execution/workspace integration | 19 | spawns both the CLI and `git` |
| Built-binary smoke | 1 | `tests/integration/built-binary-smoke.test.ts` |

This reproduces M34's own classification almost exactly (M34 counted 34 known-spawning files across its 4 spawning classes; this inventory's equivalent sum is 11+4+19+1 = 35 — the +1 is `tests/unit/shared-repository-provider.test.ts`'s Git-adjacent test being re-scoped, see `docs/engineering/m35-test-suite-inventory.generated.json` for the exact per-file diff against M34's `KNOWN_SPAWNING_FILES`). No new spawning file was introduced by this Work Unit; the classification tool is independently derived from M34's own detection regexes (`hasGitSpawn`/`hasCliSpawn` in `tests/unit/m34-validation-workload-inventory.test.ts`), confirming continuity.

### 3.2 Criticality distribution

| Criticality | Files | % of suite |
| --- | --- | --- |
| Critical | 61 | 26% |
| High-value | 87 | 37% |
| Normal | 85 | 36% |
| Low-signal | 0 (see Sec 5A — corrected after WU35-02 investigation) | 0% |
| Duplicate | 0 (candidates identified below; none confirmed after WU35-02 investigation) | — |
| Obsolete | 0 (candidates identified below; none confirmed after WU35-02 investigation) | — |
| Misplaced | 0 (investigated; none confirmed) | — |
| Flaky | 1 (confirmed, see Sec 5.4) | <1% |
| Performance-heavy | 30 (see Sec 5.1) | 13% |

**These are the final, post-WU35-02 figures.** The WU35-01 baseline originally classified 18 files as Low-signal (`prompt-generation` domain) and 67 as Normal; WU35-02's direct investigation (Sec 5A) found the Low-signal classification did not hold up on inspection and corrected it, moving all 18 into Normal.

The last four rows are not mutually exclusive with the first four (e.g. the one confirmed Flaky file is separately classified High-value; several Performance-heavy files are Critical). "Duplicate," "Obsolete," and "Misplaced" show 0 *confirmed* because this Work Unit's mandate is investigation, not deletion — every candidate below requires the owner review WU35-02 will perform before any status changes to "confirmed."

### 3.3 Feature-domain distribution

| Domain | Files | Representative critical coverage |
| --- | --- | --- |
| execution-lifecycle | 31 | execution session schema/service/transitions, adapter normalization |
| evidence-binding | 25 | evidence-gate policy/simulation/enforcement, external-evidence schemas |
| work-packet-lifecycle | 19 | agent packet creation/audit, next-selection, parallel eligibility |
| prompt-generation | 18 | (all Low-signal — see Sec 5.3) |
| plan-lifecycle | 17 | plan ingestion, extension, dependency graph mutation |
| review-and-issues | 16 | finding fingerprinting/routing, issue lifecycle |
| git-worktree-safety | 15 | Git command runner, worktree provider, workspace lifecycle |
| schema-compatibility | 13 | historical-state compatibility, schema definitions |
| security-boundary | 13 | M27/M27R/M28 boundary scans, repository/source-control discipline |
| workflow-assessment | 11 | dependency readiness, effective readiness, recommendation engine |
| checkpoint-lifecycle | 9 | checkpoint completion gate, amendment, status transitions |
| read-only-views | 9 | status/manage/export consistency |
| project-bootstrap | 8 | init/update, root resolution |
| corruption-repair | 6 | graph repair, graph validation |
| release-tooling | 6 | semver, version-check, push-base |
| cli-machine-contract | 5 | `cli.test.ts`, M33 contract matrix, exit-10 invariant |
| canonical-state | 4 | atomic write, canonical field preservation |
| persistence-runlog | 3 | runlog append/recovery, workspace recovery |
| self-consistency | 2 | dogfood regression guards |
| built-binary | 1 | `built-binary-smoke.test.ts` |
| validation-infrastructure | 2 | M34's and M35's own inventory characterization tests |

**Critical coverage checklist (build spec Sec 5's explicit minimum list) — all present:**

| Required critical coverage | Covered by (domain) |
| --- | --- |
| Canonical state integrity | canonical-state (4 files) |
| Schema compatibility | schema-compatibility (13 files) |
| Persistence and runlog recovery | persistence-runlog (3 files) |
| Workflow assessment | workflow-assessment (11 files) |
| Corruption repair | corruption-repair (6 files) |
| CLI machine contract | cli-machine-contract (5 files) |
| Exit-code invariants | `m33-exit10-and-owner-inventory.test.ts`, `m33-cli-contract-matrix.test.ts` (within cli-machine-contract) |
| Built-binary behavior | built-binary (1 file) |
| Security and command boundaries | security-boundary (13 files) |
| Git/worktree safety | git-worktree-safety (15 files) |
| Evidence binding | evidence-binding (25 files) |
| Execution lifecycle | execution-lifecycle (31 files) |

## 4. Runtime Measurements

All measurements below are from a full `vitest run --reporter=json` executed on this Work Unit's own baseline commit, on the local machine described in Sec 1, immediately after a clean `pnpm build`.

### 4.1 Non-test step durations (local)

| Step | Duration |
| --- | --- |
| `pnpm typecheck` | 3.9s |
| `pnpm lint` | 5.9s |
| `pnpm build` | 4.9s |

These three steps are collectively under 15 seconds and are **not** a meaningful contributor to CI duration — confirmed also by CI's own logs (Sec 4.3): the `Test` step alone accounts for ~92% of the Node 24 job's total wall-clock.

### 4.2 Test execution (local)

| Metric | Value |
| --- | --- |
| Local wall-clock, full suite (`vitest run`) | ~182s (~3.0 min) |
| Total tests | 2401 (2400 passed, 1 failed — see Sec 5.4, the known flaky file) |
| Sum of all files' individual durations (not wall-clock; overlapping across worker threads) | 1783.0s |

**Local timings are not directly comparable to CI timings** — this development machine (8-core/16-thread Ryzen 7 3800X) has materially more parallel headroom than a standard GitHub Actions `ubuntu-latest` runner (typically 4 vCPUs for public-repo runners). Sec 4.3's CI-sourced figures are the authoritative ones for the milestone's actual `<5 minute` target.

### 4.3 Authoritative CI wall-clock (from the M34 CI reliability confirmation's real, already-gathered evidence)

| Leg | Job elapsed (avg. across confirmed runs) | `Test` step duration (avg.) | `Test` step as % of job |
| --- | --- | --- | --- |
| Node 24 | ~9m8s | ~505s (~8.4 min) | ~92% |
| Node 22 | ~14m57s | ~850s (~14.2 min) | ~95% |

Source: `docs/m34-ci-reliability-confirmation.md`'s 4-run table (job IDs `91953678639/706`, `91957302353/417`, `91960969368/458`, `91964518972`). Because CI's matrix runs both legs in parallel, the workflow's overall wall-clock is the *slower* leg — currently Node 22 at ~15 minutes. **Once Node 22 is removed from the mandatory matrix (WU35-04, Sec 2 above), the authoritative CI wall-clock becomes the Node 24 figure alone: ~9 minutes** — still above the milestone's `<5 minute` target, confirming that Node-version reduction alone is insufficient and the actual test-suite rationalization (WU35-02/WU35-03) is required to reach the target.

### 4.4 Process, worker, and repeated-setup counts

| Metric | Value |
| --- | --- |
| Vitest pool | `threads` (unchanged since M21; `vitest.config.ts` sets no `maxWorkers`/concurrency override) |
| Files that spawn the CLI as a subprocess | 30 (11 CLI-only + 19 CLI+Git) |
| Files that spawn `git` as a subprocess | 23 (4 Git-only + 19 CLI+Git) |
| Distinct CLI process launches (approximate, via `it(` count in the 30 CLI-spawning files) | 200+ (most spawning tests launch 1–13 CLI processes per test; `m33-result-contract-characterization.test.ts`'s heaviest single test alone launches 13 chained CLI invocations, per M34's own measurement) |
| Repeated Git-worktree creation | Every file in `git-worktree-safety`'s workspace-\* subset (10 files) creates and tears down at least one real disposable Git repository/worktree per test file; several create one per test |
| Repeated builds during a single suite run | 0 — the suite runs against `dist/index.js` built once (built-binary-smoke) or `src/index.ts` via `tsx` (no build) for every other spawning file; no test triggers its own `pnpm build` |

This confirms M34's own finding (`docs/m34-validation-workload-policy.md` Sec 3): subprocess-spawn cost, not raw test *count*, dominates runtime. The 35 spawning files are 15% of the suite by file count but, per Sec 4.5 below, over 96% of measured execution time.

### 4.5 Slowest 50 files

Full list in `docs/engineering/m35-test-suite-inventory.generated.json` (sorted separately by the analysis script; every file's `durationMs` field is present). Top 15 shown here; all 30 files exceeding 10 seconds are exactly the set of CLI/Git/built-binary-spawning files (Sec 3.1), confirming that criticality and workload class — not domain — predict runtime cost:

| # | File | Duration | Domain | Criticality |
| --- | --- | --- | --- | --- |
| 1 | `tests/integration/cli.test.ts` | 181.7s | cli-machine-contract | Critical |
| 2 | `tests/integration/m33-result-contract-characterization.test.ts` | 136.1s | cli-machine-contract | Critical |
| 3 | `tests/integration/evidence-gate-simulate.test.ts` | 108.0s | evidence-binding | High-value |
| 4 | `tests/integration/execution-external-import.test.ts` | 95.6s | execution-lifecycle | High-value |
| 5 | `tests/integration/execution-adapter-claude-code-import.test.ts` | 94.2s | execution-lifecycle | High-value |
| 6 | `tests/integration/evidence-gate-hardening.test.ts` | 69.8s | evidence-binding | High-value |
| 7 | `tests/integration/evidence-gate-policy.test.ts` | 69.4s | evidence-binding | High-value |
| 8 | `tests/integration/evidence-advisory-hardening.test.ts` | 69.4s | evidence-binding | High-value (also: Flaky, Sec 5.4) |
| 9 | `tests/integration/execution-next-cancel-safeguard.test.ts` | 67.6s | execution-lifecycle | High-value |
| 10 | `tests/integration/workspace-cli.test.ts` | 67.5s | git-worktree-safety | High-value |
| 11 | `tests/integration/execution-import-cli.test.ts` | 66.7s | execution-lifecycle | High-value |
| 12 | `tests/integration/execution-adapter-claude-code-request.test.ts` | 62.3s | execution-lifecycle | High-value |
| 13 | `tests/integration/evidence-import-cli.test.ts` | 62.2s | evidence-binding | High-value |
| 14 | `tests/integration/execution-hardening.test.ts` | 60.2s | execution-lifecycle | High-value |
| 15 | `tests/integration/execution-external-hardening.test.ts` | 57.2s | execution-lifecycle | High-value |

**Cost concentration:** the top 5 files alone account for 34.5% of total measured execution time; the top 10, 53.8%; the top 20, 82.4%; the top 30 (the full performance-heavy set, Sec 5.1), 96.0%. This is the single most important number for WU35-03's prioritization: optimizing roughly 13% of files addresses the overwhelming majority of the suite's actual runtime cost.

## 5. Candidates (investigation only — no action taken)

### 5.1 Performance-heavy (30 files, all exceeding 10s per-file wall-clock)

The full set (in descending duration order) is every file already counted in Sec 3.1's CLI/Git/built-binary workload classes except 5 of the fastest spawning files (`execution-metadata-runlog-recovery.test.ts` at 11.1s is the cutoff; `workspace-hardening.test.ts` at 6.5s and below are not included). Exact list and durations: `docs/engineering/m35-test-suite-inventory.generated.json`, filter `durationMs > 10000`.

**Recommended action:** `investigate` for WU35-03 (Test Layer and Runtime Optimization) — the build spec's own example transformations (CLI subprocess → service-level test; repeated Git setup → shared helper; multiple subprocesses → batched scenario) apply directly to this set. None are recommended for outright removal — every one of these 30 files is Critical or High-value by domain (Sec 4.5's top 15 shows exactly this).

### 5.2 Flaky (1 confirmed)

`tests/integration/evidence-advisory-hardening.test.ts` — the specific pre-existing per-test `}, 30000);` inline timeout override on this file's heaviest test has now been independently observed failing under sustained machine load in **three separate occasions across M34 and this Work Unit**: WU34-02's run 4/5, WU34-03's follow-up diagnostic run, and this Work Unit's own baseline measurement run (Sec 4.2 — 1 of 2401 tests failed, this exact test, confirmed pure `Test timed out`, zero `AssertionError`). This is the single most evidence-backed flaky candidate in the suite. **Recommended action:** `investigate` — a WU35-03 candidate for either a further-isolated timeout tier or a layer move (e.g., reducing the number of chained CLI spawns this specific test performs), not a WU35-02 deletion candidate (it is High-value, evidence-binding coverage).

No other file showed any failure across this Work Unit's single measurement run. This is not, by itself, proof no other file is ever flaky — it is one data point, consistent with M34's much larger body of repeated-run evidence (`docs/m34-validation-workload-policy.md`, `docs/m34-ci-reliability-confirmation.md`) that this is the one recurring, named exception rather than a systemic problem.

### 5.3 Low-signal (18 files, all in the `prompt-generation` domain)

Every file in `prompt-generation` (Sec 3.3) was classified Low-signal by this Work Unit's heuristic: these files assert on generated **prompt text content** (wording, structure, formatting of copy-paste prompts for external agents) rather than on AIQT's own state-machine or persistence behavior. Full list: `component-system-preferences.test.ts`, `design-system-planner.test.ts`, `full-stack-detection.test.ts`, `prompt-driver-design-system.test.ts`, `prompt-driver-operating-discipline.test.ts`, `prompt-interview-design-system.test.ts`, `prompt-out-path.test.ts`, `prompt-plan-component-system.test.ts`, `prompt-plan-design-system.test.ts`, `prompt-plan-extend.command.test.ts`, `prompt-root-context.test.ts`, `prompt-templates.test.ts`, `prompt.command.test.ts`, `select-relevant-skills.test.ts`, `skills-detection-service.test.ts`, `skills-plan-design-aids.test.ts`, `skills-plan.command.test.ts`, `ui-heavy-detection.test.ts`.

**This is a heuristic classification, not a verified judgment on each file's actual assertion quality** — WU35-01 did not read all 18 files' individual assertions (out of this Work Unit's inventory-only scope). **Recommended action:** `investigate` for WU35-02, file by file, checking specifically for the two patterns the build spec names (weak assertions; tests that verify only private implementation details) before any reduction — this domain is explicitly **not** pre-classified as Critical or High-value in Sec 3.3, so it does not require the build spec's owner-review gate before a WU35-02 reduction decision, but it does still require the deletion-evidence record (`docs/engineering/m35-test-rationalization-policy.md`) for any file actually touched.

### 5.4 Duplicate/near-duplicate candidates

| Cluster | Files | Investigation finding |
| --- | --- | --- |
| Historical schema-compatibility quintet | `m22-compatibility.test.ts`, `m22-historical-compatibility.test.ts`, `m24-historical-compatibility.test.ts`, `m25-historical-compatibility.test.ts`, `m26-historical-compatibility.test.ts` | **Not verified as duplicate.** Each very plausibly protects a distinct historical schema-migration boundary (a real regression risk if collapsed incorrectly). No minimum-supported-schema-version floor is documented anywhere in this repository (checked `docs/engineering/versioning.md`) that would make an early boundary provably obsolete. Recommended action: `investigate` — WU35-02 must read each file's actual fixture/assertions individually and, per the build spec's Critical-tier owner-review requirement (these are `schema-compatibility`, classified Critical), obtain explicit review before any merge. |
| `checkpoint-next-flow.test.ts` vs. `next-checkpoint-flow.test.ts` | 2 files with near-identical names | **Checked directly — not duplicate.** `checkpoint-next-flow.test.ts` covers `init → update → plan → next → checkpoint` (the full chain into the next action); `next-checkpoint-flow.test.ts` covers `init → update → plan → next` only, stopping at "checkpoint recommended." Distinct scope. Flagged instead as a **naming-clarity** issue (confusing near-identical names, easy to misidentify as redundant) — recommended action: `investigate` for a rename in a future Work Unit, not a merge. |
| `execution-adapter-claude-code-*` (5 files) vs. `execution-external-*` (3 files) | Parallel test-suite shapes for two structurally similar adapter families (M27's Claude Code adapter vs. M27R's generic external adapter) | **Not duplicate** (genuinely different adapters, both real product surfaces) but a strong structural-repetition signal — both families independently re-implement similar fixture setup and assertion shapes. Recommended action: `investigate` for WU35-03 (shared-helper extraction), not WU35-02 (no deletion implied). |
| `review-*` sextet | `review.command.test.ts`, `review-acknowledge.command.test.ts`, `review-mode.command.test.ts`, `review-findings.test.ts`, `review-next-command.test.ts`, `review-rules-finding-keys.test.ts` | **Not individually verified.** Flagged only because of file-count concentration in one domain (16 files in `review-and-issues`, 6 with a `review-` prefix). Recommended action: `investigate` for WU35-02 — read for overlapping assertions before any consolidation decision. |

No cluster in this section is recommended for deletion or merge by this Work Unit — every recommendation is `investigate`, consistent with WU35-01's explicit "do not delete, merge, rewrite" boundary.

### 5.5 Obsolete-behavior candidates

`tests/integration/execution-adapter-claude-code-legacy-compat.test.ts` is the only file in the suite whose name self-declares testing a superseded shape ("legacy-compat"). **Not recommended for removal** without further investigation: a legacy-compatibility test's entire purpose is proving old data still works correctly under current code — removing it would silently drop a real backward-compatibility guarantee, not just delete dead weight. Recommended action: `investigate` for WU35-02 — confirm what specific legacy shape it protects and whether that shape can still occur in practice (i.e., whether any currently-supported schema version could produce it) before any decision.

No behavior removed by M31–M34 was found to have an orphaned test still asserting on the old (now-removed) behavior — the M31–M34 work in this repository consistently updated or added tests alongside behavior changes rather than leaving stale assertions behind (spot-checked via `docs/m32-closure-report.md` through `docs/m34-closure-report.md`'s own "Findings Closed" sections, each of which records the corresponding test changes).

### 5.6 Misplaced candidates

**None found.** Every `tests/integration/*.test.ts` file either spawns a subprocess (CLI/Git) or uses a real temporary-directory/fixture-copy helper (`makeTempDir`/`copyFixture`/`contextFor`) — i.e., every integration-layer file does something a `tests/unit/` file structurally cannot (real subprocess, real filesystem I/O against a real fixture). This is a genuine negative finding, not an omission: the classifier explicitly checked for integration-layer files with none of these three signals and found zero.

## 6. Deletion-Evidence Policy Pointer

See `docs/engineering/m35-test-rationalization-policy.md` for the full deletion-evidence contract required before any future removal or merge (build spec Sec 6), and the owner-review requirement for Critical/High-value tests.

## 5A. WU35-02 addendum — investigation results

WU35-02 investigated all four `investigate`-flagged clusters from Sec 5.4/5.5 and sampled the Sec 5.3 Low-signal domain by directly reading each cluster's actual test files (not filename pattern-matching). **Result: zero tests removed, zero tests merged, zero assertion changed. One domain's criticality classification corrected** (Sec 5.3 below). This is itself the honest evidence-based outcome the build spec's governing principle ("preserve signal... measure everything") anticipates — investigation does not automatically produce a reduction, and forcing one without genuine evidence would violate the explicit "no test removed merely to improve runtime" invariant (build spec Sec 3, #11).

**Historical schema-compatibility quintet — confirmed NOT duplicate.** Reading all 5 files' `describe`/`it` blocks directly: `m24-historical-compatibility.test.ts` protects the absence of `executionMetadata` (added M24), `m25-historical-compatibility.test.ts` protects the absence of `workspace` (added M25), `m26-historical-compatibility.test.ts` protects the absence of `executionSessions` (added M26), `m22-historical-compatibility.test.ts` protects the absence of `projectIssues`/`projectIssueTransitions` (added M22), and `m22-compatibility.test.ts` is a materially different, broader M22-WU09 integration test (classification/promotion/compatibility behavior, not a pure schema-absence-tolerance check). This is a deliberate, systematic pattern — each milestone that adds a new schema field gets its own dedicated "does absence of my field break anything" test — not incidental duplication. **No action taken; all 5 files retained as Critical.**

**`review-*` sextet — confirmed NOT duplicate.** Reading all 6 files' `describe`/`it` blocks directly: `review.command.test.ts` covers the core review flow and integrity findings; `review-acknowledge.command.test.ts` covers the `review acknowledge` subcommand specifically; `review-mode.command.test.ts` covers the `--mode` flag; `review-findings.test.ts` unit-tests `sortAndAssignFindingIds`; `review-next-command.test.ts` unit-tests `computeReviewNextCommand`/`computeRecommendedExportTargets`; `review-rules-finding-keys.test.ts` unit-tests finding-key determinism. Six genuinely distinct command surfaces and pure functions. **No action taken; all 6 files retained.**

**`execution-adapter-claude-code-legacy-compat.test.ts` — confirmed NOT obsolete.** Reading the file directly: it tests that "a pre-M27R legacy `anthropic/claude-code` session remains valid, resumable by the Claude adapter, and is reported as `legacy_provider_specific_session`," and that a Claude-adapter resume can target a session created by the generic path. This is real, currently-reachable backward-compatibility behavior, not dead-code coverage. **No action taken; file retained as High-value.**

**Low-signal `prompt-generation` domain (18 files) — heuristic classification corrected to Normal.** Sampled 4 files directly (2 mid-size integration files, 1 small unit file, 1 small unit file testing security-relevant path validation): `prompt-interview-design-system.test.ts` (positive/negative branches of design-discovery-question inclusion), `prompt-driver-design-system.test.ts` (positive/negative branches of design-system guidance plus a before-`aiqt init` precondition check), `full-stack-detection.test.ts` (case-insensitivity and full documented-keyword-enumeration edge cases on a pure detector function), and `prompt-out-path.test.ts` (path-traversal and string-prefix-confusion-attack rejection — genuinely security-relevant, arguably under-classified even at Normal). **None of the 4 sampled files showed weak assertions or private-implementation-detail-only testing** — the WU35-01 heuristic (classifying by domain-name association, "prompt generation sounds cosmetically low-value") did not hold up under direct reading. `src/tooling/test-inventory-classifier.ts`'s `prompt-generation` rule was corrected from `Low-signal` to `Normal` (see the rule's own in-line comment for the full reasoning). **No file removed, merged, or rewritten; this is a classification correction only**, made because continuing to carry an evidence-contradicted "Low-signal" label forward would itself be a documentation-accuracy regression. The remaining 14 unsampled files in this domain were not individually read — the corrected classification is a conservative floor (Normal), not a claim that every file is at least Normal-quality; a future Work Unit remains free to investigate further.

Combined with Sec 5.6's existing negative finding (0 misplaced files, verified) and Sec 5.2's single confirmed-flaky file (unchanged by this addendum, deferred to WU35-03 per its own recommendation), **every candidate this milestone's inventory identified has now been either investigated to a confirmed non-actionable conclusion, or explicitly deferred to WU35-03 as a runtime/layer concern rather than a WU35-02 deletion concern.** WU35-02 accordingly closes with a test suite unchanged in file count and assertion content from WU35-01's end state (233 files), plus one corrected classification.

## 7. Regenerating This Inventory

```bash
pnpm build
node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=<path>
npx tsx src/tooling/test-inventory-cli.ts --run-json=<path> --out=docs/engineering/m35-test-suite-inventory.generated.json
```

Without `--run-json`, the tool still produces full static classification (workload class, domain, criticality, subprocess/filesystem usage, timeout-override presence) with runtime fields (`testCountActual`, `durationMs`, `runStatus`) left `null` — this is the mode `tests/unit/m35-test-inventory-classification.test.ts` (Sec 8) uses, so that guard does not itself require a fresh, potentially machine-load-sensitive full-suite run on every CI invocation.

## 8. Architecture Guard

`tests/unit/m35-test-inventory-classification.test.ts` (7 tests) proves, on every suite run:

- every `tests/**/*.test.ts` file on disk is classified (no file silently skipped by the walker);
- every classified file has a non-empty workload class, domain, and criticality;
- every criticality value is one of the build spec's 9 recognized classes;
- no file falls through to the classifier's `uncategorized` fallback domain (every file matched a real rule — a new file with an unrecognized naming pattern fails this test loudly, forcing a deliberate rule addition rather than a silent gap);
- the confirmed zero-skipped-tests baseline (Sec 3) has not silently regressed;
- the confirmed one-platform-guarded-file baseline (Sec 3) has not silently changed;
- every domain the build spec names as required critical coverage (Sec 3.3's checklist) still has at least one classified file.

This is implemented against `src/tooling/test-inventory-classifier.ts` — a pure, side-effect-free module extracted from `src/tooling/test-inventory-cli.ts` specifically so the architecture test can import the real classification logic directly (not a re-implementation that could drift from it) without triggering the CLI's file-write side effect on import.

## 9. WU35-03 addendum — layer and runtime optimizations applied

Two of the build spec's explicit transformation examples (Sec 7, "repeated Git setup → shared helper" and "CLI subprocess → service-level test") were applied to real, evidenced targets from Sec 5.1/5.4. No test's assertions were weakened or removed; a representative end-to-end subprocess spine remains in every touched file.

### 9.1 Shared Git-fixture-repository helper (repeated Git setup → shared helper)

`tests/helpers.ts` gained `initGitFixtureRepo(dir, commitMessage?)`, extracted from an **exactly byte-identical** 6-7 line `git init`/`config`×3/`add`/`commit`/`rev-parse` sequence independently duplicated in **21 files**: the 5 already identified in Sec 5.4's investigation (`git-command-runner.test.ts`, `workspace-cli.test.ts`, `workspace-hardening.test.ts`, `workspace-service-prepare.test.ts`, `workspace-service-release-recovery.test.ts`) plus 16 more discovered during WU35-03 itself (`evidence-advisory-hardening.test.ts`, `evidence-gate-full-lifecycle.test.ts`, `evidence-gate-hardening.test.ts`, `evidence-gate-policy.test.ts`, `evidence-gate-simulate.test.ts`, `execution-adapter-claude-code-full-lifecycle.test.ts`, `execution-adapter-claude-code-hardening.test.ts`, `execution-adapter-claude-code-import.test.ts`, `execution-adapter-claude-code-legacy-compat.test.ts`, `execution-adapter-claude-code-request.test.ts`, `execution-external-hardening.test.ts`, `execution-external-import.test.ts`, `execution-external-request.test.ts`, `execution-full-lifecycle.test.ts`, `execution-workflow-integration.test.ts`, `required-evidence-hardening.test.ts`) — verified byte-identical via `md5sum` before any file was touched, not assumed from filename similarity.

**Honest effect:** this is a code-deduplication and single-source-of-truth win (the exact transformation the build spec names), **not a measured wall-clock win** — the same `git` subprocess commands execute either way; only the duplicated source lines were removed. No runtime claim is made for this change.

### 9.2 CLI subprocess → service-level conversion (one evidenced target)

`tests/integration/m33-result-contract-characterization.test.ts`'s "review, review --json, status, status --json, and status --parallel never touch state.json or runlog.jsonl" test was identified as a clean candidate: its assertions check only `state.json`/`runlog.jsonl` file content, never process-level `stdout`/`stderr` (unlike this file's other tests, which specifically characterize the CLI's subprocess-level stream contract and were left untouched as this file's representative end-to-end spine). Its 6 read-only CLI-subprocess calls (`review`, `review --json`, `status`, `status --json`, `status --parallel`, `status --parallel --json`) were replaced with direct calls to `runReviewCommand`/`runStatus` — the exact same functions `src/cli/register-commands.ts` dispatches to for these commands (verified against its own wiring before making the change) — via a `contextFor()` context. The test's `setupProjectWithRealWarnings()` call and the one state-mutating `next --json` subprocess call were left as real CLI subprocess invocations (deliberately not converted, since mutating-command fidelity is more sensitive to argv/process-level behavior than read-only rendering is).

**Measured effect (isolated single-file run, not confounded by full-suite concurrent load):** this file's total duration dropped from 136.1s (WU35-01 baseline, Sec 4.5's #2 slowest file) to **62.8s isolated** — a 54% reduction — after eliminating 6 of the test's 7 subprocess launches. All 20 of the file's tests still pass.

### 9.3 Honest full-suite measurement note

A full-suite run after both changes (233 files, 2408 tests — identical counts to WU35-01/02, confirming no test was added or removed) showed 3 pure-timeout-class failures (`evidence-advisory-hardening.test.ts`'s already-known residual, plus `execution-external-import.test.ts` and `workspace-cli.test.ts` — **all 3 independently re-verified passing cleanly in isolation**, confirming transient full-suite-concurrency artifacts consistent with the machine-load variance `docs/m34-validation-workload-policy.md` and `docs/m34-ci-reliability-confirmation.md` already documented extensively, not real regressions from this Work Unit's changes).

**The full-suite aggregate duration for the 22 touched files was NOT lower after this Work Unit's changes** (1129.7s before vs. 1187.0s after, both sums over the same file set from two separate full-suite runs) — this is reported honestly rather than omitted. This does not contradict Sec 9.2's isolated 54% single-file measurement; it reflects that this specific 8-core/16-thread development machine's full-suite wall-clock is dominated by concurrent contention across many heavy files simultaneously, not by any single file's own subprocess count, so a per-file subprocess reduction does not reliably show up as a proportional full-suite wall-clock reduction *on this machine*. The isolated-run figure (Sec 9.2) is the reliable, attributable measurement for this specific change; the full-suite figure is retained here as an honest record of what was actually observed, not cherry-picked. **A CI runner with fewer cores (2-4 vCPUs vs. this machine's 16 threads) has less spare parallelism to hide subprocess overhead behind, so the same per-file reduction is expected to matter proportionally more in CI than it appears to locally** — this is the basis for WU35-04's own runtime measurement being sourced from real CI, not local timing, matching the precedent `docs/m34-closure-report.md` and `docs/m34-ci-reliability-confirmation.md` already established for this repository's authoritative runtime claims.

### 9.4 Deferred (not attempted in this Work Unit)

The remaining 29 files in Sec 5.1's performance-heavy set, and the `execution-adapter-claude-code-*` vs. `execution-external-*` structural-repetition signal (Sec 5.4), were not further touched — WU35-03 prioritized two evidenced, individually-verified changes over a sweeping pass across all performance-heavy files, consistent with this milestone's own governing principle ("preserve signal... measure everything") and the real risk of an unreviewed, large-diff pass introducing subtle behavioral drift. Further layer optimization of the remaining files is recorded as a legitimate future opportunity, not required for WU35-04's closure.
