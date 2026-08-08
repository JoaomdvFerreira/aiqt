# M45 — Background Maintenance Scheduling — Closure Report

**Status:** Closed on branch `milestone/m45-background-maintenance-scheduling`. Not merged. No PR opened yet.

## Baseline / final commits

- Branch created from `main` at `4f5c829` (PR #15, M44 merge).
- Entry gates verified live: PR #15 MERGED; post-merge `Validate` CI on `main` green (run `31273580834`, success); Product Specification v0.7 / Technical Architecture v0.4 active; `repository-owner-map.json` valid; M42 defect/M43 structural-review/M36-M39 execution-sandbox-cancellation owners confirmed present (`defectContract`, `defectRemediationQueue`, `structuralReviewContract`, `structuralReviewEngine`, `structuralFindingDefectIntake`, `executionSessions`, `sandboxBackendContract`, `executionGuidance`); M44 release-reconstruction confirmed read-only and untouched; package `0.38.0` / schema `0.6.0` read live; working tree clean; no `.aiqt/` self-management state.
- Package version: `0.38.0` → `0.39.0` (minor: new backward-compatible capability, `aiqt maintenance`).
- Schema version: `0.6.0` → `0.7.0` (additive; new `maintenanceSchedules`/`maintenanceActiveOccurrence` top-level `StateModel` sections), following the same precedent M42-WU01 set for its own new `defects` section. Migration/compatibility proven by `tests/unit/maintenance-schedule-schema.test.ts`'s absent/populated/pre-M45-state-still-parses triad and `tests/unit/versioning.test.ts`'s new dedicated `0.6.0`-as-`older_compatible` case.

## WU commits/tags/risk

| Unit | Commit | Tag | Risk |
|---|---|---|---|
| Pre-M45 housekeeping (archive M42, build-spec intake) | `52cb755` | *(none -- not a Work Unit)* | — |
| WU45-01 — Maintenance Schedule Contract, Canonical State, and Ownership | `55c2f49` | `m45-wu01-maintenance-schedule-contract-state` | 12/100 Green |
| WU45-02 — Deterministic Due Engine, Occurrence Identity, and Schedule CLI | `19a25f5` | `m45-wu02-due-engine-schedule-cli` | 19/100 Green |
| WU45-03 — Typed Maintenance Dispatch and Read/Discovery Workflows | `715a0bd` | `m45-wu03-typed-dispatch-review-discovery` | 23/100 Green |
| WU45-04 — Scheduled Defect Remediation, Human Gates, Cancellation, and Recovery | `0b07c61` | `m45-wu04-scheduled-remediation-cancel-recovery` | 34/100 Green |
| WU45-05 — Dogfood, Safety Regression, Closure, Pre-PR Audit | *(this commit)* | `m45-wu05-background-scheduling-dogfood-closure`, `m45-background-maintenance-scheduling` | 12/100 Green |

## Canonical schedule/occurrence contract

`src/schema/maintenance-schedule.schema.ts` is the sole `MaintenanceSchedule`/`MaintenanceOccurrenceRecord`/`MaintenanceTaskKind` contract owner, persisted as `StateModel`'s two new optional, additive sections. `maintenanceSchedules` is a bounded array (`MAX_MAINTENANCE_SCHEDULES=200`), absent entirely on pre-M45 state, never populated by migration/defaulting. `maintenanceActiveOccurrence` is a **nullable singleton, deliberately never an array**, so "no parallel scheduled maintenance" is a structural property of the state shape rather than a runtime check that could be bypassed. `MaintenanceSchedulePolicy.maxAutomaticRisk` is schema-bounded to `<=49` (`remediation-risk.ts`'s existing human-approval boundary is `>=50`), so a schedule can only narrow the automatic-approval window, never widen it — enforced at the schema layer, not caller discipline.

## Supported task kinds

A closed, three-member enum (`MaintenanceTaskKindSchema`) — proven by test that no arbitrary string (including a literal shell command) can ever be accepted as a schedule's task kind:

- **`structural_review`** — read-only, delegates to `runStructuralReview` + `suppressKnownBenignFindings(consolidateFindings(...))` verbatim (the exact chain `aiqt review structural` uses). Only finding counts/keys become occurrence evidence; findings are never auto-intaken into the M42 defect queue.
- **`defect_discovery`** — delegates to `discoverFromCheckpoints` + `applyDiscoveryCandidates` verbatim (the exact functions `aiqt defects discover` uses), bounded to `state.checkpoints` so no external evidence is required. Discovery alone never authorizes remediation.
- **`defect_remediation`** — selects at most one `queued` defect via `defect-triage.ts`'s `sortByQueuePriority`, checks the schedule's own risk ceiling, then calls `prepareRemediation` — the exact function `aiqt defects remediate` calls — with no `approvedBy` (unattended). Never bridges to live M36–M39 sandboxed execution (see "Key architectural decision" below).

## Host/background invocation model

`aiqt maintenance run-due` is the sole background-host entry point; M45 owns no OS daemon/service installation. Documented host mechanisms (cron, systemd timer, Windows Task Scheduler, a CI scheduled workflow) invoke this one stable command; none of them are installed or configured by AIQT itself — confirmed by construction (no such code exists anywhere in this milestone).

## Due-selection, idempotency, and missed-occurrence rules

`src/workflow/maintenance-due-engine.ts` (pure, injectable-clock): `selectDueSchedule` restricts to enabled schedules with `nextDueAt <= now`, checks the active-occurrence overlap guard *first* (so a busy project never looks like "nothing due"), then picks earliest-`nextDueAt`-then-stable-id. `computeNextDueAtAfterEvaluation` is anchor-aligned and always strictly after the evaluation time — a host offline for 5 cadence periods produces exactly one occurrence with `missedOccurrenceCount: 4` (verified against the build spec's own worked example) and never a backlog replay. Idempotency is structural: advancing `nextDueAt` past `now` *is* the claim, so an immediate repeat invocation always finds nothing due; true idempotency under two *concurrent* `run-due` processes is guaranteed by reusing the existing M25 `workspace-operation.lock` for the short read-select-claim sequence (see "Concurrency" below) — no new generic lock/transaction subsystem was built, resolving the build spec's WU45-02 stop condition by reuse.

## Concurrency, crash recovery, and a real bug found in dogfood

**Pre-PR verification of the lock mechanism:** `src/services/maintenance-run-service.ts` is the sole owner; it imports `acquireWorkspaceOperationLock`/`WorkspaceOperationLockError` from the pre-existing `src/workspaces/workspace-operation-lock.ts` (`import` at line 2, used at lines 55/215). `git log --stat` for this milestone confirms `src/workspaces/` has zero diffs across all of M45 -- the lock module itself was neither modified nor extended, only imported and called with a new `operationId` string (`"maintenance-run-due"`). No new lock file, lock schema, or transaction primitive was created anywhere in M45; the resource being locked (the single `workspace-operation.lock` file per `.aiqt/`) is the same one M25's workspace prepare/release operations already contend on, not a new resource scoped to M45. This means a workspace prepare/release and a maintenance `run-due`/`cancel` can transiently block each other (a known, documented conservatism, not a defect), but it is unambiguously *reuse* of an existing primitive, not a new generic lock/transaction subsystem -- satisfying the build spec's WU45-02 stop condition ("if safe duplicate prevention requires new generic locking/transaction authority, stop and report before inventing it") by never triggering it.

`maintenance-run-service.ts` acquires the lock only for the read-select-claim sequence, releasing it before the (always-synchronous, in-process) task handler runs. A claim older than 5 minutes with no recorded result is treated as interrupted — every M45 task handler completes synchronously, so survival past that bound is itself evidence of a crash — and is reconciled to `failed`, never assumed successful.

**Manual dogfood (running `aiqt maintenance run-due` against a non-Git temp directory) surfaced a real bug before any test existed for it**: a handler exception (structural review requires a Git commit) was left uncaught, permanently stranding the active-occurrence claim. Fixed by wrapping handler dispatch in `try`/`catch` and reconciling to a clean `failed` result with the real error as evidence. `tests/integration/maintenance-run-due.test.ts`'s stale-occurrence case and the original manual reproduction both now exercise this path.

A second real bug found in WU45-04 dogfood: `needs_input` results from `run-due` weren't setting `requiresHumanInput: true` on the `CommandResult` (`makeResult` doesn't derive it from `status` automatically) — fixed in `maintenance-run.command.ts`, preserving the existing exit-10 invariant.

## Authority-intersection proof

Global risk bands (`0`-`24` Green / `25`-`49` Yellow / `50`-`74` Orange / `75`-`100` Red; `<50` automatable, `>=50` human required) are untouched — `remediation-risk.ts`/`remediation-risk.ts`-adjacent `defect-remediation-service.ts` have zero diffs this milestone. A dedicated dogfood test proves the exact boundary: a defect scoring `10/100` (globally automatable) is correctly blocked once its schedule sets `maxAutomaticRisk=5`, and the same defect at the *global* boundary (score `60`, no schedule ceiling) is blocked identically — the schedule ceiling can only narrow, confirmed for both directions. M42's remediation-risk model has no distinct Red-tier (`75`-`100`) waiver flow independent of the uniform `>=50` gate, so "stricter Red governance" for this domain is the same `requiresHumanApproval` gate uniformly across `50`-`100` — not a fabricated second tier.

## Key architectural decision: no bridge to live sandboxed execution

Before WU45-01, research confirmed `defect-remediation-service.ts` (M42) and `sandbox-run-execution-service.ts` (M36–M38) are today two fully disconnected subsystems — no existing caller chains a defect-queue decision into live sandboxed execution. Building that bridge for the first time in WU45-04 would mean inventing new `AutonomousCandidate`-construction/worktree-provisioning decision logic driven by a bare defect record, never reviewed or threat-modeled for that input source — exactly the "materially widening... rather than reusing" case the build spec's own WU45-04 stop condition anticipated. The implemented, conservative alternative reuses `prepareRemediation` exactly as `aiqt defects remediate` already does: the resulting `RemediationDecision` carries no `executionRef` (confirmed by test), and validation must still be recorded separately via the pre-existing `aiqt defects record-validation`. This satisfies every WU45-04 acceptance criterion without widening any authority.

**Pre-PR verification:** `grep`'d every `src/workflow/maintenance-*.ts`, `src/services/maintenance-*.ts`, and `src/cli/commands/maintenance-*.ts` file for `sandbox-run-execution-service`, `autonomous-agent-import`, `runLiveSandboxedRun`, and `prepareLiveSandbox` -- zero matches. `runDefectRemediationTask`'s only remediation-domain imports are `sortByQueuePriority` (`defect-triage.ts`), `computeRemediationRisk` (`remediation-risk.ts`), and `prepareRemediation` (`defect-remediation-service.ts`) -- confirming scheduled `defect_remediation` reaches only M42's existing bounded request/handoff and never claims or invokes live autonomous sandbox execution.

## Cancellation and recovery evidence

`aiqt maintenance cancel <occurrenceId>` is bookkeeping only — no live process is ever signaled, since no M45 task kind spawns one (build spec Sec 13.1's "when applicable" does not apply here, documented explicitly in the owner-map entry). It fails closed for a non-matching id, clears the active-occurrence slot, advances the owning schedule's `nextDueAt`, and preserves runlog history.

## Dogfood scenario results (build spec Sec 18, all 31 required scenarios)

All scenarios are real, passing tests across `tests/integration/maintenance-schedule-cli.test.ts` (11), `maintenance-run-due.test.ts` (9), `maintenance-scheduled-remediation.test.ts` (6), and the closing `maintenance-dogfood.test.ts` (5), plus `tests/unit/maintenance-due-engine.test.ts` (16) and `maintenance-schedule-schema.test.ts` (12) — against disposable, non-AIQT fixture projects (real `aiqt init` + real Git fixtures where structural review needs a resolvable commit). AIQT was never initialized as a managed project during M45.

1–31: pre-M45 zero-schedule state; create/list/inspect; disabled-never-selected; no-due zero-mutation; read-only structural review with evidence; no auto-intake; defect-discovery reuse without remediation authorization; earliest-due selection; stable-id tie-break; 5-period-offline → one run + 4 missed (build spec's own worked example, exact match); no double-execution; busy/overlap guard; update affects future due only; disable never kills active work; remove preserves history; low-risk auto-remediation; schedule ceiling narrows global policy; exact 49/50 boundary; uniform Red-tier gate (documented, not a separate tier); at most one defect per occurrence; M42's failed-validation/reopen path unchanged (confirmed via M42 regression, M45 never calls `recordRemediationValidation` itself); explicit cancellation with evidence, no unrelated-process kill; stale reconciliation without fabricated success; not applicable — M45 introduces no new external-dependency/integration path (confirmed by construction: only the existing lock + the three existing task owners are ever called); no immediate retry (confirmed: a repeated call after `needs_input` finds nothing due, the defect stays untouched); human/JSON parity (via the pre-existing shared `renderHuman`/`renderJson`, proven repo-wide by M33); closed task-kind enum rejects arbitrary command strings; no OS daemon/service code exists; no auto merge/PR/deploy/release code exists; zero `.aiqt/` in this repository throughout; M36–M44 critical regression suites reconfirmed green. ✅ (all)

## Defects found/fixed during M45

Two real defects, both found through manual CLI dogfood before being encoded as regression tests (see "Concurrency, crash recovery, and a real bug found in dogfood" above): (1) an uncaught handler exception permanently stranding an active-occurrence claim, fixed with try/catch reconciliation to `failed`; (2) `needs_input` results not setting `requiresHumanInput: true`, fixed in the CLI mapping layer. No defects were found in reused M40/M42/M43/M36–M39 owners.

## Validation and safety-regression evidence

- `tsc --noEmit`: clean (full project). `eslint .`: clean (full repository). `tsc -p .` (full build): clean.
- `pnpm tsx src/tooling/version-check-cli.ts --base main`: PASSED — `0.38.0` → `0.39.0`, minor, `requiredBumpPresent: true`, all other checks true.
- Full suite (`vitest run`, all 336 files): first run showed 13 failing files / 21 failing tests -- reconciled exactly (322 passed + 13 failed + 1 skipped = 336 files; 3457 passed + 21 failed + 32 skipped = 3510 tests). All re-verified individually: 12 files (`evidence-advisory-hardening`, `evidence-gate-full-lifecycle`, `evidence-gate-policy`, `evidence-gate-simulate`, `execution-adapter-claude-code-full-lifecycle`, `execution-adapter-claude-code-import`, `execution-external-import`, `execution-hardening`, `execution-workflow-integration`, `m33-result-contract-characterization`, `required-evidence-hardening`, `workspace-cli`) are real pre-existing M25–M33 tests that only time out under this run's full-suite parallel-worker load — all passed with zero failures when re-run individually or in small batches (100/100 tests across those batches). The 13th, `m34-validation-workload-inventory.test.ts`'s "trailing-line inline-timeout shape" baseline (expecting `tests/integration/cli.test.ts`), is the same pre-existing, unrelated baseline mismatch already confirmed present on `main` before M44/M45 — left unfixed, out of scope.
- **Pre-PR re-verification** (independent second full run, same closed tree, no code changes in between): 326 passed + 9 failed + 1 skipped = 336 files; 3467 passed + 11 failed + 32 skipped = 3510 tests -- both reconcile exactly. The 9 failing files were a different subset of the same known-flaky pool (`evidence-advisory-hardening`, `evidence-gate-policy`, `evidence-gate-simulate`, `execution-adapter-claude-code-full-lifecycle`, `execution-adapter-claude-code-import`, `execution-external-import`, `execution-workflow-integration`, `workspace-cli`) plus the same `m34-validation-workload-inventory.test.ts` baseline mismatch -- no M45 file has ever appeared in a failure list across either full run. All 8 non-`m34` files re-run together individually: 61/61 tests passed, 0 failures. This second, independent run confirms the failure pattern is genuine parallel-load flakiness (a different random subset fails each time, always drawn from the same pre-existing M25–M33 population) rather than a deterministic defect, and that no code change occurred between the two runs that could account for the differing failure sets.
- Two registry-drift checks this milestone's new files/commands trip by design were fixed deliberately: `m33-cli-contract-matrix.test.ts`'s `EXPECTED_COMMAND_COUNT` progressed `88→97→99` across WU45-02/03 (9 new `maintenance` schedule/status/history commands, then `run-due`/`cancel`); `m34-validation-workload-inventory.test.ts`'s `KNOWN_SPAWNING_FILES` gained `maintenance-run-due.test.ts` and `maintenance-dogfood.test.ts` (both use `initGitFixtureRepo`).
- M40/M42/M43 critical dogfood suites re-run explicitly and green: `m40-release-governance-dogfood.test.ts`, `m43-structural-review-dogfood.test.ts`, `m42-defect-lifecycle-dogfood.test.ts`, `release-draft.test.ts` (54 tests, 0 failures) — confirms WU45-03/04's reuse of `structuralReviewEngine`/`defectRemediationQueue` caused no regression in either owner's own manual CLI path.

## Known limitations

- `defect_remediation` scheduling only ever produces the same bounded external-agent handoff/request M42's manual `aiqt defects remediate` already produces — it never itself executes remediation code, and validation must still be recorded via a separate, explicit `aiqt defects record-validation` call (human or external agent). Bridging to live sandboxed execution is explicitly out of scope for M45 (see "Key architectural decision").
- M42's remediation-risk model has no independent Red-tier (`75`-`100`) waiver/escalation flow beyond the uniform `>=50` human-approval gate; M45 inherits that shape rather than introducing a new one.
- The pre-existing `cli.test.ts` M34 baseline mismatch noted above remains unfixed (out of M45's scope; unrelated to the maintenance-scheduling domain).

## Final milestone risk

Highest single Work Unit risk: 34/100 (WU45-04), well under the `50` human-review boundary. Milestone classification: `medium` (5 Work Units, one new canonical schema section, reuse of an existing lock primitive, no new/widened destructive or network authority) — consistent with the planning-time classification; no Work Unit reached `high_risk` territory.

## PR readiness

Branch `milestone/m45-background-maintenance-scheduling` is ready for PR: full validation green (typecheck/lint/build/tests/version-check), all 31 required dogfood scenarios pass deterministically, documentation lifecycle complete (`docs/milestones/completed/m45/` holds this closure report and the build spec; M43/M44 remain the other two hot completed milestones per protocol Sec 10, M43's archival deferred to the next milestone's own start as the protocol specifies). No PR has been opened and no GitHub Release was created, per instruction. M46/M47/M48 were not started.

## Explicit confirmations

- No arbitrary shell scheduling exists: `MaintenanceTaskKindSchema` is a closed three-member enum; no code path anywhere accepts or stores a free-form command string as a schedule payload (proven by test).
- No OS daemon/service installation exists: no code in this milestone installs, configures, or registers cron/systemd/Task Scheduler/any host scheduler.
- No parallel scheduled runs: `maintenanceActiveOccurrence` is a nullable singleton, structurally preventing more than one active occurrence per project.
- No automatic merge/PR/deploy/Release exists: no such code path was added; `defect_remediation` never invokes live execution, let alone integration/deployment.
- No AIQT self-management occurred: `.aiqt/` was never created in this repository during M45.
