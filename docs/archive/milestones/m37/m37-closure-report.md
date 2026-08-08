# M37 Closure Report — Autonomous Runner CLI, Agent Adapter, and Controlled Pilot

## M36 entry-gate evidence (verified before WU37-01 began)

- M36 closure report present and complete (`docs/engineering/m36-closure-report.md`).
- M36 closure tags present: `m36-wu05-autonomous-runner-dogfood`, `m36-autonomous-maintenance-runner`.
- Final M36 CI green (all jobs, all 3 test shards, zero timeouts/assertion failures).
- M36 dogfood evidence present (`docs/engineering/m36-wu05-dogfood-evidence.generated.json`).
- Clean working tree, no `.aiqt/` directory present.
- No automatic merge/self-management path existed anywhere in the M36 codebase.

## Starting / ending commit and version range

| | Commit | Package version | Schema version |
|---|---|---|---|
| Start (M36 close) | `d1ab8ab` | 0.24.0 | 0.5.0 (unchanged throughout M37) |
| End (M37 close, WU37-05) | (this Work Unit's own commit, tagged `m37-wu05-controlled-autonomous-pilot` / `m37-autonomous-runner-cli`) | 0.28.0 | 0.5.0 |

M37 never touched `AIQT_SCHEMA_VERSION` — nothing in this milestone persists to AIQT's own canonical `.aiqt/state.json`/`runlog.jsonl` shape; every autonomous-run/agent-request/operator-config schema family remains wholly separate and never persisted there. WU37-05 itself added only `tests/` and `docs/` files, touching no path this repository's version-governance rule (`src/tooling/relevant-paths.ts`) treats as relevant — verified via `version:check`, which reports `relevantChangesDetected: false` for this Work Unit's diff, so no bump was required or made; the package version stayed at `0.28.0` (last set by WU37-04) through WU37-05's close.

## Work Unit table

| Work Unit | Tag | Risk score | Summary |
|---|---|---|---|
| WU37-01 | `m37-wu01-public-cli-contract` | 35/100 | First public `aiqt autonomous ...` command surface: `inspect/classify/approve/run/status/cancel/result/cleanup` (8 commands, all `--json`-capable, M33-compatible results). Operator configuration contract (CLI flags → project config → env → safe defaults). Approval contract (binding digest, staleness). Simulation-only `run` (`--simulate`, always `resultState:"needs_input"`) — no real execution surface existed yet. Self-management guard (`isAiqtOwnRepository`) established and reused throughout the rest of the milestone. |
| WU37-02 | `m37-wu02-bounded-agent-adapter` | (design-note-driven; request/import is data-only, no process spawn) | Design decision (`docs/engineering/m37-wu02-agent-adapter-design-note.md`, made with the user's explicit sign-off): a bounded request/import pattern, not a live-spawned subprocess — Node's `child_process` cannot honestly guarantee a filesystem jail. `AutonomousAgentRequest`/`AutonomousAgentResponse` schemas, request builder, request lifecycle (`pending→imported/expired/cancelled`), response import service (5 named failure reasons mapped to the M33 contract). No CLI wiring yet. |
| WU37-03 | `m37-wu03-cli-run-orchestration` | 65/100 (as speced) | Wired the real (non-simulated) path end-to-end: `run` (without `--simulate`) builds and persists a real `AutonomousAgentRequest`; the new `aiqt autonomous agent-import` command is the one place in the milestone that creates a real `git worktree` and executes real commands, via M36-WU04's unmodified `produceAutonomousEvidencePacket`. Concurrent-duplicate-run blocking falls out of the lifecycle state machine for free. Found and fixed 3 real defects: an unsafe relative `worktreeRoot` default, a genuine pre-existing M36-WU04 bug (`cleanupStatus` hardcoded to `"cleaned"` regardless of actual cleanup outcome — a silent misreport the M36-WU05 dogfood pilot itself had been unknowingly relying on), and a lifecycle-table gap (`executing→blocked` was missing a direct edge). Recovered cleanly from a self-inflicted local process incident (an accidental commit from a broken manual verification script) before anything was ever pushed. |
| WU37-04 | `m37-wu04-human-approval-and-handoff` | 45/100 (lower than the build spec's 55/100 estimate) | Commit preparation (`git add -A && git commit` with a fixed, templated message, run only for a `"completed"` outcome with real changes, deliberately outside the run's own command budget) closes the "dirty worktree blocks cleanup" gap. Patch export (`gitDiffPatch`, a new read-only `git diff <base> <head>` between two refs) and pure PR draft text generation (`buildAutonomousPrDraft`), both wired to `aiqt autonomous result --patch`/`--pr-draft`. Neither pushes, merges, nor contacts any Git host. |
| WU37-05 | `m37-wu05-controlled-autonomous-pilot` / `m37-autonomous-runner-cli` | 30/100 | Controlled pilot: 10 required scenarios run end-to-end against a real, disposable, non-AIQT target repository, driven entirely through the real public CLI (not service-level calls) — the first Work Unit to exercise `classify`/`approve`/`run`/`agent-import`/`cancel`/`cleanup`/`result`/`status` together as an operator actually would. Operator workflow documentation rewritten for the real CLI. This closure report. No new execution surface — reuses the already-reviewed WU37-01..04 pipeline exactly as built; lower risk than prior Work Units because it adds no new mutating capability, only exercises and documents what already exists. |

## Public CLI contract

8 commands under `aiqt autonomous`, every one JSON-capable and returning the M33-compatible `CommandResult` shape (`status`, `action:"autonomous"`, `summary`, `exitCode`, optional `nextRecommendedCommand`/`requiresHumanInput`, `data`). Run identifiers (`run-<timestamp>-<8 hex>`) and agent-request identifiers (`agentreq-<timestamp>-<8 hex>`) are the stable handles threaded through every command. Workflow pointers (`nextRecommendedCommand`) guide an operator from `classify` → (`approve` if needed) → `run` → `agent-import` → `result`. No command ever bypasses the structured result with raw output.

## Adapter contract (request/import)

`AUTONOMOUS_AGENT_PROVIDER_ID = "external-coding-agent-manual@1"`. A request expires 24 hours after creation (`AUTONOMOUS_AGENT_REQUEST_EXPIRY_SECONDS`). `importAutonomousAgentResponse` validates 5 distinct failure modes before ever touching the filesystem: `request_expired`, `request_not_pending`, `malformed_response`, `request_id_mismatch`, `provider_id_mismatch` — each mapped to a real M33 `CommandResult` failure, never a raw exception. `ImportedResponseAgentAdapter` (data-only: it just replays the imported command list) is the only adapter ever passed to `produceAutonomousEvidencePacket` from a real CLI path; `DeterministicStubAgentAdapter` (M36) remains test-only, enforced by the boundary scan.

## Approval model

Approval is required whenever: the operator's `approvalPolicy` is `always_required`; the risk class is `medium_risk_requires_approval`; or the candidate requested any elevated permission. `aiqt autonomous approve` records `{approvedAt, approvedBy: "interactive"|"--yes", bindingDigest}`, where `bindingDigest` is a deterministic sha256 over the candidate, base commit, and budgets at approval time. `aiqt autonomous run` re-checks this digest against the run's *current* candidate/base-commit/budgets on every invocation — any change since approval (including an operator hand-editing the persisted run record, or re-classifying with different budgets) makes the approval stale and blocks the run until re-approved. Always-blocked risk classes (prohibited areas, insufficient context, dirty repository, no validation available, unsupported operation) never reach the approval step at all — `classify` stops them first, fail-closed.

## Resumability model

`run` (real path) persists the agent request to disk and returns immediately with `needs_input` — no in-memory state is required to continue. `agent-import` loads the run and its agent request purely from disk, so it can be invoked from an entirely separate process, at an arbitrary later time (bounded only by the request's 24-hour expiry), exactly matching how an operator would actually work: run `aiqt autonomous run`, go run their own coding-agent tool, come back later and run `aiqt autonomous agent-import`. A concurrent second `run` against the same run id is rejected once the first has moved the run to `executing` — this falls directly out of the lifecycle state machine (`classified`/`preparing_workspace` are the only two starting statuses `run` accepts) with no additional locking code.

## Command/network policy

Unchanged from M36, reused verbatim: 7 command classes, `destructive`/`privileged` always denied with no override, `network` denied unless `networkPolicy: "explicitly_enabled"` (never set to that by any code in this milestone), fail-closed classification for unrecognized commands. Every real command executed by `agent-import` goes through the same policy-enforced `runAutonomousCommand` M36-WU03 established — no new, less-restricted execution path was added.

## Pilot scenarios (WU37-05)

All 10 required scenarios run against a real, disposable, non-AIQT Git repository, driven entirely through the real CLI (`tests/integration/autonomous-controlled-pilot.test.ts`); full evidence for each committed to `docs/engineering/m37-wu05-controlled-pilot-evidence.generated.json`.

| # | Scenario | Outcome | Notes |
|---|---|---|---|
| 1 | Successful low-risk repair | `resultState:passed` | `classify → run → agent-import`; rename committed on the run's own branch; default branch/HEAD byte-identical before/after. |
| 2 | Medium-risk task requiring approval | `run` refused (`awaiting_approval`) → `approve --yes` → `passed` | A candidate requesting `network_access` lands in `medium_risk_requires_approval`; `run` is blocked until approved. |
| 3 | Blocked prohibited task | `classify` returns `blocked`, `nextRecommendedCommand: null` | A `secrets`-tagged candidate is always blocked; a subsequent `run` attempt is also refused. |
| 4 | Cancelled agent run | `cancel` → `passed`, run status `cancelled` | Cancelled while awaiting the operator's agent-import; no worktree was ever created at that stage. |
| 5 | Budget-exhausted run | `resultState:budget_exhausted` | An operator-configured `maxCommandCount: 1` stops the run after exactly the first proposed command. |
| 6 | Validation-failed run | `resultState:validation_failed` | The rename itself succeeds, but the configured targeted validation command fails — never reported as `passed`. |
| 7 | Stale approval rejection | `run` refused (`AUTONOMOUS-RUN-STALE-APPROVAL`) | Budgets changed after approval was granted; the binding digest no longer matches, and the run is blocked until re-approved. |
| 8 | Resume from allowed state | `resultState:passed` | The agent request is reloaded purely from disk (simulating a separate later process) before `agent-import` completes it. |
| 9 | Patch handoff | `result --patch`/`--pr-draft` return real diff + PR text | Patch contains the renamed file; PR draft body explicitly states nothing has been merged, pushed, or deployed; default branch untouched. |
| 10 | Discard and cleanup | `cancel` → `cleanup` → `passed` | The cancelled run's record is deleted; it no longer appears in `aiqt autonomous status`'s run listing; no orphaned worktree remains. |

Every scenario's evidence confirms: no default-branch mutation, no automatic merge (`recommendedHumanAction` is never a merge action), the AIQT repository itself is never the target, and no `.aiqt/` directory appears in this repository as a result.

## Validation evidence

Full local validation (`typecheck`, `lint`, `build`, `test`, `version:check`) run before every Work Unit's commit across WU37-01 through WU37-05. Each Work Unit's push was confirmed via a real GitHub Actions CI run: all jobs `success`, all 3 test shards individually verified for zero timeouts and zero assertion failures (via `gh api repos/.../actions/jobs/<id>/logs`, since `gh run view --log` intermittently returned empty output during this milestone — a transient CLI/API issue, not a real gap in verification).

## Blocked and failed cases

- `classify` fail-closed rejects: self-targeting the AIQT repository, unknown `--prohibited-area` values, conflicting/empty candidate input, an empty parsed validation command.
- `run` fail-closed rejects: wrong run status, approval required but missing, stale approval, self-targeting repository (defense-in-depth re-check), no resolved base commit.
- `agent-import` fail-closed rejects: conflicting/missing `--from-file`/`--stdin`, wrong run status, missing agent request id, all 5 named response-import failure reasons, a relative `worktreeRoot` (never resolved against an unpredictable cwd), self-targeting repository (defense-in-depth re-check).
- `cleanup` fail-closed rejects: non-terminal run status, a run whose worktree cleanup previously failed (preserves the orphaned path reference rather than losing it).

## Residual risks (carried forward, not closed by this milestone)

- **The bounded coding-agent adapter is manual, not automated.** The operator must run their own coding-agent tool by hand and save its response as JSON — there is no built-in integration with any specific tool. This was the explicit, user-approved architecture decision (WU37-02), not an oversight.
- **The controlled pilot used a synthetic, disposable target, not a real external repository.** Same rationale as M36-WU05: satisfies every acceptance criterion without the additional authorization a real external target would require. A future milestone could extend piloting to a real, operator-authorized external repository if broader use is desired.
- **No issue-tracker integration.** `aiqt autonomous classify` still requires a hand-constructed (or `--from-file`/`--stdin`-supplied) candidate; nothing in this milestone discovers candidates automatically.
- **Non-interactive `agent-import` failure-log verification relied on a `gh api` workaround** during this milestone's own CI confirmation (`gh run view --log` intermittently returned empty output) — noted here as a process observation, not a product risk.

## Explicit statement: auto-merge remains disabled

No function anywhere in the M37 codebase merges, pushes, or checks out an `autonomous/`-prefixed branch back onto a target repository's default branch. `aiqt autonomous result --pr-draft` returns text only — it never calls any Git-hosting API. This is verified structurally (the boundary scan, extended in every Work Unit that added new files) and behaviorally (every pilot scenario's `recommendedHumanAction` is one of `review_and_merge` / `request_changes` / `discard` / `provide_missing_input` / `rerun_with_modified_budget` — never an automatic merge). A human must always take the merge action manually.

## Recommendation on limited operator use

The full pipeline — classification, approval, bounded request/import execution, validation-gated result states, evidence packet assembly, patch/PR-draft handoff — is now reachable through a real, tested public CLI, exercised end-to-end against real disposable repositories for all 10 required pilot scenarios, not mocks. This milestone recommends **limited, supervised operator use**: a human runs `classify`, reviews the risk classification, approves if needed, runs their own coding-agent tool by hand, imports its response, and reviews every evidence packet before manually merging anything. It does **not** recommend unattended autonomous operation — every step still requires a human in the loop, by design, and no mechanism in this codebase removes that requirement.
