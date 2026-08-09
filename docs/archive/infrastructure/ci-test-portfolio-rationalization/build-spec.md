# AIQT Infrastructure Hardening — CI & Test Portfolio Rationalization v0.1

**Repository:** AIQT CLI
**Work type:** Development-infrastructure hardening (not a product milestone)
**Status:** Approved; implementation started after M45 was merged and post-merge `main` CI was green
**Branch:** `infra/ci-test-portfolio-rationalization`
**Primary objective:** Minimize GitHub Actions runner-minutes per safely merged change while preserving or improving regression-detection confidence.

> **Documentation placement note.** This is infrastructure hardening, not
> milestone M46. It deliberately lived under `docs/infrastructure/active/`
> while in progress -- never `docs/milestones/active/` -- and was archived at
> closure to this directory,
> `docs/archive/infrastructure/ci-test-portfolio-rationalization/`. It does
> not trigger the milestone rolling-archive lifecycle in
> `docs/governance/milestone-protocol.md` §10 — that resumes when M46 starts.

## 1. Why this work exists

AIQT's development CI has become a constrained resource. The repository now carries a large accumulated test portfolio, multiple CI jobs, three test shards, repeated setup, and both PR and post-merge validation.

The optimization target changes from:

```text
make CI visually fast
```

to:

```text
maximize regression-detection confidence per GitHub Actions runner-minute
```

Wall-clock feedback remains important, but is secondary to runner-minute efficiency.

This is infrastructure/governance work for developing AIQT itself. It is not an AIQT product capability and must not create `.aiqt/` self-management state.

## 2. Entry gate and sequencing

M45 must be integrated first so this intervention optimizes the actual post-M45 repository/test portfolio.

Before implementation:

- M45 PR is merged to `main`;
- M45 post-merge `main` Validate is green;
- working tree is clean;
- package/schema versions are read live;
- current `.github/workflows/**`, Vitest config, package scripts, test-runtime policy, owner map, and test-rationalization policy are inspected live;
- the existing M35 deletion-evidence contract remains authoritative unless deliberately strengthened here;
- no M46 work has started.

M45 should be the final milestone merged under the old CI topology.

## 3. Primary success metrics

### 3.1 Primary KPI

Measure:

```text
GitHub Actions runner-minutes / safely merged PR
```

For each workflow run, calculate total billable-equivalent runner-minutes from actual job execution durations using GitHub's per-job whole-minute rounding model.

Record separately:

- PR validation runner-minutes;
- post-merge `main` runner-minutes;
- total per merged change;
- wall-clock feedback time;
- rerun/flaky-run cost.

### 3.2 Targets

Against the measured IH-01 baseline:

- **Target:** >=35% reduction in runner-minutes per normal merged code PR.
- **Stretch:** >=50% reduction.
- **Preferred topology:** one GitHub-hosted job.
- Additional jobs/shards require measured justification showing a reliability or feedback benefit that outweighs extra runner-minute cost.

No raw-test-count target.

### 3.3 Hard quality constraints

- zero known critical regression gaps;
- zero high-value/critical semantic reductions without required evidence/review;
- zero tests removed merely because they are slow;
- zero new skipped/todo tests introduced for speed;
- zero assertion weakening hidden as optimization;
- built-binary smoke remains;
- Node 24 remains authoritative;
- existing state, Git, execution, release, approval, recovery, schema and machine-contract boundaries remain covered;
- uncertain validation classification falls back to broad validation.

## 4. Governing test-removal policy

The current M35 test-rationalization policy remains authoritative.

Every test/suite removal, merge, or semantic reduction must record:

```text
test/suite
behavior covered
reason
equivalent remaining coverage
criticality
risk
validation evidence
runtime impact
```

Deletion without equivalent coverage is permitted only for demonstrably obsolete/invalid behavior under the current policy.

Age, runtime, milestone name, subprocess use, or small assertion count are investigation signals, not deletion evidence.

## 5. Single-job-first CI principle

The default candidate topology is one Linux GitHub-hosted job:

```text
checkout
→ setup Node/pnpm/cache
→ install once
→ typecheck
→ lint
→ build
→ version-check
→ tests
→ required result
```

Benchmark against the live topology and, if justified, a two-job alternative.

Evaluate:

```text
1 job
2 jobs
current topology
```

using:

- rounded runner-minutes;
- wall-clock time;
- setup/install duplication;
- test duration;
- timeout/flaky incidence;
- diagnostic quality.

Do not retain three test shards merely because they reduce wall-clock time.

## 6. Test portfolio review priorities

Classify the complete current portfolio using the live M35 inventory tooling plus direct inspection.

Prioritize:

1. **Confirmed duplicates** — same real regression with no independent boundary value.
2. **Superseded milestone dogfood** — only where canonical permanent coverage fully replaces the unique invariant.
3. **Subprocess-heavy duplication** — retain a small real CLI spine; move equivalent behavior to cheaper service/integration layers where proven.
4. **Repeated Git/worktree/fixture setup** — consolidate or batch where isolation remains correct.
5. **Redundant rendering/parity matrices** — preserve CommandResult, human/JSON parity and CLI wiring without repeating full functional matrices unnecessarily.
6. **Excessive equivalence-class combinations** — preserve meaningful boundaries and distinct behavior branches.
7. **Obsolete behavior** — delete only with historical/contract evidence.

## 7. Flake and load-cost policy

A flaky CI failure is a recurring Actions cost.

Rules:

- root cause before timeout escalation;
- no rerun-until-green validation;
- no per-file timeout proliferation as primary fix;
- measure Vitest worker/process pressure;
- compare stable lower internal concurrency against sharding;
- retained expensive tests must justify unique signal.

Prefer deterministic, slightly slower single-run behavior over parallelism that creates reruns.

## 8. Change-aware validation

After topology and portfolio rationalization stabilize, classify changes into bounded validation profiles:

```text
docs-only / non-runtime governance
CI/test infrastructure
runtime/source
schema/state
build/package/dependency
uncertain
```

Rules:

- the required workflow/check must still resolve successfully;
- do not skip the entire required workflow if that can leave a required check pending;
- prefer job/step-level conditional validation;
- docs-only may use lightweight validation where live policy proves it safe;
- CI/test-infrastructure, schema/state and build/dependency changes require broad validation;
- uncertain => broad validation;
- reuse existing test-impact/change-classification owners where appropriate.

## 9. PR versus post-merge validation

Do not simply delete post-merge validation.

A reduced post-merge profile is allowed only if the implementation can prove:

- the PR head that passed authoritative validation is the exact content merged;
- the validated base is still the relevant final merge base;
- no intervening `main` change creates an unvalidated combination;
- the merge method preserves expected content;
- provenance is machine-checkable.

If any condition is uncertain:

```text
post-merge main
→ full validation
```

If safe reduction cannot be proven, retain full post-merge validation and report that cost honestly.

Auto-merge is out of scope.

## 10. GitHub Actions efficiency controls

Evaluate and apply where safe:

- PR concurrency with stale-run cancellation;
- preserve authoritative `main` runs;
- dependency caching using current package-manager conventions;
- combine lightweight jobs when setup duplication costs more than separation helps;
- fail-fast only where diagnostic/governance evidence is preserved;
- minimize repeated checkout/setup/install/build;
- remain on clean GitHub-hosted Linux runners;
- no self-hosted runner in this intervention.

## 11. Work Units

### IH-01 — Measured Actions and Test Baseline

**Risk target:** 8/100
**No test deletion. No CI topology change.**

Measure live:

- workflow jobs;
- representative recent successful PR runs;
- representative recent `main` runs;
- per-job duration and rounded runner-minute total;
- setup/install/build/test contribution;
- cache behavior;
- test file/test counts;
- slowest files;
- subprocess/Git/filesystem-heavy concentration;
- flaky/timeout families;
- PR + post-merge cost per normal merged change.

Regenerate/revalidate the M35 inventory against the current suite.

### IH-02 — One-Job-First CI and Zero-Risk Waste Removal

**Risk target:** 20/100
**No semantic test deletion yet.**

Benchmark current vs one-job and, only if useful, two-job topology.

Apply:

- setup/install deduplication;
- correct dependency caching;
- stale PR-run cancellation;
- safe job consolidation;
- measured Vitest concurrency tuning;
- zero/low-risk waste removal.

Choose the lowest runner-minute topology that preserves acceptable stability and diagnostics.

### IH-03 — Deep Test Portfolio Rationalization

**Risk target:** 45/100

Review the full current suite and act only on evidence-backed candidates:

- confirmed duplicates;
- demonstrably obsolete tests;
- superseded milestone dogfood;
- low-signal tests;
- repeated matrices;
- redundant layer coverage.

Every semantic reduction follows the existing seven-field deletion-evidence contract.

No product behavior changes.

### IH-04 — Expensive-Layer and Flake Hardening

**Risk target:** 40/100

Optimize retained high-cost coverage:

- subprocess → cheaper layer where equivalent;
- repeated Git/worktree setup → safe shared/batched setup;
- repeated build/startup → reuse where safe;
- process-heavy timeout families → root-cause remediation;
- retain a representative real end-to-end/CLI/Git/binary spine.

Measure before/after runtime and flake behavior.

### IH-05 — Change-Aware Validation, PR/Main Cost Review, and Closure

**Risk target:** 35/100

Implement safe change-aware validation.

Evaluate adaptive post-merge validation under Section 9's proof requirements.

If proof is insufficient, retain full post-merge validation.

Produce final before/after:

```text
jobs
test files
tests
runner-minutes / PR
runner-minutes / main
runner-minutes / merged change
wall-clock
rerun/flake rate
critical coverage status
```

## 12. Source control and documentation

Branch:

```text
infra/ci-test-portfolio-rationalization
```

This is infrastructure hardening, not product milestone M46.

Use one bounded commit per IH Work Unit with risk and validation evidence.

Do not create `.aiqt/`.

Do not create a GitHub Release.

Do not start M46, M47, M48, auto-merge, AI review Actions, or overnight-agent automation.

Update stable governance only where a durable policy changes. In particular, update the test-rationalization policy if the primary CI optimization metric changes from wall-clock-only to runner-minute efficiency.

Package version behavior follows live `versioning.md` / `version:check` because `.github/workflows/**` is governed infrastructure.

Schema must not change.

## 13. Stop conditions

Stop and report if:

- a saving requires dropping a critical invariant without equivalent coverage;
- required-check design could allow merge without a successful authoritative gate;
- safe test-deletion evidence cannot be completed;
- one-job topology creates a deterministic reliability regression that cannot be corrected without weakening tests;
- adaptive post-merge validation cannot prove merge/base/head integrity;
- optimization requires self-hosted runners;
- work changes AIQT product behavior;
- a schema change appears necessary;
- work begins auto-merge or another roadmap capability.

## 14. Definition of Done

Complete when:

1. real GitHub runner-minute baseline is measured;
2. the current test portfolio is re-inventoried;
3. one-job topology is benchmarked as the default candidate;
4. final job count is justified by runner-minute + stability evidence;
5. stale PR runs cancel safely;
6. setup/cache/install duplication is minimized;
7. all removed/merged tests carry policy-complete evidence;
8. no critical/high-value coverage is silently weakened;
9. obsolete/duplicate/low-signal coverage is rationalized where evidence permits;
10. retained expensive tests are optimized or explicitly justified;
11. load-related flakes are materially reduced or isolated with root-cause evidence;
12. change-aware validation is fail-closed;
13. post-merge validation is reduced only if provenance safety is proven;
14. Node 24 and all critical invariants remain covered;
15. no self-hosted runner, auto-merge, Release, M46, M47, or M48 work is introduced;
16. final runner-minutes per merged code PR are materially below baseline;
17. >=35% reduction is targeted without violating hard constraints, with >=50% as stretch;
18. branch is PR-ready with a concise closure report.
