# M41 — Adaptive Test Selection and Feedback Acceleration — Closure Report

**Status:** Closed on branch `milestone/m41-adaptive-test-selection`. Not merged. No PR opened yet.

## Baseline / final commits

- Branch created from `main` at `a42002d` (`Merge pull request #8 from JoaomdvFerreira/milestone/m40-release-governance`).
- M40 entry baseline verified: PR #8 MERGED; post-merge `Validate` CI on `main` green (run `31249529725`); `docs/milestones/completed/m40/` canonical; `m40-release-governance-risk-provenance` tag present, unmoved; explicit post-M40 release decision recorded as **NO RELEASE** (latest published GitHub Release remains `v0.33.0`; `v0.34.0` was never tagged or released); `main` clean; no `.aiqt/` self-management state.
- Package version: `0.34.0` → `0.35.0` (minor: new backward-compatible capability -- the test-impact selector and `aiqt validation select|explain`; no breaking change, no schema change).
- Schema version: unchanged (`0.5.0`). M41 added one additive field (`ExecutionGuidanceValidation.testImpact`) to a plain TypeScript decision-output interface, not a persisted `.aiqt/` zod schema -- no `AIQT_SCHEMA_VERSION` bump needed or made.

## WU commits/tags/risk

| Unit | Commit | Tag | Risk |
|---|---|---|---|
| Pre-M41 housekeeping (archive M35-M38) | `de53f9d` | *(none -- not a Work Unit)* | — |
| WU41-01 — Test Inventory and Impact Contract | `7aee717` | `m41-wu01-test-impact-contract-inventory` | 15/100 Green |
| WU41-02 — Deterministic Impact Selection and Confidence | `5fb7c1c` | `m41-wu02-deterministic-impact-selection` | 20/100 Green |
| WU41-03 — Execution-Guidance Integration and Explainability | `0d0bcbf` | `m41-wu03-guidance-selection-explainability` | 25/100 Yellow |
| WU41-04 — Feedback Adaptation and Safe Escalation | `324e422` | `m41-wu04-validation-feedback-escalation` | 25/100 Yellow |
| WU41-05 — Dogfood, Performance Proof, Closure | *(this commit)* | `m41-wu05-adaptive-test-selection-dogfood-closure`, `m41-adaptive-test-selection-feedback` | 20/100 Green |

## Shared impact owner and selection-version identifier

`src/workflow/test-impact-selection.ts`'s `selectTestImpact` is the sole deterministic selection algorithm; `src/workflow/test-impact-adaptive-selection.ts`'s `selectTestImpactWithFeedback` is the sole feedback-aware wrapper every consumer (execution guidance, `aiqt validation select/explain`) calls -- no second decision path exists anywhere. `TEST_IMPACT_SELECTION_VERSION = "test-impact@1"` (`src/schema/test-impact.schema.ts`) is carried on every `TestImpactSelection.selectionVersion`.

## Inventory/mapping/dependency evidence actually used

- **Inventory**: reused M35's `classifyAllTestFiles` (`src/tooling/test-inventory-classifier.ts`) directly -- no second discovery mechanism. Fails closed to an honestly empty inventory (never a crash, never a fabricated mapping) when a target repository's `tests/` directory is absent or unsupported.
- **Dependency evidence**: this repository has no real import/dependency graph and M41's build spec explicitly rules out building one. The only bounded, deterministic path evidence used is a naming-convention stem match (`scoped_file_match`) between a changed/scoped source file and inventoried test files, plus an optional caller-declared `pathMappings`-shaped extension point was considered but not built -- not needed once the stem-match heuristic proved sufficient for every required dogfood scenario, and a real mapping contract would have required either fabricated data or a heavier build-system integration this milestone's scope excludes.
- **Broad-blast-radius evidence**: `src/workflow/test-impact-blast-radius.ts` reuses `milestone-protocol.md` Sec 4's own documented "foundational, widely-depended-on behavior" list (canonical schema, atomic write, exit-code mapping, canonicalization, sandbox/autonomous security boundaries, runtime/toolchain infrastructure, test infrastructure) as a bounded path-pattern check.
- **Feedback evidence**: `src/workflow/test-impact-feedback.ts`'s `loadValidationFeedbackFromCheckpoints` reads the existing canonical `state.checkpoints`/`ValidationCommandResult` owner -- no new validation-history database, no raw log persistence.

## Mandatory-selection, confidence, escalation, and feedback behavior

- Explicit `validationCommands` are always mandatory targets (`explicit_requirement`); no later signal (naming-convention match, prior feedback, duration) can remove one -- verified by dedicated tests in every WU and by dogfood scenario 3.
- Confidence (`high`/`medium`/`low`) and escalation (`selected_focused`/`selected_impacted`/`broaden_required`/`full_required`/`insufficient_evidence`) are derived only from evidence quality -- ambiguous/unsupported evidence lowers confidence and broadens (never silently narrows); a broad-blast-radius path hit always escalates to `full_required` regardless of any other evidence.
- Feedback trust: a `ValidationFeedbackRef` is used as current verified evidence only when its `changeIdentity` matches the current change (defaults to the Work Unit's own latest checkpoint id) and, optionally, within a bounded age window -- a mismatched or stale ref is rejected before it ever reaches the selector.
- One or more unresolved trusted prior failures downgrades an otherwise-clean `selected_focused`/`selected_impacted` escalation to `broaden_required`; a passed prior outcome changes nothing.
- Duration/history reorders (mandatory always first, then trusted-failure targets, then ascending known duration, unknown-duration last, stable original-order tiebreak) but never removes required coverage.

## Integration surfaces and parity evidence

- `src/workflow/execution-guidance.ts`'s `buildValidationGuidance`/`composeExecutionGuidance` (M39's shared decision owner) now accept `testImpactInput` and expose `validation.testImpact` -- purely additive; the selection can only ADD a `requiredNow` step, never remove one already present from the pre-M41 explicit-command/default logic. All 26 pre-existing M39 execution-guidance tests pass unmodified.
- `src/cli/commands/next-selection-helpers.ts`'s `buildExecutionGuidanceForWorkUnit` -- the single function `next`/`next --preview` both call -- now builds a real `TestImpactInput` from the same already-gathered Work Unit/checkpoint evidence, guaranteeing preview/apply parity by construction (both call the identical function).
- `aiqt validation select`/`explain` (new, read-only, never mutates workflow state) reuse `buildExecutionGuidanceForWorkUnit` directly -- no second selection path. Verified byte-for-byte agreement between `select`/`explain`'s `data.testImpact` and `next --preview`'s own `executionGuidance.validation.testImpact` in a real-project integration test.
- Human/JSON alignment: the compact `renderExecutionGuidanceHuman` "Test impact: ..." line and the richer `renderTestImpactExplain` view both derive from the exact same `TestImpactSelection` object the JSON `data` payload carries.

## Dogfood evidence (build spec Sec 12, all 12 required scenarios)

All 12 scenarios are real, passing tests in `tests/integration/m41-adaptive-test-selection-dogfood.test.ts`, against a disposable, fictional "acme-widgets"-style 8-entry inventory (never AIQT's own test suite, never AIQT self-managing AIQT):

1. Localized `auth.ts` change selects exactly its 2 matching test files, not the whole inventory. ✅
2. A changed test file selects itself (`changed_test`). ✅
3. An explicit `validationCommand` stays mandatory even when scoped evidence has zero test matches. ✅
4. A shared `billing.ts` change selects both of its matching test files. ✅
5. A dynamic/unmapped source path lowers confidence and reports `broaden_required`. ✅
6. A test-infrastructure-path change escalates to `full_required`. ✅
7. A trusted prior failure is promoted into the next selection. ✅
8. The same failure, from a mismatched change, is rejected and never promoted. ✅
9. Identical inputs produce an identical selection (deep-equal, including the digest). ✅
10. Compact human render, rich explain render, and JSON guidance report the same confidence/escalation. ✅
11. A 4-Work-Unit flow (including a deliberately repeated domain touch) measures a **78.1% reduction** (32 candidate executions → 7 selected) against the naive "run everything every WU" baseline, well past the 30% target; the repeated touch (`wu-C`) selects the identical target set as its first occurrence (`wu-A`), demonstrating real repeated-selection stability rather than a fresh full-suite re-scan; selection-planning overhead measured at well under 1ms. ✅
12. A seeded regression (`billing-invoices.test.ts`) is present in every relevant selection across the flow -- via direct change, via prior-failure promotion, and via the raw WU41-02 selector alone -- never dropped to inflate the reduction metric. ✅

## Measured efficiency (build spec Sec 11)

**Target met: ≥30% reduction, honestly measured, with zero missed seeded regressions.** Multi-WU flow: baseline 32 candidate executions, 7 selected (78.1% reduction). This is a synthetic-but-realistic fixture measurement (an 8-file inventory), not a claim about AIQT's own ~300-file suite -- the arithmetic (`src/workflow/test-impact-efficiency-evidence.ts`) is the same honest, never-fabricated, never-negative ratio calculation M39's `computeContextFootprintReduction` already established as this repository's pattern, independently unit-tested (5 tests) including the below-target and division-by-zero honesty cases.

## Full validation/CI evidence

- Focused/impacted vitest across every WU: 197 M41-specific tests, all passing.
- `tsc --noEmit`: clean throughout.
- `eslint .`: clean throughout (repo-wide).
- `git diff --check`: clean throughout.
- `pnpm version:check` (local and `--base main` comparison): **PASSED** -- minor bump correctly detected and required.
- Authoritative full suite (`pnpm validate`, Node 24, this machine): **3200/3214 executed tests passed** (303/314 files), 32 pre-existing Docker-dependent skips (unrelated). 14 failures, all reconciled as non-M41:
  - 13 timeouts across `execution-adapter-claude-code-hardening.test.ts`, `execution-adapter-claude-code-import.test.ts` (×4), `execution-external-import.test.ts` (×2), `workspace-cli.test.ts` -- none of these files were touched by M41; all 4 files (38 tests total) re-run individually and pass cleanly (each test 2.5s-8s, well under its own timeout) once full-suite parallel-worker contention is removed. Same class of Windows-dev-machine load flakiness already reconciled in M40's own closure report.
  - 1 reproducible failure: the same pre-existing `m34-validation-workload-inventory.test.ts` CRLF-checkout artifact (`tests/integration/cli.test.ts`'s trailing-line timeout-shape baseline) already characterized and reconciled at M40 closure -- root-caused to this Windows machine's `core.autocrlf=true` git config, not present in the repository's LF-stored source, and expected to pass on the Linux-only `.github/workflows/validate.yml` CI.
- M36-M38 boundary-scan/safety suites (93 tests) re-run and pass unmodified, confirming M41 did not weaken M37/M38 safety controls -- also directly verified by a WU41-04 boundary-scan assertion that `execution-guidance.ts` imports nothing from the autonomous-run/sandbox execution surface.
- Real GitHub Actions CI has not yet run for this branch (triggers on `push:[main]`/`pull_request`; no PR opened yet).

## Defects found/fixed

None found during WU41-05 integrated review beyond the two dogfood-test assertion corrections made while writing the dogfood suite itself (the fixture's own expected `escalation` value for scoped-source-only selections was initially mis-specified as `selected_focused` instead of the correct, already-intentional `selected_impacted` -- corrected in the test, not the implementation). No stabilization Work Unit was required.

## Known limitations / residual risk

- The naming-convention stem-match heuristic (`scoped_file_match`) is the only dependency-evidence signal; a real codebase with non-conventional test/source naming will see more `broaden_required` outcomes (a safe, honest default per build spec Sec 5.4 -- never a silent narrowing) rather than precise `direct_dependency` matches. A future milestone could add an optional, explicit path-mapping config if a real target project needs one; none was needed to satisfy M41's required scenarios.
- Feedback duration is always `null` from the one wired source (`Checkpoint.validationCommands` carries no duration field) -- duration-based tie-breaking is implemented and tested but has no live non-null data to act on yet in this repository's own checkpoints.
- The 78.1% efficiency measurement is against a synthetic 8-file fixture inventory, not AIQT's own ~300-file suite (M41 does not self-manage AIQT development) -- a real-world measurement on an actual multi-WU AIQT (or other) project flow remains a natural follow-up but was not required by the build spec's dogfood scenarios.
- The two pre-existing, non-M41 local-validation discrepancies (documented above, both already reconciled at M40 closure) mean this specific Windows development machine cannot currently produce an all-green `pnpm validate` run; the authoritative Linux CI is expected to be unaffected.

## Pre-PR audit result

Performed in one pass before this report:
- Every Definition of Done item verified against live implementation/test evidence (this report's sections above).
- Exact milestone/WU names and tags confirmed against `git tag -l` output (below).
- Package `0.35.0` / schema `0.5.0` confirmed live via `package.json` and `schema-version.ts`.
- Final risk 20/100 Green (four-band model: 0-24 Green/25-49 Yellow/50-74 Orange/75-100 Red).
- `docs/milestones/completed/m41/{build-spec.md,closure-report.md}` present; `docs/milestones/active/m41/` no longer exists; no versioned duplicate build-spec filename remains (moved directly to the canonical name, no intermediate stale reference).
- No stale direct path reference to the old `docs/milestones/active/m41/AIQT_Milestone_41_Build_Specification_v0.1.md` filename exists anywhere in the repository (grep-verified).
- Working tree clean; no unrelated generated/untracked evidence remains (`docs/engineering/*.generated.json` artifacts produced transiently by full-suite runs were removed before each commit, never staged).
- Version governance: package version changed, so the focused `tests/unit/package-version.test.ts`, `pnpm version:check`, and `pnpm version:check -- --base main` were all run and passed (see Full validation/CI evidence).

## Final risk score/status

**M41 aggregate risk: 20/100 — 🟢 Green.** Highest single-WU contribution was WU41-03/WU41-04's 25/100 each (additive changes to the widely-consumed `execution-guidance.ts` owner); no WU exceeded its build-spec target; the additive-only (never-removes-required-coverage) design was verified by full regression coverage of the pre-existing M39 surface at every integration point.

## PR readiness

**READY FOR PR.** Working tree clean, all WU tags pushed, closure commit/tag to follow this report. `main` re-verified unchanged since branch creation (M40 merge commit `a42002d` remains `main`'s tip).

## M42 entry recommendation

M41 is complete and self-contained. M42 (defect remediation, per the build spec's out-of-scope list) may begin once this branch is merged and formally closed -- no blocking dependency from M41 back onto M42 exists. Per the rolling two-completed-milestone archive rule (`milestone-protocol.md` Sec 10), M39 should be archived to `docs/archive/milestones/m39/` when M42 starts (not now -- M40 and M41 are the current hot pair).
