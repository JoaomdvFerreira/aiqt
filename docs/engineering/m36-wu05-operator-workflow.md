# M36-WU05: Operator Workflow (Dogfood Pilot)

This document describes how a human operator would drive an autonomous maintenance run using the M36 pipeline as it exists at the close of this milestone, and states plainly what is and is not wired up yet.

## No CLI command exists

There is no `aiqt` subcommand that invokes any part of this pipeline. `produceAutonomousEvidencePacket()` and `buildAutonomousRunCommandResult()` (both `src/services/`) have no caller anywhere in this repository outside of tests. This was a deliberate scope decision for the whole milestone, re-verified at the close of every Work Unit (`tests/unit/autonomous-run-boundary-scan.test.ts`'s "no CLI command references 'autonomous'" checks, one per Work Unit plus a final closure check). Adding a real command surface is a materially bigger decision than anything this milestone was asked to do — it would mean AIQT could actually be told to run this against a real repository from a terminal — and was not requested, so it was not built.

## What an operator would do today, calling the pipeline directly

Until a CLI command exists, the only way to run this pipeline is the way this milestone's own tests do: import the functions directly and construct every input by hand.

1. **Construct a candidate** (`AutonomousCandidateSchema`, `src/schema/autonomous-run.schema.ts`): `issueId`, `source`, `repository`, `baseRef`, `objective`, `acceptanceCriteria`. This is currently always hand-built by a human (or a test) — there is no issue-tracker integration that produces one automatically.
2. **Run preflight** (`runRepositoryPreflight`, `src/workflow/autonomous-run-preflight.ts`) against the real target repository path: confirms it is a Git repository, the working tree is clean, and `baseRef` resolves.
3. **Classify the candidate** (`classifyCandidate`, `src/workflow/autonomous-run-safety-classifier.ts`, or via `intakeCandidate` in `src/services/autonomous-candidate-intake-service.ts` which runs both steps together): produces an `AutonomousSafetyAssessment`. If `riskClass` is anything other than `low_risk_autonomous`, stop — `medium_risk_requires_approval` needs a human approval step this milestone did not build a workflow for yet, and every other risk class is always blocked.
4. **Decide an execution policy and budgets** (`AutonomousExecutionPolicy`/`AutonomousBudgets`, same schema file): the filesystem boundary must be a real, validated workspace root (`validateWorkspaceRoot`, `src/workspaces/workspace-path-policy.ts`); budgets should be tight for a first run (see the dogfood scenarios below for concrete numbers that worked).
5. **Supply an agent adapter**: the only implementation in this repository is `DeterministicStubAgentAdapter` (`src/workflow/autonomous-run-agent-adapter.ts`), which returns a fixed, caller-supplied command list — there is no model-backed adapter. A real repair proposal today means a human deciding the exact command list in advance, not an autonomous agent deciding it at run time.
6. **Call `produceAutonomousEvidencePacket()`** (`src/services/autonomous-run-evidence-binding-service.ts`) with all of the above, plus `targetedValidationCommands` (required — an empty list means the run can never report `resultState: "passed"`) and optionally `authoritativeValidationCommands`.
7. **Read the resulting `AutonomousEvidencePacket`**: `resultState` and `recommendedHumanAction` tell the operator what happened and what to do next (see the table below). `findings` lists anything self-review flagged. `diffSummary`/`filesChanged` show exactly what changed. **The operator must still manually review and merge** — nothing in this pipeline merges a branch, and `resultState: "passed"` only ever recommends `"review_and_merge"`, never performs it.
8. Optionally wrap the packet with `buildAutonomousRunCommandResult()` (`src/services/autonomous-run-command-result.ts`) to get the same `CommandResult` JSON shape every other AIQT command already produces.

## `resultState` → `recommendedHumanAction` reference

| `resultState` | `recommendedHumanAction` | Meaning |
|---|---|---|
| `passed` | `review_and_merge` | Repair changed something, targeted validation passed, no self-review findings. A human must still review and merge — this never happens automatically. |
| `validation_failed` | `request_changes` | Either no targeted validation command was ever supplied, or one was supplied and failed/was blocked. |
| `review_rejected` | `request_changes` | Validation passed, but self-review found something outside the declared scope (an unexpected file, a budget overage, or a zero-file no-op repair). |
| `blocked` | `discard` | A proposed command was denied by execution policy (e.g. destructive, network without `explicitly_enabled`). The candidate as scoped cannot proceed autonomously. |
| `cancelled` | `discard` | The run was cancelled (an operator-set `AbortSignal`) before completion. Evidence is necessarily incomplete. |
| `budget_exhausted` | `rerun_with_modified_budget` | The run hit a budget ceiling before finishing. Evidence up to that point is preserved; try again with a larger budget if appropriate. |
| `failed` | `provide_missing_input` | The workspace itself could not be prepared (bad base ref, dirty tree, invalid workspace root). No commands ever ran. |

## Recovery and cleanup

Every outcome — including `blocked`, `cancelled`, `budget_exhausted`, and `failed` — always attempts worktree cleanup exactly once, recorded in `workspace.cleanupStatus` (`"cleaned"` or `"cleanup_failed"`). An operator should check this field: if `cleanup_failed`, the isolated worktree (`workspace.worktreePath`) and its `autonomous/`-prefixed branch may still exist in the target repository and need manual `git worktree remove`/`git branch -D`. This never touches the target repository's default branch or `HEAD` — every dogfood scenario in this Work Unit explicitly asserts this stays untouched.

## Dogfood pilot summary

Five required scenarios (build spec acceptance criteria) were run end-to-end against a real, disposable, non-AIQT target repository — never this repository's own working tree — in `tests/integration/autonomous-run-dogfood-pilot.test.ts`. Full evidence for each is captured in `docs/engineering/m36-wu05-dogfood-evidence.generated.json` (both the raw `AutonomousEvidencePacket` and the wrapped `CommandResult`). See the M36 closure report (`docs/engineering/m36-closure-report.md`) Sec "Dogfood Scenarios" for the summary table.

### Why a disposable synthetic repository, not a real external one

Running this against a real external (e.g. public GitHub) repository would mean cloning real code, potentially pushing a real branch, and would require the target repository owner's authorization — a materially different, harder-to-reverse action than anything else in this milestone. Every other M36 Work Unit already established "a real disposable Git repository, not mocks" as the standard of evidence for this codebase (M25 §8, reused throughout M36); this Work Unit applies the same standard, framed explicitly as a pilot with committed evidence rather than only inline test assertions. This was a deliberate scope decision, not an oversight — a future Work Unit could extend the pilot to a real, operator-authorized external repository if broader piloting is desired (see the closure report's recommendation).
