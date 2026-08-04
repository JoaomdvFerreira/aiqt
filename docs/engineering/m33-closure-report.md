# AIQT Milestone 33 Closure Report

## Milestone

**Title:** AIQT Milestone 33: Unified CLI Result, Error, and Rendering Contract

**Objective:** Establish one enforceable command-result, exit-code, stream, and rendering contract across the AIQT CLI so humans and coding agents receive consistent, parseable, and actionable outcomes from every command.

**Risk classification:** High-risk (per build spec). Final closure risk score: `35/100` (highest single Work Unit risk: WU33-03 at 45/100).

**Starting commit:** `84f872ce70544533acc3d92df8ec7d75b64bb800` (`m32-wu05-workflow-parity-regression-suite`)

**Ending commit:** `06585f0b59b327fed31d03b5f37e5172d478f245`, tagged `m33-wu05-result-contract-regression-suite` and `v0.19.0`

**Package version:** `0.18.0` → `0.19.0` (minor increment; see Versioning below)

**Canonical schema version:** `0.5.0` (unchanged)

## Work Units

| Work Unit | Commit | Tag | Scope |
| --- | --- | --- | --- |
| WU33-01 | `0f2abc5` | `m33-wu01-result-contract-inventory` | Full owner inventory; characterized Contradictions A-H with live CLI reproductions; canonical-contract decisions recorded (inventory only, no migration). |
| WU33-02 | `5e188bb` | `m33-wu02-central-result-factory` | `familyFailureResult()`/`missingProjectResult()` added; all 29 local `failure()` helpers migrated to delegate; `status.command.ts` migrated onto the missing-project convention. Closed Contradictions B and E. |
| WU33-03 | `d57cd3e` | `m33-wu03-json-parser-and-stream-contract` | `parserErrorToResult()` added; commander parser errors now produce valid JSON under `--json`; `emit()`'s stream policy changed to always route `--json` to stdout; `--example --json` standardized to reject-with-exit-3 across all 5 sites. Closed Contradictions A and H; completed the stream half of B and G. 41 existing test call sites migrated stderr→stdout. |
| WU33-04 | `cbaf163` | `m33-wu04-unified-human-rendering` | `renderResultFooter()` added and wired into all 7 raw-text bypass sites; `renderIssue()` now shows stable ids; `review.command.ts` routes non-blocking findings into `warnings` with the corrected `findingKey`-based id. Closed Contradictions C, D, and the text half of G. |
| WU33-05 | `06585f0` | `m33-wu05-result-contract-regression-suite` | Cross-command contract matrix (58/58 commands confirmed to expose `--json`); suite-wide architecture guards; 29 local `failure()` helpers deprecated (not removed); machine-facing CLI contract documented (`cli-machine-contract.md`, linked from README); package version bumped 0.18.0→0.19.0 with explicit breaking-change labeling. |

## Canonical Contract

**`CommandResult`:** unchanged in shape from the pre-M33 repository contract (`src/core/output/result.ts`), which already matched the M33 spec's canonical interface field-for-field. One type widening: `action` is now `WorkflowAction | string` (M33 §5.1), used only by the new parser-error path (`action: "cli"`).

**Exit-code table:** unchanged (`0/1/2/3/4/5/10`, `src/core/output/exit-codes.ts`), already matched the M33 spec verbatim.

**Exit-10 invariant** (`exitCode===10 ⇔ status==="needs_input" ∧ requiresHumanInput===true`): now holds for all 26 real call sites (WU33-01's original 27-file count included one false positive, `issue-update.command.ts`, corrected during WU33-02). Enforced centrally by `familyFailureResult()`.

**JSON stream policy:** `--json` output now always lands on stdout regardless of exit code (M33 §5.5's stated preferred policy, adopted verbatim). Human-mode output is unchanged (stdout on success, stderr otherwise).

**Parser-error adaptation:** commander `CommanderError`s (unknown command, unknown option, missing required argument, and 5 further codes) are converted to canonical `CommandResult` JSON via `parserErrorToResult()` when `--json` was requested; commander's own raw text is suppressed for that case via `.configureOutput()` and remains unaffected for human mode.

**Human/JSON parity:** `renderHuman()` now surfaces every review finding (via the `warnings` channel) and every specialized command's status/warnings/blockers/next-command (via the shared `renderResultFooter()` trailing its bespoke body). `graph-validate.command.ts` required no change — it already populated the shared channels correctly.

**Specialized renderer policy:** all 7 raw-text bypass sites (`status --parallel`, `next`, `prompt`, `manage`, `skills plan`, `issue list`, `repair plan`) keep their bespoke primary body and now trail the shared footer.

**Missing-project / missing-input behavior:** all missing-project results across every command family now set `nextRecommendedCommand: "aiqt init"` (family-specific issue ids/areas retained by design, per M33 §5.10's "same semantic category" requirement). Missing-input (`needs_input`) is now consistent everywhere exit 10 is used.

**Example-mode policy:** all 5 `--example`-supporting commands now uniformly reject `--example --json` with exit 3 and a dedicated `*-EXAMPLE-JSON-CONFLICT` issue id.

## Migrated Command Families

All 29 files across the evidence-gate (18), execution (10), evidence-import (1), and workspace (1) families that previously hand-rolled result construction now delegate to `familyFailureResult()`. `status.command.ts` (core family) migrated onto `missingProjectResult()`. `review.command.ts` (core family) migrated its finding-to-warning mapping. No command's core business logic changed — only result/error/rendering construction.

## Findings Closed or Reduced

- `HIGH-006` (review findings hidden in human mode): **closed**.
- `HIGH-007` (`--json` lost on parser errors; undocumented stream behavior): **closed**.
- `HIGH-008` (raw-text paths omit warnings/blockers/next-command): **closed**.
- `HIGH-009` (exit 10 body contradictions): **closed**.
- `MED-003` (inconsistent missing-input/mode exit codes): **closed** via the exit-10 convergence.
- `MED-004` (null workflow pointers in later command families' error results): **reduced, not closed**. Contradiction F remains open — documented explicitly in the new contract doc rather than left silent.
- `MED-005` (`status --parallel` text/JSON divergence): **closed**.
- `MED-008` (`--example --json` inconsistency): **closed**.
- `MED-009` (findings split across channels): **closed** for review; the underlying issue-channel policy is now documented and suite-guarded.
- `MED-011` (uninitialized-project inconsistency): **closed**.
- `LOW-007` (no documented machine-facing CLI contract): **closed** (`cli-machine-contract.md`).
- `LOW-008` (payload verbosity): **assessed, deferred** — not implemented, per the spec's explicit correctness-first ordering.
- `LOW-011` (typed-error/local-`failure()` convergence): **closed** via centralization + deprecation.

## Validation

Standard validation commands passed at every Work Unit:

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm build`
- `corepack pnpm version:check` (local mode at WU33-01 through WU33-04; `--base v0.18.0` comparison mode at WU33-05, confirming the required minor bump)
- `git diff --check`

Each Work Unit's own new/updated tests were run in isolation before any broader suite, per the milestone's Work-Unit-at-a-time discipline. Directly-relevant pre-existing suites were re-run explicitly after every behavior-affecting change (WU33-02: 72 tests; WU33-03: 156 tests across two batches; WU33-04: 160 tests across two batches) — zero regressions found across all of them.

**Official full-suite result must not be reported as passing outright.** `corepack pnpm test` was run once per Work Unit; every run showed only the pre-existing, already-documented Vitest 5000ms timeout-class baseline (M32 closure report: "known timeout-heavy baseline, not a reported assertion regression"). Exact per-Work-Unit tallies:

| Work Unit | Files passed/total | Tests passed/total | Failures confirmed pure timeout |
| --- | --- | --- | --- |
| WU33-01 | 213/221 | 2288/2299 | 76/76 |
| WU33-02 | 214/229 | 2296/2369 | 73/73 |
| WU33-03 | 211/229 | 2290/2372 | 82/82 |
| WU33-04 | 218/229 | 2328/2372 | 44/44 |
| WU33-05 | 213/230 | 2313/2379 | 66/66 |

Every failure across every run was individually confirmed to be `Test timed out in 5000ms`/`20000ms` with zero `AssertionError`s (verified by grep over full raw output each time), and no M33-authored test ever appeared among the confirmed-regression set. The failing file/test sets vary run-to-run in size (44-82 tests) purely with this machine's concurrent load at the time, consistent with the established, previously-diagnosed cause (`docs/engineering/m30-correction-node22-integration-timeouts.md`).

## Breaking Changes (explicitly labeled per `docs/versioning.md`'s pre-1.0 policy)

1. Exit code 10 now always pairs with `status:"needs_input"`/`requiresHumanInput:true`. Any consumer of the 21 previously-affected commands (evidence-gate-\*, execution-\*, workspace) checking `status==="failed"` for this exact exit code must switch to `status==="needs_input"`.
2. `--json` output now always lands on stdout, never stderr, for any exit code. Any consumer reading stderr for a `--json` invocation's body on a non-zero exit code must read stdout instead.
3. `execution import --example --json`, `execution external example --json`, and `execution adapter claude-code example --json` now reject with exit 3 instead of (respectively) silently succeeding or being a dead option.

## Remaining Result-Contract Risks

- **Contradiction F (workflow pointers on failure) remains open.** `familyFailureResult()` supports pointer parameters, but no call site across the 29 migrated files was given the loaded project/state to populate them from. Documented explicitly in `cli-machine-contract.md`'s closing section as a known gap, not silently unresolved.
- **The 29 local `failure()` wrapper functions were deprecated, not removed.** They are now zero-risk pass-throughs, but the syntactic duplication (one wrapper per file) remains; removing it would require touching ~230 call sites for no behavioral benefit.
- **Payload verbosity is unaddressed.** Every `--json` response emits the full 13-field `CommandResult` shape; no compact mode exists.
- **The systemic Vitest timeout baseline remains unresolved** — explicitly out of M33's scope per the build spec (§2, "M33 does not fix the systemic Vitest timeout baseline").

## Recommendation

The CLI result/error/rendering contract is unified and suite-enforced across the full public command surface. **The timeout corrective milestone may begin next.** Packaged-binary validation and dependency-audit governance (both named in the build spec's §10 residual risks) remain separate future work.

**Autonomous execution remains deferred.** No autonomous maintenance runner, background scheduling, model invocation, or code-modification capability was introduced or enabled by this milestone. M33 establishes part of the machine/human interaction contract the build spec states is required before autonomous execution can be trusted — it does not itself authorize or approach that capability.
