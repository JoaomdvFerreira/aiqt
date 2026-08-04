# M36 Closure Report — Autonomous Maintenance Runner and Safety Controls

## Entry-gate evidence (verified before WU36-01 began)

- M35 closure report present and complete (`docs/engineering/m35-closure-report.md`).
- M35 closure tag present: `m35-wu04-ci-acceleration-and-closure`.
- Node 24 CI green (Node 22 removed in M35-WU04).
- Critical coverage preserved through M35's test rationalization (`docs/engineering/m35-test-rationalization-policy.md`).
- CI runtime/rationalization evidence documented (M35 closure report: 3 real CI runs, 284.0s/256.0s/303.0s, avg 281.0s).
- Clean working tree, no `.aiqt/` directory present.

## Starting / ending commit and version range

| | Commit | Package version | Schema version |
|---|---|---|---|
| Start (M35 close) | `441d332` | 0.20.0 | 0.5.0 (unchanged throughout M36) |
| End (M36 close, WU36-05) | (this Work Unit's own commit, tagged `m36-wu05-autonomous-runner-dogfood` / `m36-autonomous-maintenance-runner`) | 0.24.0 | 0.5.0 |

M36 never touched `AIQT_SCHEMA_VERSION` (`src/core/constants/schema-version.ts`) — nothing in this milestone persists to AIQT's own canonical `.aiqt/state.json`/`runlog.jsonl` shape; the autonomous-run contract (`src/schema/autonomous-run.schema.ts`) is a wholly separate, never-persisted schema family. The package version stayed at `0.24.0` (set by WU36-04) through WU36-05's close: WU36-05 added only `tests/` and `docs/` files, touching no path this repository's version-governance rule (`src/tooling/relevant-paths.ts`) treats as relevant (`src/`, `.github/workflows/`, and a small fixed list of root files) — verified via `version-check-cli.ts`, which reported `relevantChangesDetected: false` for this Work Unit's diff, so no bump was required or made.

## Work Unit table

| Work Unit | Tag | Risk score | Summary |
|---|---|---|---|
| WU36-01 | `m36-wu01-autonomous-run-contract` | (see commit; contract/threat-model only, no execution surface) | Run lifecycle, 21-threat threat model, candidate/safety-assessment/budget/execution-policy/result-state/evidence-packet/audit-event contracts. Pure data shapes and decision functions only — `classifyCandidate`, `checkBudget`, `classifyCommand`/`decideCommand`, lifecycle transition validation. No process spawn, no network, no model invocation, no worktree creation. |
| WU36-02 | `m36-wu02-candidate-safety-classifier` | (real but read-only: repository preflight + candidate intake) | `runRepositoryPreflight()` (real, read-only Git inspection: `gitIsInsideWorkTree`, `gitStatusPorcelain`, `gitDiffQuietIsClean`, `gitRevParse`) and `intakeCandidate()` (schema validation + preflight + classification, one-issue-per-run). Still no mutation, no CLI surface. |
| WU36-03 | `m36-wu03-isolated-bounded-execution` | 65/100 | First real, mutating execution surface: `autonomous-worktree-lifecycle.ts` (the sole caller of `gitWorktreeAdd`/`gitWorktreeRemove`), `autonomous-command-runner.ts` (the one real `execFileSync` call site — structured args only, `shell: false`, mandatory pre-execution policy+boundary check), `autonomous-run-branch-policy.ts` (a parallel `autonomous/`-prefixed scheme), `autonomous-run-agent-adapter.ts` (data-only, `DeterministicStubAgentAdapter` is the only implementation), `autonomous-run-execution-service.ts` (the bounded orchestration loop). Corrected an architecture-ownership decision from WU36-01 (workspace isolation built directly on `git-command-runner.ts`, not `workspace-service.ts`'s StateModel-coupled functions). Two real bugs found and fixed by this Work Unit's own tests before commit (evidence-trail contamination on denial; a budget off-by-one). |
| WU36-04 | `m36-wu04-validation-review-evidence` | 55/100 | Diff capture (`autonomous-run-diff-summary.ts`, including a real rename-parsing bug fix), targeted+authoritative validation (`autonomous-run-validation-service.ts`, structurally enforcing "no pass without validation"), pure self-review (`autonomous-run-self-review.ts`), and the evidence-binding service (`autonomous-run-evidence-binding-service.ts`) that decides `resultState`/`recommendedHumanAction` and produces the final `AutonomousEvidencePacket`. Required a behavior-preserving refactor of WU36-03's `executeAutonomousRun` to separate the command loop from cleanup. An M33-contract-compatible `CommandResult` wrapper (`autonomous-run-command-result.ts`) was added but not wired to any CLI command. A real command-classification gap (`git mv`/`git rm` falling through to denied-by-default) was found and fixed. |
| WU36-05 | `m36-wu05-autonomous-runner-dogfood` / `m36-autonomous-maintenance-runner` | 40/100 | Dogfood pilot (5 required scenarios run end-to-end against a real disposable, non-AIQT target repository, full evidence committed), operator workflow documentation, this closure report. No new execution surface — reuses the already-reviewed WU36-01..04 pipeline exactly as built. Lower risk than prior Work Units because it adds no new mutating capability, only exercises and documents what already exists. |

## Threat model recap

21 named threats, each with precondition/impact/prevention/detection/recovery/residual-risk/test-strategy, recorded in `docs/engineering/m36-autonomous-run-contract.md` Sec 3. Representative closures verified by this milestone's real tests (not just documented intent):

- **Sec 3.1 Default-branch mutation** — every WU36-03/04/05 integration test that runs a full execution asserts the source repository's branch and `HEAD` are byte-identical before/after.
- **Sec 3.7/3.8 Arbitrary shell execution / command injection** — `autonomous-command-runner.ts` never builds a shell string; `execFileSync` always receives the caller's own `{command, args[]}` array, verified structurally by the boundary scan.
- **Sec 3.9/3.10 Path traversal / symlink escape** — reused `workspace-path-policy.ts` (M25) verbatim, not reimplemented.
- **Sec 3.11 Worktree escape** — `autonomous-command-runner.ts`'s filesystem-boundary check, tested with a command pointed outside the policy boundary.
- **Sec 3.15/3.16 Budget overrun / infinite retry** — `checkBudget`'s inclusive-ceiling semantics, exercised end-to-end by the WU36-03/05 budget-exhaustion scenarios (a real off-by-one was caught and fixed here).
- **Sec 3.19 Cleanup failure** — every scenario's `workspace.cleanupStatus` is checked; cleanup is attempted exactly once, unconditionally, in every outcome including denial/cancellation/budget-exhaustion.
- **Sec 3.20 Hidden generated-file changes** — `autonomous-run-diff-summary.ts`'s `unexpectedFiles` detection, including the rename-disguise case (`git mv` into a lockfile name), closed by a real parsing fix this milestone found via its own tests.
- **Sec 3.21 Autonomous self-modification of AIQT** — closed structurally (no CLI command surface exists to invoke any of this against any repository, let alone AIQT's own) and behaviorally (the WU36-05 dogfood pilot's target is always a disposable directory distinct from AIQT's own working tree, and every Work Unit's boundary scan re-verifies `.aiqt/` never appears in this repository as a result).

## Safety decision table (risk class → outcome)

| `riskClass` | Can proceed autonomously? | Requires approval? |
|---|---|---|
| `low_risk_autonomous` | Yes | No |
| `medium_risk_requires_approval` | No (not without an approval step this milestone did not build) | Yes |
| `high_risk_prohibited` | Never | N/A (always blocked) |
| `insufficient_context` | Never | N/A (always blocked) |
| `validation_unavailable` | Never | N/A (always blocked) |
| `repository_dirty` | Never | N/A (always blocked) |
| `unsupported_operation` | Never | N/A (always blocked) |

10 `PROHIBITED_AREA_TAGS` (authentication, authorization, cryptography, secrets, billing, destructive_migration, production_infrastructure, branch_protection, dependency_chain_upgrade, generated_lockfile_rewrite) always classify a candidate `high_risk_prohibited` regardless of any other input.

## Budgets

`AutonomousBudgetsSchema`: `maxWallClockSeconds`, `maxCommandCount`, `maxRetryCount`, `maxChangedFiles`, `maxDiffLines`, `maxValidationSeconds`, optional `maxModelTokenSpend`. Every dimension checked independently (AND-of-limits); a value exactly at the limit is not exceeded (inclusive ceiling, exercised by the WU36-03/05 `maxCommandCount: 1` scenarios, which stop after exactly the first command).

## Command policy

7 command classes (`read_only_inspection`, `repository_local_write`, `git_operation`, `test_or_build`, `network`, `destructive`, `privileged`). `destructive` and `privileged` are always denied with no per-run override path. `network` requires `networkPolicy: "explicitly_enabled"`, denied by default. Classification is fail-closed: an unrecognized command string classifies as `privileged` (always denied) rather than defaulting to something permissive — this milestone's own tests found and fixed two real gaps in the pattern tables (`git mv`/`git rm`, WU36-04 Sec 11.7) rather than working around them.

## Execution isolation

Every run executes inside a dedicated `git worktree` on a fresh `autonomous/`-prefixed branch, never the source repository's checked-out branch. Worktree creation/removal is confined to exactly one module (`autonomous-worktree-lifecycle.ts`), itself confined to exactly the 2-function mutating Git allowlist (`gitWorktreeAdd`/`gitWorktreeRemove`) plus read-only checks — verified both positively and negatively by the boundary scan across every other M36 file.

## Validation policy

Two-tier: `targetedValidationCommands` (required — an empty list is structurally "not validated," never vacuously passed) then, only if those all pass, `authoritativeValidationCommands` (optional; `null`, not `false`, when never attempted). Both run through the same policy-enforced command runner as the repair itself — no separate, less-restricted validation execution surface exists.

## Dogfood scenarios (WU36-05)

All 5 required scenarios run against a real, disposable, non-AIQT Git repository (`tests/integration/autonomous-run-dogfood-pilot.test.ts`); full evidence for each committed to `docs/engineering/m36-wu05-dogfood-evidence.generated.json`.

| Scenario | `resultState` | `recommendedHumanAction` | Notes |
|---|---|---|---|
| 1. Successful low-risk run | `passed` | `review_and_merge` | Renamed a typo-named file; targeted validation passed; zero self-review findings; source branch/HEAD untouched. |
| 2. Blocked unsafe run | `blocked` | `discard` | A destructive command (`rm -rf .`) proposed mid-run was denied before it ever executed; the run stopped with only the prior genuinely-executed command recorded. |
| 3. Cancelled run | `cancelled` | `discard` | A pre-aborted `AbortSignal` stopped the run before any command executed. |
| 4. Budget-exhausted run | `budget_exhausted` | `rerun_with_modified_budget` | A `maxCommandCount: 1` budget stopped the run after exactly the first command, with a second command already proposed but never attempted. |
| 5. Validation-failed run | `validation_failed` | `request_changes` | The repair command itself succeeded, but the supplied targeted validation command failed — the run correctly did not report `passed`. |

Every scenario's `workspace.cleanupStatus` is `"cleaned"`; no scenario's `recommendedHumanAction` is ever an automatic merge action; every scenario confirms the AIQT repository itself is never the target (`targetRepoDir !== repoRoot`) and no `.aiqt/` directory appears in this repository as a result.

## Residual risks (carried forward, not closed by this milestone)

- **No CLI command surface.** The entire pipeline is only reachable by direct function import. This was a deliberate scope boundary for the whole milestone (re-verified at the close of every Work Unit), not an oversight — wiring a real command surface is a separate, larger decision.
- **No model-backed agent adapter.** `DeterministicStubAgentAdapter` is the only implementation of `AgentAdapter` in this repository. A real repair proposal today requires a human to supply the exact command list in advance; nothing in this milestone decides what commands to run.
- **No approval workflow for `medium_risk_requires_approval`.** The risk class exists and is correctly classified, but no mechanism exists yet to record or check a human approval before such a candidate could proceed — it currently cannot proceed at all (fail-closed, matching this milestone's own principle, but also meaning that risk tier is not yet usable).
- **Dogfood pilot used a synthetic, disposable target, not a real external repository.** This satisfies every stated acceptance criterion without requiring the additional authorization a real external target would need (see the operator workflow doc's rationale). A real pilot against an operator-authorized external repository remains a reasonable next step if broader use is desired.

## Explicit statement: auto-merge remains disabled

No function anywhere in the M36 codebase merges, pushes, or checks out an `autonomous/`-prefixed branch back onto a target repository's default branch. This is verified structurally (the boundary scan's merge-pattern check, extended in every Work Unit that added new files) and behaviorally (every dogfood scenario's `recommendedHumanAction` is one of `review_and_merge` / `request_changes` / `discard` / `provide_missing_input` / `rerun_with_modified_budget` — never an automatic merge). A human must always take the merge action manually, using whatever normal review process the target repository already has.

## Recommendation on broader pilot use

The bounded, policy-checked execution mechanics (worktree isolation, command classification, budget enforcement, validation-gated result states, evidence packet assembly) are implemented and tested against real disposable repositories, not mocks. Before any broader pilot use, two gaps from "residual risks" above should be closed deliberately: (1) a real agent adapter (or an explicit decision to keep requiring a human-supplied command list per run), and (2) an approval workflow for `medium_risk_requires_approval` candidates, if that risk tier is meant to ever be used. A CLI command surface should be added only after those decisions are made, scoped narrowly (e.g. `--dry-run`-only at first), and reviewed with the same per-Work-Unit discipline this milestone used throughout.
