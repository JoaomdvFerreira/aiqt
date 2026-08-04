# AIQT Milestone 36 — Autonomous Run Contract and Threat Model (WU36-01)

## Purpose

Defines the run lifecycle, safety-classification model, budget model, command policy, result/evidence contract, and audit events for AIQT's prospective autonomous maintenance runner (build spec Sec 6-7) — **before any autonomous code execution is enabled.** No coding model is invoked, no repository is modified autonomously, no worktree is created for autonomous execution, and no arbitrary shell command runs as a result of this Work Unit. Every contract below is data shapes and pure decision functions; `docs/engineering/m36-closure-report.md`-equivalent enablement is explicitly deferred to WU36-02 through WU36-05.

## 1. Entry Gate Verification

| Condition | Status | Evidence |
| --- | --- | --- |
| M35 closure report exists | ✅ | `docs/engineering/m35-closure-report.md` |
| M35 milestone closure tag exists | ✅ | `m35-test-suite-rationalization` (points at `441d332`) |
| Node 24 CI is authoritative and green | ✅ | Latest `Validate` run on `main` (`30916344079`, commit `441d332`): `completed success` |
| Critical regression coverage preserved during M35 | ✅ | `docs/engineering/m35-closure-report.md` "Critical Coverage Map": all 12 required categories confirmed non-empty before and after M35 |
| CI runtime and test-rationalization evidence documented | ✅ | `docs/engineering/m35-closure-report.md` "Runtime Confirmation" (3-run CI evidence) and `docs/engineering/m35-test-suite-inventory.md` |
| Working tree clean | ✅ | `git status --short` clean at Work Unit start (one pre-existing untracked file, this milestone's own build spec, matching the established per-milestone kickoff pattern) |
| Product `.aiqt/` absent | ✅ | `ls .aiqt` → does not exist |

**Baseline SHA:** `441d3323bbfa56bc84f3bde9635bf66a06ab0a81` (M35 closure report commit).

Gate passes. WU36-01 proceeds.

## 2. Capability Inventory

### 2.1 Reusable capabilities

| Area | Owning module(s) | What exists | Reusable for M36 as |
| --- | --- | --- | --- |
| Execution runs | `src/schema/execution-session.schema.ts`, `src/services/execution-session-service.ts`, `src/workflow/execution-session-transitions.ts` | A full external-agent execution-session protocol: status enum (`planned/running/paused/blocked/stale/failed/completed/cancelled`), terminal-status set, allowed-transition table, budget schema (`maxIterations`/`maxTokens`/`maxDurationSeconds`/`staleAfterSeconds`), budget-state enum (`not_configured/within/reached/exceeded`) | Direct structural precedent for M36's own (distinct) run lifecycle and budget schema — mirrored, not reused verbatim, since M36's run represents AIQT's own prospective self-driven action, not an externally-driven session AIQT observes |
| Workspace/worktree creation | `src/workspaces/git-command-runner.ts`, `workspace-service.ts`, `workspace-path-policy.ts`, `workspace-branch-policy.ts`, `workspace-operation-lock.ts`, `workspace-recovery.ts` | Real, in-production isolated-worktree lifecycle: `gitWorktreeAdd`/`gitWorktreeRemove` (the only 2 mutating allowlisted Git subcommands), branch-name derivation with injection-safe sanitization, workspace-root validation (symlink/traversal/home-dir/filesystem-root rejection), operation locking, crash recovery planning | The actual execution mechanism WU36-03 should call, not reimplement — M36-WU01 deliberately does not import any of these modules (see Sec 6/8's architecture guard) |
| Issue records | `src/services/issue-service.ts` | `NormalizedIssue`, issue classification tags, override/promotion tracking, deterministic `checkpointIssueKey`/`reviewIssueKey` id minting | Precedent for `AutonomousCandidate.issueId` shape and for a future Work Unit's candidate-intake normalization |
| Evidence records | `src/schema/evidence.schema.ts`, `src/services/evidence-service.ts`, `src/workflow/evidence-gate-simulation-engine.ts` | `EvidenceRecordSchema`, trust-level ordering, a pure read-only simulation engine (`evaluateRule`/`aggregateOverallResult`/`simulate`) that never imports the runlog store or state writer | Direct structural precedent for `AutonomousEvidencePacketSchema` and for a future Work Unit's own read-only self-review evaluator |
| Validation | `package.json#scripts.validate`, `src/tooling/version-check.ts`, `tests/workload-timeout-policy.ts` | The authoritative `typecheck → lint → build → test → version:check` sequence; per-workload-class timeout policy | The "authoritative repository validation" a future Work Unit's validation step must invoke, not reinvent |
| Review | `src/workflow/execution-adapter-review-findings.ts`, `src/services/checkpoint-service.ts` | Finding collection from execution-adapter results; checkpoint completion-gate evaluation | Precedent for a future Work Unit's self-review step structure (collect findings, gate on unresolved-critical) |
| Runlog | `src/state/runlog-store.ts` | 55 existing `build*Event()` builders, `appendRunlogEvent`, append-only audit trail, `inspectRunlogHealth` | The audit mechanism `AUTONOMOUS_RUN_EVENT_TYPES` (Sec 5.7 below) is reserved for — no builder function is added in this Work Unit |
| Command policies | `src/workspaces/git-command-runner.ts` | No generic `runGit(args)` escape hatch; every exported function is exactly one allowlisted subcommand; `shell: false`; bounded output; sanitized errors | The exact command-execution-safety pattern a future Work Unit's real command runner must follow; `classifyCommand`/`decideCommand` (this Work Unit) answer an earlier, narrower question (which broad class does a command string belong to) that a real runner would ask before ever reaching this pattern |
| Cancellation | `src/cli/commands/next-cancel.command.ts`, `src/workflow/work-unit-cancel-transition.ts` | A real cancel-transition function (`applyWorkUnitCancelTransition`) for the work-unit/packet lifecycle | Structural precedent for a future Work Unit's run-cancellation transition, though the target lifecycle differs |
| Timeout handling | `tests/workload-timeout-policy.ts`, `vitest.config.ts` | Class-scoped test-execution timeout policy (M34) | Not directly reusable (that policy governs test execution, not a live autonomous run) but establishes this repository's existing convention of explicit, evidence-based, class-scoped budgets over a single global value — directly informing `AutonomousBudgetsSchema`'s per-dimension shape |
| External command invocation | `src/workspaces/git-command-runner.ts`, `tests/integration/*.test.ts`'s `spawnSync(process.execPath, ...)` CLI-invocation pattern | Two established, safe subprocess-invocation patterns already in production/test use | Precedent only; M36-WU01 invokes neither |
| Branch handling | `src/workspaces/workspace-branch-policy.ts` | `deriveBranchName`/`isValidAiqtBranchShape` — deterministic, injection-safe, ref-format-checked | Directly reusable by a future Work Unit for the run's own branch, likely with a distinct prefix/template to distinguish an autonomous-run branch from a workspace-prepare branch |
| Result packets | `src/core/output/result.ts` (M33) | The canonical `CommandResult` shape, `CommandStatus` (`passed/failed/blocked/warning/needs_input`), exit-code table | `AutonomousResultStateSchema` extends this vocabulary with 4 additional autonomous-run-specific states (`cancelled`/`budget_exhausted`/`validation_failed`/`review_rejected`) not meaningful for an ordinary synchronous CLI command; `AutonomousEvidencePacketSchema` is the M36-specific packet, explicitly required to "follow the M33 machine contract" (build spec WU36-04) in a later Work Unit, not to duplicate it here |
| Human approval | `src/cli/commands/evidence-gate-exception-create/list/revoke.command.ts`, `evidence-gate-enforcement-activation-prepare/activate/deactivate.command.ts` | A real "prepare, then require an explicit second step to proceed" governed-activation pattern; a real "scoped, expiring, auditable exception" pattern | Direct structural precedent for the `awaiting_approval → preparing_workspace` transition and for `RISK_CLASSES_REQUIRING_APPROVAL`'s intended future wiring (an explicit approval event, analogous to `evidence-gate-enforcement-activation-activate`, not a config flag) |

### 2.2 Missing capabilities (not present anywhere in the repository; must be built in WU36-02 through WU36-05, not this Work Unit)

- A real candidate-intake entry point (no CLI command or service accepts an "autonomous candidate" today).
- A real repository-preflight check (dirty-tree detection exists for the *workspace* domain at `git-command-runner.ts`'s `gitStatusPorcelain`/`gitDiffQuietIsClean`, but no caller wires it to a candidate-classification decision yet).
- A real bounded command runner that enforces `AutonomousExecutionPolicy` at execution time (this Work Unit's `decideCommand` only classifies a command string; nothing calls it before running anything, because nothing runs anything yet).
- A real coding-model adapter for autonomous repair generation (out of scope for all of M36 per the build spec's own framing — "inspired by," not built on, an external agent invocation in this milestone; no such adapter exists or is planned in WU36-02 through WU36-05's own scope either).
- A real self-review evaluator consuming `AutonomousEvidencePacketSchema` (WU36-04 scope).
- Runlog builder functions for `AUTONOMOUS_RUN_EVENT_TYPES` (reserved type strings only, Sec 5.7 below; no `buildAutonomousRunXEvent()` exists yet).
- Any CLI command surface (`aiqt autonomous ...` or similar) — confirmed absent by this Work Unit's own architecture guard (Sec 6).

### 2.3 Architecture ownership map (build spec "Required architecture decision")

| Concern | Authoritative module (future) | Rationale |
| --- | --- | --- |
| Run orchestration | A new `src/services/autonomous-run-service.ts` (not yet created) | Matches the existing `*-service.ts` convention for stateful multi-step orchestration (`execution-session-service.ts`, `checkpoint-service.ts`) |
| Safety classification | `src/workflow/autonomous-run-safety-classifier.ts` (this Work Unit) | Pure decision logic belongs in `src/workflow/`, matching `evidence-gate-simulation-engine.ts`'s "pure, read-only" convention |
| Budget enforcement | `src/workflow/autonomous-run-budget.ts` (this Work Unit) | Same rationale — pure, no side effect |
| Command policy | `src/workflow/autonomous-run-command-policy.ts` (this Work Unit) for classification; a future `src/workspaces/autonomous-command-runner.ts` for actual execution, following `git-command-runner.ts`'s no-generic-passthrough pattern | Classification (pure) and execution (impure, process-spawning) are deliberately different modules in different layers, matching this repository's existing pure/impure separation (`workspace-path-policy.ts` vs. `workspace-service.ts`) |
| Workspace isolation | `src/workspaces/workspace-service.ts`/`git-command-runner.ts` (existing, M25) | Already the sole real worktree-creation path; a future Work Unit should call it, not duplicate it |
| Validation | `package.json#scripts.validate` / `src/tooling/version-check.ts` (existing) | Already the sole authoritative validation entry point |
| Review | A new `src/workflow/autonomous-run-self-review.ts` (not yet created, WU36-04 scope) | Mirrors `evidence-gate-simulation-engine.ts`'s pure-evaluator shape |
| Evidence binding | `src/schema/autonomous-run.schema.ts`'s `AutonomousEvidencePacketSchema` (this Work Unit) for the shape; a future evidence-binding function for construction | Schema now, builder later — matches how `evidence.schema.ts` predates `evidence-service.ts`'s construction logic |
| Final result construction | A future `buildAutonomousRunResult()` in `src/core/output/result.ts` or a sibling module | Must reuse `CommandResult`'s shape per the build spec's own WU36-04 requirement ("packet follows the M33 machine contract") rather than inventing a parallel one |

Recorded in `docs/engineering/repository-owner-map.json` as new `autonomousRunContract` and `autonomousRunOrchestration` entries (Sec 7 below).

## 3. Threat Model

For each threat: precondition, impact, prevention, detection, recovery, residual risk, test strategy.

### 3.1 Default-branch mutation

- **Precondition:** a run's worktree is created from or later merges into the repository's default branch instead of an isolated branch.
- **Impact:** unreviewed autonomous changes land directly on the branch humans trust as canonical.
- **Prevention:** `git worktree add -b <run-branch>` always creates a *new* branch (build spec Sec 6.2); `AutonomousWorkspaceRecordSchema.branch` is a required field distinct from `baseRef`; a future Work Unit's real runner must reject any candidate whose branch policy would target the default branch directly (`gitCurrentBranch`/`isValidAiqtBranchShape`, both already existing at M25, are the enforcement primitives).
- **Detection:** `AutonomousWorkspaceRecordSchema.branch !== candidate.baseRef` is a structurally checkable invariant a future Work Unit's evidence-validation step can assert.
- **Recovery:** if detected pre-merge, discard the branch; the default branch was never touched, so no recovery action on it is needed.
- **Residual risk:** none from this Work Unit (no execution exists yet); a future Work Unit must add the explicit runtime check, not merely rely on convention.
- **Test strategy:** (future) an integration test creating a candidate whose derived branch collides with the default branch name must be rejected at classification, not merely at worktree-creation time.

### 3.2 Destructive Git commands

- **Precondition:** an autonomous run issues `git reset --hard`, `git clean -f`, `git branch -D`, or similar.
- **Impact:** irreversible loss of local work (the run's own or, if misdirected, the host repository's).
- **Prevention:** `classifyCommand` (this Work Unit) classifies all of these as `destructive`; `ALWAYS_DENIED_COMMAND_CLASSES` makes `destructive` unblockable by any policy configuration (`decideCommand`, tested in `tests/unit/autonomous-run-command-policy.test.ts`).
- **Detection:** `decideCommand`'s returned `reason` string names the exact denial; a future runlog integration would emit `autonomous_run.command_denied`.
- **Recovery:** command never executes; no recovery needed.
- **Residual risk:** `classifyCommand`'s regex-based detection is not exhaustive (a sufficiently obfuscated or unusual destructive command could misclassify) — mitigated in a future Work Unit by pairing this classification layer with `git-command-runner.ts`'s own allowlist-only execution layer (defense in depth: even a misclassified command still cannot reach an arbitrary `git` invocation, only the fixed allowlisted set).
- **Test strategy:** `tests/unit/autonomous-run-command-policy.test.ts` parametrically covers `rm -rf`, `git push --force`/`-f`, `git reset --hard`, `git clean -f*`, `git branch -D`.

### 3.3 Force-push

- **Precondition:** an autonomous run pushes with `--force`/`-f` to any remote.
- **Impact:** overwrites remote history, potentially destroying others' work or bypassing branch-protection review.
- **Prevention:** `classifyCommand` matches `git push .* --force` and `git push .* -f` as `destructive` before the generic `network`/`git_operation` patterns can claim it (tested explicitly: "a destructive-looking git push takes precedence over the generic git-operation pattern").
- **Detection:** same as 3.2.
- **Recovery:** command never executes.
- **Residual risk:** same regex-completeness caveat as 3.2; also, this Work Unit's contract does not yet define a push capability at all (no candidate contract field or execution-policy field authorizes push) — push is not merely denied by classification, it has no path to be attempted in the current contract.
- **Test strategy:** covered in `tests/unit/autonomous-run-command-policy.test.ts`.

### 3.4 Secret exposure

- **Precondition:** a run's commands, logs, diff, or evidence packet capture a credential, API key, or other secret.
- **Impact:** credential leakage into evidence storage, runlog, or a human-visible report.
- **Prevention:** `secrets` is a `PROHIBITED_AREA_TAG` (Sec "prohibited area" of the safety schema) — a candidate tagged `secrets` classifies `high_risk_prohibited` and is always blocked before any workspace is prepared; `AUTONOMOUS_RUN_EVENT_TYPES` contains no event type that would carry raw command output (mirrors `git-command-runner.ts`'s own `sanitizeGitOutput`, which bounds and truncates before any error ever surfaces).
- **Detection:** (future) a real evidence-capture step must apply the same bounded/sanitized-output discipline `git-command-runner.ts` already establishes; this Work Unit does not yet capture any real output to detect a leak in.
- **Recovery:** (future) evidence redaction/rotation guidance if a leak is detected post-hoc.
- **Residual risk:** tag-based prohibition only catches secrets the *candidate itself* names as being about secrets — it cannot catch an unrelated repair attempt that incidentally touches a file containing a hardcoded credential. This is an open residual risk explicitly carried to WU36-03/04, where real command output exists to scan.
- **Test strategy:** `tests/unit/autonomous-run-safety-classifier.test.ts`'s prohibited-area tests; a future secret-scanning test suite is out of this Work Unit's scope.

### 3.5 Credential use

- **Precondition:** a run attempts to authenticate to a remote service (Git remote, package registry, cloud API).
- **Impact:** unauthorized or unintended use of stored credentials.
- **Prevention:** `networkPolicy: "denied"` is the assessment default for every risk class (Sec `assessment()` helper); network commands are denied unless a run's policy explicitly sets `networkPolicy: "explicitly_enabled"`, which this Work Unit's contract never sets automatically for any risk class.
- **Detection:** `decideCommand` returns `allowed: false` with reason "network commands require networkPolicy: explicitly_enabled."
- **Recovery:** command never executes.
- **Residual risk:** "explicitly_enabled" is a real escape hatch by design (build spec: "No network access unless explicitly enabled for a task") — a future Work Unit must ensure only a human-approved, scoped exception (mirroring `evidence-gate-exception-create`'s pattern) can ever set it, never a default or an autonomous self-grant.
- **Test strategy:** `tests/unit/autonomous-run-command-policy.test.ts` covers both the denied-by-default and explicitly-enabled paths.

### 3.6 Network exfiltration

- **Precondition:** a run with network access sends repository content to an external endpoint.
- **Impact:** data exfiltration.
- **Prevention:** same as 3.5 (network denied by default); additionally, `curl`/`wget`/`fetch(`/`nc` are all classified `network`, not merely detected by destination.
- **Detection:** command-level denial, not content-level (this Work Unit has no content-inspection capability).
- **Recovery:** command never executes under the default policy.
- **Residual risk:** if network is explicitly enabled for a legitimate task (e.g., fetching a public API spec), this contract has no mechanism to further restrict *destination* (allowlist specific hosts) — recorded as an open gap for a future Work Unit, not solved here.
- **Test strategy:** `tests/unit/autonomous-run-command-policy.test.ts`.

### 3.7 Arbitrary shell execution

- **Precondition:** a run's command runner accepts a raw shell string instead of an argument array.
- **Impact:** shell metacharacters (`;`, `|`, `` ` ``, `$()`) let one command execute another, unbounded.
- **Prevention:** `git-command-runner.ts`'s established `shell: false` convention (M25) is the architectural precedent a future real command runner must follow; this Work Unit's `classifyCommand`/`decideCommand` operate on a full command *string* for classification purposes only (no execution), so this specific threat does not yet apply to any code this Work Unit ships, but the contract's own module-ownership decision (Sec 2.3) explicitly assigns the future real runner to follow the no-shell pattern.
- **Detection:** N/A (no execution exists).
- **Recovery:** N/A.
- **Residual risk:** high until a future Work Unit's real runner is built and itself boundary-scanned for `shell: false` and no generic passthrough, exactly as `tests/unit/execution-adapter-boundary-scan.test.ts` etc. already do for other subsystems.
- **Test strategy:** (future) a boundary scan on the real command runner module, following this Work Unit's own `tests/unit/autonomous-run-boundary-scan.test.ts` pattern.

### 3.8 Command injection

- **Precondition:** a candidate's user-supplied field (objective, constraint, issue id) is interpolated into a command string without sanitization.
- **Impact:** attacker-controlled candidate content executes as a command.
- **Prevention:** `AutonomousCandidateSchema` bounds every string field's length (`MAX_BOUNDED_TEXT_CHARS`/`MAX_BOUNDED_KEY_CHARS`) but does not itself sanitize content — sanitization is the future real runner's job, following `workspace-branch-policy.ts`'s `sanitizeToken` precedent (never interpolate raw, always sanitize into a fixed-alphabet token first).
- **Detection:** N/A in this Work Unit (no interpolation happens yet).
- **Recovery:** N/A.
- **Residual risk:** open until a future Work Unit's real command construction path is built and tested against injection payloads in candidate fields.
- **Test strategy:** (future) fuzz/injection-payload tests against whatever future function turns a candidate + plan into an actual command string.

### 3.9 Path traversal

- **Precondition:** a workspace path, created-file path, or command argument escapes the intended worktree boundary via `../` segments.
- **Impact:** a run reads or writes outside its isolated workspace.
- **Prevention:** `workspace-path-policy.ts`'s `validateWorkspaceRoot`/`isStrictDescendant` (M25, existing) is the established defense; `AutonomousWorkspaceRecordSchema.worktreePath` is a required field a future Work Unit's evidence-validation step must check against the same strict-descendant logic before trusting any file path recorded under it.
- **Detection:** `isStrictDescendant` returns false for a path outside the expected parent.
- **Recovery:** reject the workspace/path before any command runs against it.
- **Residual risk:** none new from this Work Unit (no path is ever constructed or trusted yet); the existing M25 primitive is proven in production for the workspace domain and must be reused, not reimplemented, by a future Work Unit.
- **Test strategy:** existing `tests/unit/workspace-path-policy.test.ts` (M25) already covers this for the workspace domain; a future Work Unit should add an equivalent test scoped to autonomous-run file paths specifically if any new path-construction logic is added.

### 3.10 Symlink escape

- **Precondition:** a workspace root or an ancestor path segment is (or becomes) a symlink pointing outside the intended tree.
- **Impact:** writes intended for the isolated workspace land elsewhere.
- **Prevention:** `workspace-path-policy.ts`'s `validateWorkspaceRoot` explicitly uses `lstatSync` (not `existsSync`/`statSync`) specifically so a broken symlink is still detected, and walks every ancestor path segment for a symlink, not just the leaf (M25, existing, already proven).
- **Detection:** `lstatSync(...).isSymbolicLink()` check.
- **Recovery:** reject the workspace root before creation.
- **Residual risk:** none new; existing M25 mechanism, must be reused verbatim by a future Work Unit's real workspace-creation call, not reimplemented.
- **Test strategy:** existing `tests/unit/workspace-path-policy.test.ts`.

### 3.11 Worktree escape

- **Precondition:** a run's process operates on a path outside the worktree it was granted (e.g., an absolute path argument to a command).
- **Impact:** a run reads/writes/executes against the host repository or another worktree instead of its own.
- **Prevention:** `AutonomousExecutionPolicy.filesystemBoundary` (this Work Unit's contract) is a required field intended for a future real runner to enforce per-command (reject any argument resolving outside the boundary) — not yet enforced by any code in this Work Unit, since no execution exists.
- **Detection:** (future) a real runner must resolve every file-path-shaped argument and check it against `filesystemBoundary` before executing.
- **Recovery:** (future) command denied before execution.
- **Residual risk:** high until a future Work Unit implements the actual per-command boundary check; the contract field exists specifically so that Work Unit has a place to read the boundary from, but defining the field is not the same as enforcing it.
- **Test strategy:** (future) tests constructing a command with an out-of-boundary path argument and asserting denial.

### 3.12 Dependency-chain compromise

- **Precondition:** an autonomous run modifies `package.json`/lockfiles to pull in a new or altered dependency.
- **Impact:** a supply-chain attack vector introduced without human review.
- **Prevention:** `dependency_chain_upgrade` and `generated_lockfile_rewrite` are both explicit `PROHIBITED_AREA_TAGS` — a candidate touching either classifies `high_risk_prohibited` unconditionally.
- **Detection:** `classifyCandidate`'s prohibited-area check.
- **Recovery:** candidate blocked before any workspace is prepared.
- **Residual risk:** tag-based — relies on the candidate-intake step (a future Work Unit) correctly tagging a dependency-touching issue; a future Work Unit should also add a structural check (does the candidate's declared scope include `package.json`/`pnpm-lock.yaml`) rather than relying on tagging alone.
- **Test strategy:** `tests/unit/autonomous-run-safety-classifier.test.ts`'s prohibited-area tests (parametrized, would need a new case added for these two specific tags in a future Work Unit's structural-detection layer).

### 3.13 Validation bypass

- **Precondition:** a run reports success without authoritative validation actually passing.
- **Impact:** a broken repair is recommended for merge.
- **Prevention:** `AutonomousResultStateSchema`'s `"passed"` state pairs, via `RESULT_STATE_TERMINAL_STATUS`, with exactly the `"completed"` terminal status, which per the lifecycle table (Sec 4) is only reachable from `"reviewing"`, which is only reachable from `"validating"` — there is no transition path from `"executing"` directly to `"completed"` that skips validation.
- **Detection:** `isValidRunStatusTransition`/`isValidTerminalPairing` (this Work Unit) structurally reject any attempt to construct a `"passed"` result without having passed through `"validating"`.
- **Recovery:** N/A — the invalid state is unrepresentable, not merely detected after the fact.
- **Residual risk:** this only proves the *lifecycle shape* forces validation to occur; it does not yet prove a future Work Unit's real `"validating"` status handler actually calls `pnpm validate`/targeted tests rather than trivially transitioning through. That enforcement is WU36-04 scope.
- **Test strategy:** `tests/unit/autonomous-run-lifecycle.test.ts`'s transition and terminal-pairing tests.

### 3.14 Evidence forgery

- **Precondition:** an evidence packet reports commands, files, or validation results that did not actually occur.
- **Impact:** a human reviewer trusts a fabricated evidence trail.
- **Prevention:** `AutonomousEvidencePacketSchema` is `.strict()` (rejects unknown fields) and requires `residualRisk` on every packet (tested: "rejects a packet missing residualRisk"); a future Work Unit must bind every field to a real captured value (e.g., `commandsExecuted` populated only by the actual command runner, never hand-constructed).
- **Detection:** (future) cross-checking evidence against the real runlog events emitted during the run (`AUTONOMOUS_RUN_EVENT_TYPES`) — an evidence packet claiming a command that has no matching `autonomous_run.command_allowed` event is detectably inconsistent.
- **Recovery:** (future) discard the packet, mark the run `failed`.
- **Residual risk:** high until a future Work Unit implements the actual cross-check; this Work Unit only defines the two data shapes (packet, event types) that make the cross-check possible later.
- **Test strategy:** `tests/unit/autonomous-run-contract-schema.test.ts`'s completeness tests; a future Work Unit should add a packet-vs-runlog consistency test once both are real.

### 3.15 Budget overrun

- **Precondition:** a run exceeds its declared wall-clock, command-count, retry, changed-file, diff-size, validation-duration, or token budget.
- **Impact:** unbounded resource consumption; a runaway process.
- **Prevention:** `checkBudget` (this Work Unit) checks every dimension independently; exceeding any single one exhausts the budget (an AND-of-limits, not an average) — tested for each of the 7 dimensions individually and in combination.
- **Detection:** `checkBudget`'s `exceededDimensions` array names exactly which limit(s) were exceeded.
- **Recovery:** the lifecycle table makes `budget_exhausted` reachable from both `"executing"` and `"validating"` — a future Work Unit's real loop must check `checkBudget` after every command/iteration and transition immediately on exhaustion, preserving whatever evidence exists so far (build spec: "Budget exhaustion must stop the run and preserve evidence").
- **Residual risk:** this Work Unit's budgets are static per-run values; a future Work Unit may need dynamic/adaptive budgeting for real workloads, which is explicitly out of this Work Unit's scope.
- **Test strategy:** `tests/unit/autonomous-run-budget.test.ts` (13 tests, every dimension individually and combined, plus the inclusive-ceiling boundary case).

### 3.16 Infinite retry

- **Precondition:** a run retries a failing step without limit.
- **Impact:** budget/time exhaustion masked as "still working"; resource starvation.
- **Prevention:** `maxRetryCount` is a dedicated budget dimension (distinct from `maxCommandCount`, since retries of the same logical step are a different failure mode than simply issuing many different commands); `checkBudget` treats it identically to every other dimension.
- **Detection:** `checkBudget`'s `retryCount` check.
- **Recovery:** `budget_exhausted` transition, same as 3.15.
- **Residual risk:** this Work Unit does not define what constitutes "a retry" operationally (same command twice? same objective attempted twice?) — that operational definition is deferred to whichever future Work Unit implements the real execution loop.
- **Test strategy:** `tests/unit/autonomous-run-budget.test.ts`'s retryCount-specific test.

### 3.17 Stale base commit

- **Precondition:** a run's worktree is created from a base ref/commit that has since moved (someone pushed to the default branch after the run started).
- **Impact:** the run's eventual patch may not apply cleanly, or may silently omit intervening changes.
- **Prevention:** `AutonomousCandidateSchema.baseRef` and `AutonomousWorkspaceRecordSchema.baseCommit` are both required, distinct fields (ref name vs. resolved commit) — a future Work Unit's real preflight step must resolve and record the commit at classification time, then re-verify it has not moved immediately before workspace creation (mirroring `execution-session.schema.ts`'s `ExecutionCommitRefSchema` pattern of recording metadata "never proves Git existence, never executed" alongside a live check).
- **Detection:** (future) comparing the recorded `baseCommit` against a fresh `gitRevParse` of the same ref immediately before use.
- **Recovery:** (future) re-classify against the new base rather than proceeding on stale data.
- **Residual risk:** this Work Unit defines the fields needed to detect staleness but does not implement the re-verification check itself (no execution exists to place it in yet).
- **Test strategy:** (future) an integration test simulating a base-ref move between classification and workspace preparation.

### 3.18 Concurrent-run collision

- **Precondition:** two autonomous runs target the same repository/base ref simultaneously.
- **Impact:** conflicting worktrees, branch-name collisions, or corrupted shared state.
- **Prevention:** build spec Sec 3 mandates "one issue per run" and "one worktree per run"; `workspace-operation-lock.ts` (M25, existing) already provides a real per-`.aiqt`-directory operation lock a future Work Unit should reuse for the analogous per-repository autonomous-run lock, rather than reimplementing locking.
- **Detection:** lock-acquisition failure (existing `acquireWorkspaceOperationLock` pattern).
- **Recovery:** the second run is rejected/queued, not silently allowed to collide.
- **Residual risk:** this Work Unit does not itself acquire any lock (no execution exists); a future Work Unit must wire this in before WU36-03 enables real concurrent-capable execution.
- **Test strategy:** existing `tests/unit/workspace-operation-lock.test.ts` (M25) covers the lock primitive; a future Work Unit should add an autonomous-run-specific collision test once real orchestration exists.

### 3.19 Cleanup failure

- **Precondition:** worktree removal or temporary-file cleanup fails after a run completes or is cancelled.
- **Impact:** orphaned worktrees/branches accumulate; disk exhaustion; stale state confusing a later run.
- **Prevention:** `AutonomousWorkspaceRecordSchema.cleanupStatus` is a required tri-state field (`pending/cleaned/cleanup_failed`) — cleanup outcome is always explicitly recorded, never implied by silence; `workspace-recovery.ts` (M25, existing) already provides real recovery planning for exactly this class of interrupted-operation problem.
- **Detection:** `cleanupStatus: "cleanup_failed"` is a representable, checkable state, not an exception a caller might swallow.
- **Recovery:** a future Work Unit should route a `cleanup_failed` workspace through `workspace-recovery.ts`'s existing `planReleaseRecovery`, not a new bespoke path.
- **Residual risk:** this Work Unit defines the field but no code sets it yet (no cleanup occurs, since no workspace is ever created).
- **Test strategy:** `tests/unit/autonomous-run-contract-schema.test.ts` confirms the field's enum shape; a future Work Unit should add a real cleanup-failure-and-recovery integration test.

### 3.20 Hidden generated-file changes

- **Precondition:** a repair attempt silently changes a generated file (lockfile, build output, snapshot) beyond what the candidate's declared scope covers.
- **Impact:** unexpected, unreviewed changes ship inside what looks like a narrow, reviewed diff.
- **Prevention:** build spec Sec 6.6: "no unexpected files change" is a hard validation requirement; `AutonomousDiffSummarySchema.unexpectedFiles` is a dedicated field (not merely folded into `changedFiles`) so a future Work Unit's validation step can specifically flag and block on it rather than only checking a total count.
- **Detection:** (future) diffing the actual changed-file set against the candidate's declared scope.
- **Recovery:** (future) `validation_failed` result state, per the build spec's own listed result states.
- **Residual risk:** this Work Unit defines the field but not the detection logic (no diff is ever produced yet).
- **Test strategy:** (future) an integration test with a repair that touches an out-of-scope generated file, asserting `validation_failed`.

### 3.21 Autonomous self-modification of AIQT

- **Precondition:** an autonomous run's target repository is the AIQT repository itself, or a future orchestrator invokes `aiqt` commands against AIQT's own working tree.
- **Impact:** AIQT governs its own development autonomously — explicitly out of scope for all of M36 (build spec Sec 5: "self-modification of the AIQT repository"; Sec 1 entry gate: "No product `.aiqt/` self-management state exists in the AIQT repository").
- **Prevention:** this Work Unit's own operating constraint ("Do not use AIQT to govern its own implementation") is enforced structurally, not just by instruction: `tests/unit/autonomous-run-boundary-scan.test.ts` confirms none of the 5 files this Work Unit added import any `src/cli/commands/*` module or any `src/workspaces/*` module — there is no code path by which this Work Unit's contract could invoke AIQT against any repository, AIQT's own or otherwise.
- **Detection:** the boundary-scan test itself, re-run on every future commit.
- **Recovery:** N/A — no capability exists to trigger this in the first place.
- **Residual risk:** a *future* Work Unit (WU36-02 onward) that does wire up real execution must re-verify this constraint holds for whatever repository the runner is pointed at — WU36-05's own explicit scope item is "AIQT repository never self-managed by the runner," proven via a real dogfood run against a separate, non-AIQT repository.
- **Test strategy:** `tests/unit/autonomous-run-boundary-scan.test.ts` (11 tests: forbidden-surface scan across all 5 new files, no new runtime dependency, no CLI/options "autonomous" reference, no command-file "autonomous" reference, no CLI-command-module import, no workspace-module import, `.aiqt/` absence).

## 4. Run Lifecycle

```text
created
  -> preflight
  -> classified
       -> awaiting_approval -> preparing_workspace   (medium-risk path)
       -> preparing_workspace                         (low-risk path, skips approval)
       -> blocked | failed                            (prohibited/unsupported path)
  -> preparing_workspace
  -> executing
  -> validating
  -> reviewing
  -> completed | blocked | failed | cancelled | budget_exhausted
```

Full allowed-transition table: `src/workflow/autonomous-run-lifecycle.ts`'s `ALLOWED_TRANSITIONS` (also queryable via the exported `allowedNextStatuses`). Key rules:

- No self-transition is ever valid.
- `cancelled` and `budget_exhausted` are reachable from every non-terminal status (an operator or the budget checker can interrupt at any point).
- `budget_exhausted` is specifically only reachable from `executing`/`validating` (the two statuses where real resource consumption occurs) in the *minimal* table, but the general cancellation reachability above also covers it from earlier statuses via the shared "interruptible at any stage" rule.
- No status ever transitions back to `created`.
- Terminal statuses (`completed`, `blocked`, `failed`, `cancelled`, `budget_exhausted`) accept no further transition.

**Invalid transitions (examples, all rejected by `isValidRunStatusTransition`):** `created → executing` (skips preflight/classification/workspace preparation entirely); `validating → preparing_workspace` (backwards); any `X → X` self-transition; any `X → created`.

## 5. Contracts

All defined in `src/schema/autonomous-run.schema.ts` (Zod, `.strict()` throughout — no undeclared field is ever silently accepted).

### 5.1 Candidate contract

`AutonomousCandidateSchema`: `issueId`, `source` (`issue|review_finding|manual|operator`), `repository`, `baseRef`, `objective`, `acceptanceCriteria[]`, `constraints[]` (default `[]`), `requestedPermissions[]` (default `[]`).

### 5.2 Safety assessment

`AutonomousSafetyAssessmentSchema`: `riskClass` (7 values, Sec 5.3), `prohibitedAreas[]` (10 tags, Sec 5.3), `requiredApprovals[]`, `commandPolicyProfile`, `networkPolicy` (`denied|explicitly_enabled`), `reason`.

### 5.3 Risk classes and prohibited areas

Risk classes (`AutonomousRiskClassSchema`): `low_risk_autonomous`, `medium_risk_requires_approval`, `high_risk_prohibited`, `insufficient_context`, `validation_unavailable`, `repository_dirty`, `unsupported_operation`. `RISK_CLASSES_ALWAYS_BLOCKED` = the last 5; `RISK_CLASSES_REQUIRING_APPROVAL` = `{medium_risk_requires_approval}`; only `low_risk_autonomous` may proceed without any gate.

Prohibited area tags (`PROHIBITED_AREA_TAGS`): `authentication`, `authorization`, `cryptography`, `secrets`, `billing`, `destructive_migration`, `production_infrastructure`, `branch_protection`, `dependency_chain_upgrade`, `generated_lockfile_rewrite` — verbatim from build spec Sec 6.3.

### 5.4 Budget

`AutonomousBudgetsSchema`: `maxWallClockSeconds`, `maxCommandCount`, `maxRetryCount`, `maxChangedFiles`, `maxDiffLines`, `maxValidationSeconds`, `maxModelTokenSpend` (optional). `AutonomousBudgetUsageSchema` mirrors it for live usage tracking. `checkBudget()` returns `{exhausted, exceededDimensions[]}`; `isApproachingBudget()` returns dimensions at ≥80% of their limit.

### 5.5 Command / execution policy

`CommandClassSchema` (7 classes, build spec Sec 6.5 verbatim): `read_only_inspection`, `repository_local_write`, `git_operation`, `test_or_build`, `network`, `destructive`, `privileged`. `DEFAULT_ALLOWED_COMMAND_CLASSES` = the first 4; `ALWAYS_DENIED_COMMAND_CLASSES` = `{destructive, privileged}` (no policy override path exists for these two). `AutonomousExecutionPolicySchema` carries `allowedCommandClasses[]`, `blockedCommandClasses[]`, `networkPolicy`, `filesystemBoundary`, `gitBoundary.allowedBaseRefPrefixes[]`. `classifyCommand(commandLine)` and `decideCommand(commandLine, policy)` are the two pure functions (Sec 3.7/3.8 above cover why classification is not yet execution-time enforcement).

### 5.6 Result state

`AutonomousResultStateSchema` (8 states, build spec verbatim): `passed`, `failed`, `blocked`, `needs_input`, `cancelled`, `budget_exhausted`, `validation_failed`, `review_rejected`. `RESULT_STATE_TERMINAL_STATUS` fixes exactly one terminal `AutonomousRunStatus` per result state (Sec 3.13's validation-bypass prevention depends on this mapping).

### 5.7 Evidence packet

`AutonomousEvidencePacketSchema`: `runId`, `candidate`, `safetyAssessment`, `workspace` (optional — absent for a run blocked before workspace preparation), `commandsExecuted[]`, `filesChanged[]`, `diffSummary` (optional), `validation` (optional: `targetedTestsPassed`, `authoritativeValidationPassed`, `durationSeconds`), `findings[]`, `residualRisk` (required on every packet, including blocked/failed ones), `resultState`, `recommendedHumanAction` (5 values, build spec Sec 6.8 verbatim: `review_and_merge`, `request_changes`, `discard`, `provide_missing_input`, `rerun_with_modified_budget`).

### 5.8 Audit events

`AUTONOMOUS_RUN_EVENT_TYPES` (22 reserved type strings, `autonomous_run.` prefix): one per lifecycle transition family (`created`, `preflight_completed`, `classified`, `approval_requested/granted/denied`, `workspace_prepared`, `execution_started`, `command_allowed/denied`, `budget_warning/exhausted`, `validation_started/completed`, `review_started/completed`, `completed`, `blocked`, `failed`, `cancelled`, `cleanup_completed/failed`) plus the two cross-cutting policy-decision events (`command_allowed`/`command_denied`) that recur many times within a single `executing` status rather than marking a status transition themselves. No `buildAutonomousRunXEvent()` function exists yet — these are reserved strings for a future Work Unit's builders to use verbatim, matching `runlog-store.ts`'s existing `build*Event()` naming convention.

## 6. Architecture Guard (build spec: "no execution path can modify a repository autonomously yet"; "architecture tests prevent accidental enablement")

`tests/unit/autonomous-run-boundary-scan.test.ts` (11 tests) proves, on every suite run:

- none of the 5 files this Work Unit added contain `child_process`, any process-spawn function, `node:net`/`http`/`https`/`tls`/`dgram`/`dns`, `node-pty`, `fetch(`, `WebSocket`, an Anthropic/Claude SDK reference, `eval(`, `new Function(`, `node:vm` execution, dynamic `import(`, `require(`, real worktree creation/removal, or real workspace-lifecycle orchestration;
- `package.json#dependencies` gained no new runtime dependency;
- no CLI command file, `register-commands.ts`, or `options.ts` references "autonomous" or "maintenance runner" — there is no command surface to invoke a run yet;
- none of the 5 new files import any `src/cli/commands/*` module (no CLI dispatch capability) or any `src/workspaces/*` module (no workspace/worktree creation capability);
- the AIQT repository has no `.aiqt/` directory.

This is the concrete mechanism closing threat 3.21 (autonomous self-modification of AIQT) and satisfying the build spec's explicit WU36-01 acceptance criteria.

## 7. Repository Owner Map Update

Two new entries added to `docs/engineering/repository-owner-map.json` (Sec 2.3's ownership table, materialized): `autonomousRunContract` (this Work Unit's schema/decision modules) and a forward-pointer note that orchestration/execution ownership remains unassigned pending WU36-02 onward, so a future Gate audit does not mistake "the contract exists" for "the capability exists."

## 8. Explicit Non-Enablement Statement

As of WU36-01: no CLI command can trigger an autonomous run; no code path creates a worktree for autonomous execution; no code path invokes a coding model; no code path executes an arbitrary or classified-as-allowed command against any real repository; no runlog event of any `autonomous_run.*` type has ever been written by any code in this repository.

## 9. WU36-02 addendum — real (read-only) preflight and candidate intake

WU36-02 (Candidate Intake and Safety Classifier, build spec Sec 7) implements the "candidate intake; issue normalization; repository preflight; dirty-tree detection; base-ref verification; ... dry-run classification output" scope items on top of WU36-01's contract.

### 9.1 What changed from WU36-01's posture

WU36-01 deliberately imported nothing from `src/workspaces/` — no code existed that could inspect a real repository at all. WU36-02 adds exactly one file that does: `src/workflow/autonomous-run-preflight.ts`. This is a **reviewed, intentional, narrow exception**, not a relaxation of WU36-01's posture: `runRepositoryPreflight()` calls exactly 4 already-allowlisted, already-read-only Git functions (`gitIsInsideWorkTree`, `gitStatusPorcelain`, `gitDiffQuietIsClean`, `gitRevParse`) and nothing else — no worktree function, no workspace-service function, no write of any kind. `tests/unit/autonomous-run-boundary-scan.test.ts`'s new WU36-02 section (extending Sec 6's mechanism) proves this by import-allowlist, not by convention: the test parses the file's actual import statement and fails if any git-command-runner export beyond the 4 allowed ones ever appears.

### 9.2 Candidate intake and one-issue-per-run

`src/services/autonomous-candidate-intake-service.ts`'s `intakeCandidate()` is the single entry point: it validates a raw payload against `AutonomousCandidateSchema` (failing closed to `invalid_candidate_shape` on any parse error), runs real preflight against the caller-supplied repository path, and calls WU36-01's `classifyCandidate()` with the results. "One issue per run" is enforced by the function's own signature — it accepts one `IntakeCandidateInput` (one `rawCandidate`), never an array; `tests/integration/autonomous-candidate-intake-service.test.ts` asserts `intakeCandidate.length === 1` as a structural, not merely documentary, guarantee.

### 9.3 Dry-run classification output

`buildDryRunClassificationReport()` turns an intake result into a stable, JSON-serializable summary (`issueId`, `riskClass`, `canProceedWithoutApproval`, `requiresApproval`, `alwaysBlocked`, `reason`) — deliberately without a "proceed" action of any kind. No CLI command exposes this yet (re-verified by the boundary scan's repeated no-CLI-reference check); it exists as a directly-testable function result for this Work Unit's own tests and for a future Work Unit's eventual CLI/orchestration wiring to consume.

### 9.4 Real disposable-repository test coverage

`tests/integration/autonomous-run-preflight.test.ts` and `tests/integration/autonomous-candidate-intake-service.test.ts` exercise the above against a real, disposable Git repository (the M25/M35-WU03 `initGitFixtureRepo` pattern) — not mocks. Coverage includes: clean vs. dirty (untracked file, then modified tracked file) repositories; a resolvable named-branch ref vs. an unresolvable one; a non-Git directory (fails closed: `isGitRepository: false`, `repositoryDirty: true`, `baseRefResolvable: false`); and an explicit non-mutation check (5 consecutive preflight calls leave `HEAD` and `git status` unchanged).

One classifier fix was required to support this: `src/tooling/test-inventory-classifier.ts`'s `hasGitSpawn()` (and the identical local copy in `tests/unit/m34-validation-workload-inventory.test.ts`) previously matched only a direct `execFileSync("git", ...)` literal in a test file's own text. `autonomous-candidate-intake-service.test.ts` spawns git only transitively (through `initGitFixtureRepo`, never a literal `execFileSync("git", ...)` in its own body), so both detectors were extended to also recognize `initGitFixtureRepo(` as a git-spawn signal — otherwise this file would have been silently misclassified as non-spawning despite genuinely running real subprocesses, and the M34 drift-detector guard (which independently re-scans and compares against a reviewed baseline) would have failed on the mismatch. `KNOWN_SPAWNING_FILES` in `tests/unit/m34-validation-workload-inventory.test.ts` was updated accordingly (33 → 35 files, plus the WU34-03 built-binary-smoke file, 36 total).

### 9.5 Still not enabled

No worktree is created. No branch is created. No command beyond the 4 read-only Git functions executes. No CLI command exists to invoke any of this. WU36-03 (Isolated Bounded Execution) remains the Work Unit where real worktree creation and bounded command execution are introduced, gated on WU36-02's own closure.
