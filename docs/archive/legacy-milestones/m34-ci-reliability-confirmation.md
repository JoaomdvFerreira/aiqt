# AIQT Milestone 34 — CI Reliability Confirmation

## Purpose

This document records the authoritative CI evidence gathered after M34's local closure (`docs/m34-closure-report.md`) to confirm or deny the build spec's own §8 gate ("five consecutive clean runs pass") on a real CI runner, per that closure report's own explicit recommendation that local evidence alone was insufficient.

## Implementation endpoint

**Confirmation commit (this document's own commit):** see `m34-validation-gate-ci-confirmed` tag for the exact SHA.

**M34 implementation endpoint confirmed (unchanged by this confirmation):**

- WU34-02: `3be8fe1`, tag `m34-wu02-systemic-test-runtime-controls`
- WU34-03: `3a78dfe`, tag `m34-wu03-built-binary-repeated-validation`
- WU34-04: `71fa554`, tags `m34-wu04-validation-gate-closure`, `m34-deterministic-validation-gate`

**Package version:** `0.19.0` (unchanged). **Canonical schema version:** `0.5.0` (unchanged).

## Push

`71fa554` (already the WU34-04 commit; no new implementation commit was needed) was pushed to `origin/main` as a fast-forward, along with all repository tags. Pushed SHA: `71fa55400f671bad22baec89276b30b6ca5c90da`.

A separate, unrelated housekeeping commit, `ec27d1c` (`chore(docs): reconcile git tracking with docs/ reorganization`), was created and pushed during this confirmation window to reconcile git's tracked paths with a documentation-layout reorganization made directly in the working tree (moving the M31-M34 milestone build specs/reports from `docs/engineering/` to `docs/`, and three general references the other direction). It is documentation-tracking-only, touches no source/test/schema/CI file, and does not affect the CI evidence below, which was gathered entirely against `71fa554`.

## CI reliability gate — scope actually executed

The build spec's original acceptance bar was **5 consecutive clean runs, Node 22 and Node 24 both green**. Two explicit, real-time user instructions during this confirmation session narrowed that scope:

1. After run 4 of 5 completed clean, the user instructed skipping run 5 and moving directly to the next steps — **4 consecutive runs**, not 5, is the evidence base below.
2. Mid-way through run 4's Node 22 job, the user instructed cancelling it, stating Node 22 "is going to be removed" (consistent with the newly-introduced M35 scope, "Test Suite Rationalization and CI Acceleration," which proposes Node 24 as the sole mandatory per-commit runtime). Node 22's run-4 job was cancelled before completion at the user's explicit direction — **this is a deliberate scope narrowing, not a failure**, and is recorded as such rather than silently omitted or misrepresented as a pass.

This document reports exactly what ran, honestly distinguishing "passed," "not exercised (out of scope after run 3)," and "cancelled by instruction" — it does not claim Node 22 was proven green a 4th time, and it does not claim 5 runs occurred.

## Node/OS matrix actually exercised

| Leg | Node | OS | Runs attempted | Runs completed clean |
| --- | --- | --- | --- | --- |
| Node 24 | 24 | ubuntu-latest | 4 | 4/4 |
| Node 22 | 22 | ubuntu-latest | 4 | 3/4 (4th cancelled by explicit instruction, not a failure) |

No additional CI operating system exists in `.github/workflows/validate.yml`'s matrix; this milestone did not add one.

## Five(-then-four)-run table

All runs below are full reruns of the same workflow run (GitHub Actions run ID `30897460411`, workflow `Validate`, triggered by the push of commit `71fa554`) — i.e., 4 independent, complete, fresh executions of every job against the identical commit SHA, not reruns of failed jobs only.

| Run | Commit SHA | Node | Job ID | Elapsed | Test files | Tests | Timeout count | Assertion-failure count | Built-binary smoke | Conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `71fa554` | 22 | `91953678639` | 14m43s (Test step: 836.50s) | 232/232 | 2401/2401 | 0 | 0 | pass (10/10) | **PASS** |
| 1 | `71fa554` | 24 | `91953678706` | 9m11s (Test step: 507.03s) | 232/232 | 2401/2401 | 0 | 0 | pass (10/10) | **PASS** |
| 2 | `71fa554` | 22 | `91957302417` | 15m1s (Test step: 854.99s) | 232/232 | 2401/2401 | 0 | 0 | pass | **PASS** |
| 2 | `71fa554` | 24 | `91957302353` | 9m4s (Test step: 501.84s) | 232/232 | 2401/2401 | 0 | 0 | pass | **PASS** |
| 3 | `71fa554` | 22 | `91960969458` | 15m7s (Test step: 857.38s) | 232/232 | 2401/2401 | 0 | 0 | pass | **PASS** |
| 3 | `71fa554` | 24 | `91960969368` | 9m21s (Test step: 519.16s) | 232/232 | 2401/2401 | 0 | 0 | pass | **PASS** |
| 4 | `71fa554` | 22 | `91964518996` | cancelled mid-`Test` step | — | — | — | — | not reached | **CANCELLED (by explicit instruction, not a failure)** |
| 4 | `71fa554` | 24 | `91964518972` | 8m57s (Test step: 495.33s) | 232/232 | 2401/2401 | 0 | 0 | pass | **PASS** |

Worker configuration: Vitest's default (`pool: "threads"`, no `--maxWorkers` override, no CI-specific concurrency setting) throughout, unchanged by M34 or this confirmation. Run 5 was not triggered (explicit instruction after run 4).

**Totals across all runs and both legs that actually completed:** 7 of 7 attempted-and-completed jobs passed cleanly. **Zero timeout failures. Zero assertion regressions.** Every completed run showed the identical 232 test files / 2401 tests figure, with the built-binary smoke suite (`tests/integration/built-binary-smoke.test.ts`, 10 tests) passing in every run that reached it, directly against `dist/index.js` built fresh by CI's now-reordered `Build` step.

## Gate outcome

**The reliability gate, as originally specified (5 runs, Node 22 and Node 24 both green), was not fully exercised** — by explicit user instruction, not because of any observed failure. Every run and leg that *was* executed passed cleanly with zero timeouts and zero assertion failures, which is a materially stronger and more consistent result than any local measurement in WU34-02/WU34-03 (which showed intermittent timeout-class failures under local machine contention). On CI's fresh-runner-per-invocation infrastructure, the class-scoped timeout policy this milestone implemented shows **no evidence of unreliability across 7 completed job executions**.

**This document does not claim the original 5-run, dual-Node gate is met**, since it was not run to that scope. It records instead:

- **Node 24 (the platform confirmed as the ongoing mandatory per-commit runtime, consistent with the direction of the newly-introduced M35 scope): 4/4 consecutive clean runs**, zero timeouts, zero assertion failures.
- **Node 22: 3/4 consecutive clean runs**, with the 4th deliberately not completed at explicit user instruction rather than left to run to conclusion, in light of Node 22's pending deprecation.

## Residual risks

- **Node 22's reliability was not proven a 4th consecutive time.** The 3 completed Node 22 runs were clean, but this confirmation does not carry the same run count as Node 24. Given Node 22 is headed toward removal from the mandatory per-commit matrix (M35 scope), this is recorded as an accepted, explicitly-instructed scope reduction rather than an open risk requiring further CI runs.
- **Only 4, not 5, consecutive runs were executed for the completed legs.** The stopping point was an explicit user instruction issued after observing run 4's own clean result in progress, not a governance decision made in advance. This is recorded transparently rather than reported as "5 runs" performed.
- **CI's own infrastructure (GitHub-hosted `ubuntu-latest` runners) is now the primary evidence base for M34's reliability claim**, superseding the local-machine measurements in `docs/m34-closure-report.md` (which showed real, honestly-documented instability under sustained same-session local load). No CI-side instability was observed in any of the 7 completed job executions gathered here.
- **No additional CI operating system was exercised** (`ubuntu-latest` only, unchanged from the pre-M34 matrix).

## Recommendation on M35 planning

Given 7 of 7 completed CI job executions passed cleanly with zero timeouts and zero assertion failures — a stronger result than any local measurement produced during M34 itself — **M34's core reliability objective (a deterministic, trustworthy validation gate) is now supported by real CI evidence**, notwithstanding the narrower-than-originally-specified run count. M35 planning (already underway per the newly-introduced `docs/engineering/AIQT_Milestone_35_Test_Suite_Rationalization_Build_Specification.md`) may proceed on this basis. **M35 implementation has not begun** as part of this confirmation; this document is a CI-evidence record only.

## Update to the M34 closure report

`docs/m34-closure-report.md`'s "Five-Run Reliability Evidence" and "Recommendation" sections are updated (in the same commit as this document) to link here and state that CI evidence — gathered after that report's own initial writing — now supports the milestone's reliability claim, with the exact, honest scope (4 runs, Node 24 fully confirmed, Node 22 3-of-4 by explicit instruction) recorded rather than overstated.
