# M33-WU01 — Command Result and Stream Contract Inventory

Inventory, characterization, and target-contract definition for AIQT
Milestone 33 (Unified CLI Result, Error, and Rendering Contract), Work Unit
01. This document is the primary deliverable of WU33-01: it does not migrate
command behavior. Ownership pointers are also recorded in
[`repository-owner-map.json`](repository-owner-map.json) under
`commandResultContract`; this document holds the fuller inventory/
characterization content the owner map's terse format is not meant to carry.

Baseline: branch `main`, commit `84f872ce70544533acc3d92df8ec7d75b64bb800`
(M32 close, tag `m32-wu05-workflow-parity-regression-suite`), package
`0.18.0`, schema `0.5.0`. All line numbers below are current as of this
commit and are expected to drift under normal development — re-verify
against source before relying on them, per the owner map's own disclaimer.

## 1. Owner inventory

### 1.1 Canonical result/error/renderer/stream owners (core)

| Concern | Owner | Notes |
| --- | --- | --- |
| `CommandResult` shape, `makeResult`, `errorToResult` | `src/core/output/result.ts` | Already matches the M33 §5.1 canonical interface field-for-field. Candidate authoritative factory. |
| `Issue` shape | `src/core/output/issue.ts` | `{id, severity, area, message, affectedItems?, suggestedAction?, agentCanFix?}`. |
| Typed command error | `src/core/output/aiqt-error.ts` | `AiqtError` carries `exitCode` + optional `Issue`. |
| Exit-code constants | `src/core/output/exit-codes.ts` | `ExitCode` map: `Success:0, ValidationFailed:1, WorkflowBlocked:2, InvalidInput:3, MissingDependency:4, ExternalIntegrationError:5, HumanInputRequired:10`. Matches the M33 §5.3 table exactly; `4`/`5` are declared but not observed emitted by any command in this inventory pass. |
| JSON renderer | `src/core/output/json-output.ts` | `renderJson()` — `JSON.stringify(result, null, 2)`. No compact mode. |
| Human renderer | `src/core/output/human-output.ts` | `renderHuman()` — renders `status/summary/projectStatus/currentMilestoneId/currentWorkUnitId/completedActions/changedFiles/blockingIssues/warnings/requiresHumanInput/nextRecommendedCommand`. **Never reads `result.data`.** This is the direct root cause of Contradiction C. |
| Stream/emit router | `src/cli/register-commands.ts:139-146` (`emit()`) | `exitCode === Success → stdout`, else `stderr`. Sole shared router; 7 command sites bypass it on success (§1.3), and the parser-error path (§1.4) never reaches it at all. |
| Command context (`--json` flag carrier) | `src/cli/command-context.ts` | `{cwd, json}`, trivial, one owner, no issues found. |

### 1.2 Command-family consumers (54 files under `src/cli/commands/`)

| Pattern | File count | Representative files |
| --- | --- | --- |
| Throws typed `AiqtError`, caught via `errorToResult()` | 5 | `init.command.ts`, `plan.command.ts`, `checkpoint.command.ts`, `update.command.ts`, `load-project.ts` (shared throw site, see §1.5) |
| Catches a generic error via `errorToResult()` (includes the 5 above plus others catching `loadProject()`'s throw) | 24 | `review.command.ts`, `status.command.ts`, `manage.command.ts`, `export.command.ts`, evidence/execution import families |
| Declares a local, private `function failure(summary, exitCode, issueId)` helper (pre-WU33-02: inlined `makeResult({status:"failed" or "blocked" by a WorkflowBlocked check, ...})`; post-WU33-02: delegates to `familyFailureResult()`, see §5) | 29 | every `evidence-gate-*.command.ts` (18 files), every `execution-*.command.ts` (10 files), `workspace.command.ts`, `evidence-import.command.ts` — full list in the `LOCAL_FAILURE_HELPER_FILES` constant in `tests/unit/m33-exit10-and-owner-inventory.test.ts` |
| Never checks `.aiqt/` existence itself (relies on `loadProject()`'s generic throw) | 1 confirmed (`status.command.ts`) | all others pre-check via `aiqtDirExists()` and return a bespoke `<CMD>-NO-PROJECT` result — see §3.E |
| Bypasses `emit()` with a raw-text write on success | 7 | `status.command.ts:200` (`--parallel`), `next.command.ts:237` (packet), `prompt.command.ts:492`, `manage.command.ts:524`, `skills-plan` registration `:550`, `issue-list` registration `:613`, `repair-plan` registration `:672` — all in `register-commands.ts`, all gated identically on `!ctx.json && result.exitCode === ExitCode.Success` |
| `--example` support with `--json` interaction | 5 | `plan --example` (`:305`, hard error), `checkpoint --example` (`:348`, hard error), `execution import --example` (`:1152`, silently ignores `--json`), `execution external example` (`:1251`, `--json` option registered but action takes no params — dead), `execution adapter claude-code example` (`:1321`, same dead-option shape) |

### 1.3 Raw-text bypass sites (exact)

All in `src/cli/register-commands.ts`, all structurally identical: `if (!ctx.json && result.exitCode === ExitCode.Success) { ...write raw text...; return; } emit(result, ctx.json);`

1. `status --parallel` — line 200, `renderParallelStatusText(data.parallelStatus)`
2. `next` (non-preview) — line 237, `data.packet` (raw copy-pasteable packet text)
3. `prompt <kind>` (no `--out`) — line 492, `data.prompt`
4. `manage` — line 524, `renderManageReportText(...)`
5. `skills plan` — line 550, `renderSkillsPlanText(data)`
6. `issue list` — line 613, `renderIssueListText(data)`
7. `repair plan` — line 672, `renderRepairPlanText(data)`

Because the gate is `exitCode === Success`, not `status === "passed"`, any of these commands returning `status: "warning"` with `exitCode: 0` (a real, reachable combination — see Contradiction D) still takes the bypass and drops `warnings`/`blockingIssues`/`nextRecommendedCommand` from human output.

### 1.4 Parser-error path (owner: `src/index.ts` + `register-commands.ts`'s root `.exitOverride()`)

`register-commands.ts`'s root `.exitOverride()` (around line 160) sets `process.exitCode` and rethrows commander's own error object. `src/index.ts`'s `catch` block only special-cases `commander.helpDisplayed`/`commander.version`/`commander.help` (exit 0) and otherwise leaves `process.exitCode` as already set — it never constructs a `CommandResult`, never calls `renderJson`/`renderHuman`, and never inspects whether `--json` was requested. Commander's own error text is written directly by commander itself (its default `configureOutput`, to stderr) before either handler runs. This path is entirely outside the `CommandResult`/`emit()` pipeline.

### 1.5 Missing-project owners (per command family)

- **Generic/unhandled**: `src/cli/commands/load-project.ts`'s `loadProject()` throws `AiqtError` with `Issue{id:"AIQT-DIR-MISSING", severity:"critical", area:"filesystem", suggestedAction:"Run aiqt init to create a project."}`, exit `InvalidInput` (3). Converted by `errorToResult()`, which never sets `nextRecommendedCommand` (stays `null`). **`status.command.ts` is the only command in this inventory that takes this generic path** (it calls `loadProject()` directly inside its own `try`, with no `aiqtDirExists()` pre-check).
- **Bespoke per-family**: `review.command.ts`, `next.command.ts`, `manage.command.ts`, `export.command.ts` each pre-check `aiqtDirExists()` and return their own `<CMD>-NO-PROJECT`, `severity:"high"`, `area:"workflow"`, `nextRecommendedCommand:"aiqt init"` result.
- **Local-`failure()`-helper families** (evidence-gate/execution/workspace): also pre-check `aiqtDirExists()`, but route through the local `failure(summary, exitCode, issueId)` helper (e.g. `EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT`, `area:"evidence-gate"`), which — like all `failure()` calls in these files — never sets `projectStatus`/`currentMilestoneId`/`currentWorkUnitId`/`nextRecommendedCommand`, so even though these families got the exit-code/severity right, `nextRecommendedCommand` is still `null` (not `"aiqt init"`), same net defect as the generic path but for a different structural reason.

## 2. Characterized contradictions (A-H)

Each was reproduced against a real CLI invocation in a disposable temp directory outside the repository, via `spawnSync` against `tsx`/`src/index.ts` (the same convention `tests/integration/*.test.ts` already uses). Exact reproductions are captured as the characterization tests in §4; this section records the result.

### A. Parser-level JSON loss

| Invocation | Stream | Exit | Body |
| --- | --- | --- | --- |
| `aiqt bogus --json` | stderr | 3 | commander's own text, `error: unknown command 'bogus'` — not JSON |
| `aiqt status --bogus --json` | stderr | 3 | `error: unknown option '--bogus'` — not JSON |
| `aiqt evidence gate policy show --json` (missing required `<policy-id>`) | stderr | 3 | `error: missing required argument 'policy-id'` — not JSON |

**Future contract:** all three must produce valid `CommandResult` JSON on stdout per M33 §5.4/§5.5 (deferred to WU33-03; not implemented in WU33-01).

### B. Exit code 10 invariant

Exact file-level split as of this baseline (§1.2): **27 files** use `ExitCode.HumanInputRequired` (10). **5** (`checkpoint.command.ts`, `export.command.ts`, `import.command.ts`, `plan.command.ts`, `update.command.ts`) pair it with `status:"needs_input"` and `requiresHumanInput:true`. **22** (all local-`failure()`-helper families, including `issue-update.command.ts` and `workspace.command.ts`) pair it with `status:"failed"` and `requiresHumanInput:false` (the helper hardcodes `status:"failed"` unconditionally regardless of the exit code passed in). Live reproduction: `aiqt import plan --json` (no input) → `needs_input`/`true`/10; `aiqt evidence import --json` (no input) → `failed`/`false`/10. The invariant `exitCode===10 ⇔ status==="needs_input" ∧ requiresHumanInput===true` **does not hold** for 22 of 27 sites.

### C. Human review findings

Reproduced with a project carrying one real, non-blocking review finding (an in-progress work unit with no other blockers → `status:"warning"`, `result.findingCount>0`, `hasBlocking=false`). `review.command.ts` places the finding **only** in `data.findings`; the top-level `warnings` array in this command is populated from `loadProject()`'s `runlogHealth` warnings, not from review findings, and is empty in this scenario. Since `renderHuman()` never reads `result.data`, `aiqt review` (text) prints the summary line and nothing else — no finding text, no finding key. `aiqt review --json` shows the finding in full under `data.findings[]`, including its stable `id`. **Note on scope precision:** `graph-validate.command.ts` does **not** share this defect — it correctly maps `blockingErrors`/`warnings` into the top-level `blockingIssues`/`warnings` channels (in addition to redundantly duplicating them into `data`), so its human output already shows findings. Contradiction C is specific to `review`, not domain-findings rendering in general.

### D. Specialized output bypass

Reproduced via `aiqt plan --example`'s own shipped fixture pattern (an `agentContextRefs` entry that cannot resolve, e.g. `"project.objective"`), which causes `aiqt next` to return `status:"warning"`, `exitCode:0`, with a real `NEXT-UNRESOLVED-CONTEXT-REF` warning and a real `nextRecommendedCommand`. Because the raw-text bypass (§1.3) gates only on `exitCode===Success`, human-mode `aiqt next` prints only the packet text — no warning, no `nextRecommendedCommand` line — while `aiqt next --json` carries both.

### E. Missing-project behavior

| Command | Issue id | Severity | Area | Exit | `nextRecommendedCommand` |
| --- | --- | --- | --- | --- | --- |
| `status` | `AIQT-DIR-MISSING` | critical | filesystem | 3 | `null` |
| `review` | `REVIEW-NO-PROJECT` | high | workflow | 3 | `"aiqt init"` |
| `evidence gate policy show` | `EVIDENCE-GATE-POLICY-SHOW-NO-PROJECT` | high | evidence-gate | 3 | `null` |
| `execution status` | (equivalent local `failure()` pattern) | high | execution | 3 | `null` |
| `workspace status` | (equivalent local `failure()` pattern via `noProjectFailure()`) | high | workspace | 3 | `null` |
| `import <type>` | (routes through `errorToResult`) | — | — | 3 | `null` |

No two families agree on both issue-id shape and `nextRecommendedCommand`; only `review`/`next`/`manage`/`export` (which special-case `aiqtDirExists()` explicitly and hand-construct the result) produce the actionable `"aiqt init"` recommendation.

### F. Workflow pointers in failure results

Reproduced against a live project with real `currentMilestoneId`/`currentWorkUnitId`/`projectStatus` set (confirmed via `aiqt status --json` immediately beforehand). Two distinct failure paths were compared: `aiqt review --mode bogus --json` (a core-family command; its `REVIEW-INVALID-MODE` branch validates `--mode` **before** calling `loadProject()`, so it has no loaded state to populate pointers from, even though a real project exists on disk) and `aiqt evidence gate policy show DOES-NOT-EXIST --json` (a local-`failure()`-helper family; the helper is never given the loaded state either). **Both discard the pointers identically** — `projectStatus`/`currentMilestoneId` are `null` in both, despite a live project existing in both cases.

**Note on precision vs. the pre-M33 audit's original framing:** this WU01 pass initially attempted to reproduce this with `aiqt checkpoint --from-file <missing-path>`, expecting pointer loss there too — it does **not** lose pointers: `checkpoint.command.ts`'s inner `try/catch` (around its file-load call) routes any `AiqtError` thrown after `loadProject()` succeeds through a local `failedOnState(state, ...)` helper that explicitly re-attaches `state.projectStatus`/`currentMilestoneId`/`currentWorkUnitId` before returning. So pointer retention on failure is not a clean "core vs. non-core family" split — it depends on whether the specific failure branch was hand-built with access to already-loaded state (as `checkpoint`'s inner catch and `failedOnState` are) or constructed before/without state access (as `review --mode bogus`'s early-return and every local `failure()` helper are). This is a single shared-adapter gap (`errorToResult()` and the local `failure()` helpers never accept a loaded-state parameter to populate pointers from) rather than a family-level contradiction — recorded precisely so WU33-02 targets the right owner and doesn't assume "core commands are fine."

### G. `status --parallel`

`status.command.ts:132-135`: `if (options.parallel) return buildParallelStatusResult(...)` — this returns **before** any of the normal status computation runs, so in **both** JSON and text mode the result is `buildParallelStatusResult`'s own `CommandResult`, which has `data.parallelStatus` but no normal status fields populated beyond the base `CommandResult` shape (no milestone/work-unit-count summary, etc.). In JSON mode this is delivered as ordinary `CommandResult` JSON (structurally consistent, just a different `data` shape than plain `status --json`). In text mode, `register-commands.ts:197-204` intercepts **again**, replacing even the generic `renderHuman()` rendering of that same result with `renderParallelStatusText(data.parallelStatus)` — a completely separate, dedicated advisory-only report with none of `renderHuman`'s normal summary/status line. So `--parallel` is additive to the command's own logic (JSON and text both receive the identical underlying `CommandResult`) but the **text renderer** for that result is fully specialized rather than reusing `renderHuman` at all — text output shows only the parallel report, JSON output is `CommandResult` with `data.parallelStatus`. Net effect matches the audit's original characterization: text mode shows meaningfully different content than a structural read of the JSON body would suggest, because JSON is generic-`CommandResult`-shaped while text is a bespoke report with no `renderHuman` fields visible at all.

### H. `--example --json`

Three distinct behaviors confirmed live:
1. `aiqt plan --example --json` → hard error, exit 3, `PLAN-EXAMPLE-JSON-CONFLICT`, valid `CommandResult` JSON (this one path is actually already JSON-safe).
2. `aiqt execution import --example --json` → `--json` silently ignored; raw example JSON printed to stdout, exit 0, payload has no `status`/`exitCode`/`CommandResult` shape at all.
3. `aiqt execution external example --json` (and `aiqt execution adapter claude-code example --json`) → `--json` option is registered on the command but the action callback takes zero parameters, so the flag is inspected by nothing; behavior is identical with or without it — a dead option.

## 3. Canonical contract decisions (WU33-01 definition; migration deferred)

These adopt the M33 spec's §5 governing decisions as-is (the spec's decisions are themselves already authoritative per the milestone build spec); this section records that WU33-01 accepts them without modification and identifies the exact current owner each decision will migrate onto in later Work Units.

- **5.1 Canonical `CommandResult`** — `src/core/output/result.ts`'s existing `CommandResult`/`makeResult` already conforms; no type change needed in WU33-01.
- **5.2 Exit-10 invariant** — target: `exitCode===10 ⇔ status==="needs_input" ∧ requiresHumanInput===true`; **enforced centrally in WU33-02 via `familyFailureResult()`, see §5** (§2.B's 22-of-27 count reflects the pre-WU33-02 baseline and includes one false positive corrected in §5).
- **5.3 Exit-code table** — `src/core/output/exit-codes.ts`'s `ExitCode` map already matches verbatim; no change needed.
- **5.4 JSON guarantee** — target owner: a wrapper around `src/index.ts`'s parser-error catch block, adapting commander's thrown error into `errorToResult`/`renderJson`, deferred to WU33-03.
- **5.5 Stream policy** — adopted as stated (`--json` → stdout always; human diagnostics → stderr only outside JSON mode). Current `emit()` routes by `exitCode===Success` instead, which conflicts with this policy for every non-zero-exit `--json` call; migration deferred to WU33-03.
- **5.6 Human/JSON substantive parity** — target owner: `renderHuman()` extended to read `result.data` for known specialized shapes (review findings, graph-validate findings, parallel status), deferred to WU33-04.
- **5.7 Issue-channel normalization** — target: review findings routed into `warnings`/`blockingIssues` the way `graph-validate` already does (§2.C's scope note), deferred to WU33-04.
- **5.8 Specialized renderer policy** — target: the 7 raw-text bypass sites (§1.3) gain a shared warnings/blockers/next-command footer, deferred to WU33-04.
- **5.9 Result factory and error adaptation** — `makeResult`/`errorToResult` are the designated convergence target for all 29 local `failure()` helpers (§1.2); **done, see §5**.
- **5.10 Missing-project contract** — **done, see §5**: `missingProjectResult()` added to `result.ts`; `status.command.ts` migrated onto it, and `familyFailureResult()`'s automatic `NO-PROJECT`/`DIR-MISSING` detection closes the gap for every local-`failure()`-helper family.
- **5.11 Example-mode policy** — WU33-01 does not select between the spec's two listed options (allow structured JSON vs. reject with exit 3) — that choice is deferred to WU33-03, which owns implementing it consistently across all 5 `--example` sites (§1.2).

No contract type change, schema-version change, or runtime dependency was made in WU33-01. The existing `CommandResult`/`Issue`/`ExitCode`/`AiqtError` types in `src/core/output/` are retained unmodified; this document and the owner-map entry are additive.

## 4. Characterization tests

See `tests/integration/m33-result-contract-characterization.test.ts` (contradictions C, D, F, G remain characterized as pre-existing; A, B, E, H are now closed-and-proven, see §5/§6) and `tests/unit/m33-exit10-and-owner-inventory.test.ts` (direct unit tests of `familyFailureResult`/`missingProjectResult`, plus the unauthorized-new-result-owner architecture guard over the local `failure()` helpers and 7 raw-text bypass sites).

## 5. WU33-02 addendum — factory convergence, exit-10, and missing-project fixed

Two corrections to §1's inventory, discovered during WU33-02 implementation:

- **File-count correction**: §1.2's "27 files" using `ExitCode.HumanInputRequired` included `issue-update.command.ts` as a false positive — that file only *mentions* `HumanInputRequired` inside a doc comment ("Missing args ... are InvalidInput (3), never HumanInputRequired") and never actually constructs an exit-10 result. The real count is **26** files (confirmed via `grep -c "ExitCode\.HumanInputRequired"`), of which 21 (not 22) were non-compliant pre-WU33-02.

- **`familyFailureResult()`** (`src/core/output/result.ts`) is now the single authoritative implementation the M33 §5.9 "result factory and error adaptation" decision calls for, covering all 29 local `failure()` helper files (§1.2/§3.B). Each file's `failure()` wrapper function body was rewritten to delegate to it instead of inlining `makeResult({status: exitCode===WorkflowBlocked ? "blocked" : "failed", ...})`; the wrapper functions themselves are intentionally retained (not inlined away at call sites) — full removal is WU33-05 scope. This closes **Contradiction B** completely: `familyFailureResult` derives `status`/`requiresHumanInput` from `exitCode` (`WorkflowBlocked→blocked`, `HumanInputRequired→needs_input`+`true`, else→`failed`), so every one of the 26 real exit-10 call sites (5 already-compliant core files + 21 now-migrated files) satisfies the invariant.

- **`missingProjectResult()`** (`src/core/output/result.ts`) is the shared implementation for the bespoke pre-check pattern (`review`/`next`/`manage`/`export`'s existing convention). `status.command.ts` — the one outlier identified in §1.5 that fell through to the generic `AIQT-DIR-MISSING`/`errorToResult` path — now pre-checks `aiqtDirExists()` and returns `missingProjectResult("status", "STATUS")`, matching the convention. Separately, `familyFailureResult` auto-detects any `issueId` matching `NO-PROJECT|DIR-MISSING` and populates `nextRecommendedCommand: "aiqt init"` automatically, closing the gap for every local-`failure()`-helper family's own missing-project branch. This closes **Contradiction E**: all families now agree on the actionable recommendation (family-specific issue ids/areas are intentionally retained — M33 §5.10 requires the same semantic *category*, not byte-identical ids).

- **Contradiction F (workflow pointers) is only partially addressed.** `familyFailureResult` accepts optional `projectStatus`/`currentMilestoneId`/`currentWorkUnitId` parameters and retains them when supplied, but WU33-02 did not thread live state through the ~230 individual `failure(...)` call sites across the 29 files — doing so is deferred as a residual risk (see the WU33-02 commit message and the M33 closure report). Contradiction F therefore remains live and is still characterized by the (renamed but behaviorally unchanged) test in `m33-result-contract-characterization.test.ts`.

- Contradictions A, C, D, G, H are unchanged by WU33-02 (out of its scope; owned by WU33-03/WU33-04 per §3).

## 6. WU33-03 addendum — parser-level JSON, stream policy, and example-mode fixed

- **`parserErrorToResult()`** (`src/core/output/result.ts`) converts a commander `CommanderError` (unknown command, unknown option, missing required argument, and 5 other CommanderError codes) into a canonical `CommandResult`. `CommandResult.action`'s type was widened from `WorkflowAction` to `WorkflowAction | string` (matching M33 §5.1's canonical interface exactly) so this path can report `action: "cli"` for a failure that occurred before any specific command was ever dispatched.
- **`register-commands.ts`** now calls `.configureOutput({ writeErr })` on the root program, suppressing commander's own raw-text error output only when `--json` was requested (detected via `argvRequestsJson()` in `command-context.ts`, since parsing failed before a `CommandContext` could be constructed normally). Human-mode parser errors are completely unaffected — commander's own text still reaches stderr exactly as before.
- **`src/index.ts`**'s catch block now builds and emits the `parserErrorToResult()` JSON to stdout when `--json` was requested. This closes **Contradiction A**: all 3 required parser-error classes now produce valid, parseable `CommandResult` JSON.
- **Stream policy (M33 §5.5)**: `register-commands.ts`'s `emit()` now writes `--json` output to stdout unconditionally, regardless of exit code (previously: stdout only when `exitCode === Success`, else stderr). Human-mode output keeps the pre-M33 behavior (stdout on success, stderr otherwise) since nothing in the M33 spec requires changing it and it remains meaningful for a human at a terminal. This is the exact preferred policy M33 §5.5 states. **Retroactively closes the stream-routing half of Contradiction B** (exit-10 JSON now lands on stdout, not just the body-field pairing WU33-02 fixed) and the JSON/stream half of **Contradiction G** (`status --parallel --json`'s `CommandResult` was already stdout-reachable on success; now every exit code is).
- **Example-mode policy (M33 §5.11)**: adopted "reject the combination with exit code 3" uniformly — the policy `plan --example`/`checkpoint --example` already used. `execution import --example --json` (previously: silently ignored `--json`, printed the raw example, exit 0) and `execution external example --json`/`execution adapter claude-code example --json` (previously: dead options, `--json` never read) now all reject with a dedicated `*-EXAMPLE-JSON-CONFLICT` issue id, exit 3, matching `plan`/`checkpoint`'s shape exactly. This closes **Contradiction H**: all 5 `--example`-supporting commands now behave identically when `--json` is also passed.
- **Migration impact**: the stream-policy change moved `--json` output from stderr to stdout for every non-zero-exit-code command result. 41 existing test call sites across 15 pre-existing integration test files (`JSON.parse(res.stderr)` and equivalent) were updated to read stdout instead; 6 further call sites already used a resilient `stdout || stderr` or ternary pattern and needed no change. All updated files were re-run individually and pass; the full suite shows no assertion regressions (only the pre-existing, already-documented timeout-class baseline).
- Contradictions C, D, F unchanged by WU33-03 (F remains open per §5; C/D are WU33-04 scope).
