# M37-WU05: Operator Workflow (Controlled Pilot)

This document describes how a human operator drives an autonomous maintenance run using the real, public `aiqt autonomous ...` CLI as it exists at the close of Milestone 37. Unlike the M36 closure ("no CLI command exists — call the pipeline directly"), a real command surface now exists: every step below is a real `aiqt` invocation, not a hand-constructed function call.

## The command surface

| Command | Purpose |
|---|---|
| `aiqt autonomous classify` | Intake a candidate, run real read-only preflight, classify risk, and persist a new run record. |
| `aiqt autonomous approve` | Approve a run currently `awaiting_approval` (interactive confirm, or `--yes` non-interactively). |
| `aiqt autonomous run` | `--simulate`: a pure preview, no real execution. Without it: build and persist a bounded `AutonomousAgentRequest` for the operator's own coding-agent tool. |
| `aiqt autonomous agent-import` | Import the coding-agent tool's response (`--from-file`/`--stdin`), and — only here — create a real isolated worktree and execute the proposed commands under policy. |
| `aiqt autonomous status` | List all runs, or show one run's full lifecycle/classification/budgets/approval state. |
| `aiqt autonomous cancel` | Cancel a non-terminal run with a recorded reason. |
| `aiqt autonomous result` | Return the terminal result packet; `--patch` for a real diff, `--pr-draft` for PR title/body text. |
| `aiqt autonomous cleanup` | Delete a terminal run's own record (refuses if worktree cleanup previously failed). |

Every command supports `--json` and returns the same M33-compatible `CommandResult` shape as every other AIQT command.

## Why `run` doesn't run anything itself

Per the M37-WU02 design decision (`docs/engineering/m37-wu02-agent-adapter-design-note.md`), AIQT never spawns a coding-agent process itself — `child_process` provides no real filesystem jail, so "the adapter cannot escape the worktree" cannot be honestly guaranteed for a live-spawned subprocess. Instead:

1. `aiqt autonomous run` builds a bounded **request** (objective, acceptance criteria, constraints, budgets, allowed command classes) and writes it to the run's evidence directory. It returns `needs_input` — no worktree exists yet.
2. The **operator** runs their own coding-agent tool (Claude Code, or any other tool they control) against that request's prompt package, in an environment they choose.
3. The operator saves that tool's response as JSON (`{requestId, providerId, commandsProposed}`) and runs `aiqt autonomous agent-import --from-file <path>`. **This is the one place in the entire CLI that creates a real `git worktree` and executes real commands** — via M36-WU04's `produceAutonomousEvidencePacket`, unchanged since M36, called for the first time from a public command in M37-WU03.

This also means resumability is free: the agent request persists on disk across separate CLI invocations (separate processes, separate days) — `agent-import` can be run whenever the operator has a response ready, and a concurrent second `run` against the same run id is rejected once the first has moved it to `executing`.

## Approval

A run needs approval when its risk class is `medium_risk_requires_approval` (the candidate requested elevated permissions), or whenever the operator's configured `approvalPolicy` is `always_required`. `aiqt autonomous run` refuses with `AUTONOMOUS-RUN-APPROVAL-REQUIRED` until `aiqt autonomous approve` has recorded one. Every approval is bound (sha256 digest over candidate/base-commit/budgets) at the moment it is granted; if any of those three changes afterward, `run` refuses with `AUTONOMOUS-RUN-STALE-APPROVAL` — a stale approval never authorizes a run, and the operator must re-approve.

A candidate touching a prohibited area (secrets, authentication, billing, destructive migrations, etc.) or otherwise landing in an always-blocked risk class is stopped at `classify` time, before approval is even offered — there is no path to run it, approved or not.

## `resultState` → `recommendedHumanAction` reference

Unchanged from M36 (`docs/engineering/m36-wu05-operator-workflow.md`) — `agent-import`'s evidence packet uses the same table: `passed`→`review_and_merge`, `validation_failed`→`request_changes`, `review_rejected`→`request_changes`, `blocked`→`discard`, `cancelled`→`discard`, `budget_exhausted`→`rerun_with_modified_budget`, `failed`→`provide_missing_input`. **`review_and_merge` is only ever a recommendation** — nothing in this CLI merges a branch or pushes anywhere.

## Patch handoff

`aiqt autonomous result --patch` returns a real `git diff` between the run's base commit and its `autonomous/`-prefixed branch head, read directly from the source repository (the isolated worktree is already gone by then; the branch survives). `--pr-draft` returns pure, locally generated title/body text (never a real PR, never a network call) ending with an explicit disclaimer that nothing has been merged, pushed, or deployed. The operator copies this text into their own PR themselves.

## Recovery and cleanup

Same as M36: every outcome attempts worktree cleanup exactly once, recorded in `workspace.cleanupStatus`. `aiqt autonomous cleanup` additionally refuses to delete a run's record if that cleanup previously failed — deleting the record would destroy the only reference to an orphaned worktree path. As of M37-WU04, a `"completed"` outcome with real changes is auto-committed by AIQT itself (`git add -A && git commit -m <fixed template>`) before cleanup runs, which is why a bare, uncommitted rename from the agent's own proposed commands still reports `cleanupStatus: "cleaned"` rather than leaving a dirty worktree.

## Controlled pilot summary

Ten required scenarios (build spec acceptance criteria) were run end-to-end against a real, disposable, non-AIQT target repository, driven entirely through the real CLI command functions above (not service-level calls), in `tests/integration/autonomous-controlled-pilot.test.ts`. Full evidence for each is captured in `docs/engineering/m37-wu05-controlled-pilot-evidence.generated.json`. See the M37 closure report (`docs/engineering/m37-closure-report.md`) Sec "Pilot Scenarios" for the summary table.

### Why a disposable synthetic repository, not a real external one

Same reasoning as M36-WU05: running this against a real external repository would require cloning real code and the target repository owner's explicit authorization — a materially different, harder-to-reverse action than anything requested for this milestone. A disposable synthetic Git repository, created and destroyed by the test itself, satisfies every acceptance criterion (full evidence, no default-branch mutation, no automatic merge, no self-management, no secret leakage, no unapproved network access) without that additional, unrequested scope.

## What remains disabled

No automatic merge path exists anywhere in this CLI. No PR is ever actually created (`--pr-draft` returns text only). No network access occurs beyond what the operator's own coding-agent tool does outside AIQT's process. AIQT refuses to target its own repository at every real-execution boundary (`classify`, `run`, `agent-import`). This milestone recommends **limited, supervised operator use** — every run still requires a human to run their own coding-agent tool, review the evidence packet, and manually merge — not unattended autonomous operation.

## M38-WU04 Addendum: Opt-In Live Sandboxed Execution

`aiqt autonomous agent-import` gained a `--live` flag: instead of executing the imported response's proposed commands via a bare worktree (the default, described throughout this document, and still the permanent, always-available fallback), `--live` executes them inside a real, isolated Docker sandbox (`docs/engineering/m38-sandbox-platform-decision.md`).

**Two independent opt-in gates, both required:**
1. The operator's own standing configuration must set `liveExecutionEnabled: true` (default `false`) -- via `aiqt.autonomous.config.json` or `AIQT_AUTONOMOUS_LIVE_EXECUTION=1`. `--live` without this is refused immediately, before any Docker/capability check.
2. The invocation itself must pass `--live`. Omitting it always uses the non-live path, regardless of the operator's config.

**Capability preflight** always runs next: `DockerSandboxBackend.checkAvailability()` then `evaluateSandboxCapabilities()`. Either failing refuses the run with a clear reason and a recommendation to retry without `--live` (the request/import path is always available) -- never a silent, unsandboxed fallback.

**What's different in live mode:** the same imported command list runs via real `docker exec` inside a container with real mount/environment/network/resource isolation (no host home, no parent repository, network denied, non-root, real CPU/memory/process-count limits) instead of a bare `execFileSync` against the worktree directly. Validation (targeted, then authoritative) and self-review run the same way, inside the same sandbox. The result is still an M33 `CommandResult`, with the sandbox's real evidence (`SandboxEvidence`: commands executed, output captured, changed files, termination reason, cleanup status) as its `data` payload -- a distinct shape from the non-live path's `AutonomousEvidencePacket`, stored in the run record's own `sandboxEvidence` field.

**Crash recovery:** the real sandbox container's id is persisted to the run record (`sandboxContainerId`) immediately after creation, before any command runs inside it. If AIQT itself crashes mid-run, that id survives on disk. A later `aiqt autonomous cleanup` invocation detects an unconfirmed sandbox cleanup and attempts a real `destroy()` of the orphaned container before allowing the run record to be deleted -- refusing (preserving the reference) if the sandbox backend is unavailable at that moment.

**What remains true regardless of `--live`:** no automatic merge, no real PR creation, no self-management, network-enabled live execution is permanently unsupported by the current Docker backend (no destination-restriction mechanism exists). This milestone's recommendation of limited, supervised operator use is unchanged -- `--live` changes *where* an already-decided command list executes, never *who* decides what to run.
