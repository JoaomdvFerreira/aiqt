# M39 — Agent Execution Efficiency and Context Control — Closure Report

**Status:** Closed on branch `milestone/m39-agent-execution-efficiency`. Not merged. No PR opened yet.

## Baseline / final commits

- Branch created from `main` at `0caf68b` (pre-existing hygiene fix, unrelated to M39).
- Preceding commit on branch: `ec0c68d` (docs: add M39 build specification).
- Final commit: `48ade9c` (`feat(m39-hf02): guidance surface completion and closure evidence`).
- Package version: `0.32.4` → `0.33.0` (minor, set at WU39-01; unchanged since — the milestone-vs-`main` diff carries this single bump, satisfying `version:check`'s "some bump occurred" rule for the whole milestone).
- Schema version: unchanged throughout (`0.5.0`). No canonical schema/state file was introduced or modified.

## WU / HF commits and tags

| Unit | Commit | Tag |
|---|---|---|
| Spec | `ec0c68d` | — |
| WU39-01 — Execution Guidance Contract and Decision Owner | `8f90cd6` | `m39-wu01-execution-guidance-contract` |
| WU39-02 — Context Selection and Continuation Capsules | `626d75f` | `m39-wu02-context-selection-continuation` |
| WU39-03 — Agent Profiles, Output Policy, and Subagent Controls | `6a82750` | `m39-wu03-agent-profile-efficiency-controls` |
| WU39-04 — Progressive Validation Policy and Packet Integration | `659b860` | `m39-wu04-progressive-validation-policy` |
| WU39-05 — Efficiency Dogfood, Integration, and Closure | `661763c` | `m39-wu05-efficiency-dogfood-and-closure` |
| WU-HF01 — Integration Stabilization | `28024be` | `m39-hf01-integration-stabilization` |
| WU-HF02 — Guidance Surface Completion and Closure Evidence | `48ade9c` | `m39-hf02-guidance-surface-completion` |

## Integrated contract outcomes

One shared, pure decision owner (`src/workflow/execution-guidance.ts`) computes complexity, agent/reasoning recommendation, context manifest, continuation capsule, progressive-validation guidance, output policy, and subagent policy in a single deterministic pass (`composeExecutionGuidance`). `aiqt next` and `aiqt next --preview` call the identical shared helper (`buildExecutionGuidanceForWorkUnit`), guaranteeing preview/apply parity by construction — no divergent or duplicated recommendation logic exists anywhere in the consumer surfaces.

- Complexity/reasoning/agent-class recommendation: real, deterministic, bounded-signal, provider-neutral (WU39-01).
- Concrete profile mapping: configurable via a narrow, additive project config file; generic mode works without it; mapping never changes the underlying complexity classification (WU39-01/03).
- Context manifest: prioritized (must_read/should_read/reference_only), soft/hard-budget aware, path-safety filtered, never silently truncates must-read (WU39-02).
- Continuation capsule: reuses existing `Checkpoint` fields verbatim, bounded/deterministic, no new checkpoint field, no chat-history persistence (WU39-02).
- Progressive validation: ordinary Work Units default to static+focused; full/milestone deferred to closure by default; an explicit reason is required and recorded to promote full to "now"; an unclassified command is required now rather than guessed safe (WU39-04).
- Output/subagent policy: fixed compact-success/full-failure; subagents default to none, targeted-only for complex/architectural with a recorded justification, capped at 1 (structurally cannot represent a recursive swarm) (WU39-01).
- CLI integration: `aiqt next`/`aiqt next --preview` expose guidance via an additive `data.executionGuidance` JSON field (WU39-04/05) and a human-readable block trailing the packet (WU-HF01) — never touching the hashed packet body, canonical state, or runlog events.
- Prompt integration: the generic `aiqt prompt driver` operating prompt now instructs the agent to follow `aiqt next`'s guidance block, start from its context, expand only on evidence, and prefer progressive validation over the full suite (WU-HF02, static text, no new decision logic).
- Autonomous integration: `aiqt autonomous classify`'s dry-run report carries an advisory-only `executionGuidance` summary (complexity/reasoning/class), reusing the same decision functions, never touching `AutonomousRunRecord`, riskClass, approval, budgets, or policy (WU-HF02).

## Dogfood metrics (actual, from WU39-05 + confirmed at HF02)

Three real flows against fresh temporary fixture projects (never against this repository):

- **Flow A** (mechanical/simple-shaped WU): non-high reasoning, no concrete mapping without a configured profile, zero subagents.
- **Flow B** (complex/architectural-shaped WU, real migration/concurrency/authentication signals): `architectural` complexity, `high` reasoning, `strong` class, its `pnpm test` full-suite command visibly deferred (not silently required or dropped) without a recorded exception.
- **Multi-WU sequence** (real two-Work-Unit dependency chain, both a Claude-Code-style and a Codex-style configured profile in one local JSON file, zero provider calls):
  - Context footprint: WU001 ≈1200 estimated tokens, WU002 ≈1200 estimated tokens (bounded, prioritized manifests).
  - **Baseline repeated recommended context footprint:** 2400 (WU001 + WU002 estimated tokens, i.e. what WU002 would cost if it had to redundantly re-declare WU001's own manifest as its own must-read set).
  - **M39 repeated recommended context footprint (actual):** 1200 (WU002's real estimate, using the continuation capsule instead of re-declaring WU001's context).
  - **Reduction: 50.0%** — target ≥30% **met**. Reported as measured, not tuned to hit the number.
  - Model/reasoning recommendation: WU001 (`architectural`/`high`) → configured Codex; WU002 (`standard`/`medium`) → configured Claude Code / Sonnet 5.
  - Full-suite frequency: 0 of 2 dogfood Work Units required full at the WU level (both correctly deferred to milestone closure).
  - Validation duration: not separately instrumented in this milestone (no existing contract field for it); not fabricated.
  - Subagent use: 0 (both WUs default to none; no justification was supplied or warranted).
  - WU outcome / regression findings: all 3 dogfood flows pass. The one real defect discovered during the whole milestone (WU39-05's dependency-edge-id resolution bug, `WorkUnit.dependencies` holds edge ids not prerequisite ids) was caught by these same dogfood tests and fixed before this closure — no regression escaped to closure.

A real, honest heuristic limitation was found and documented (not "fixed," per build spec Sec 7's explicit permission for over-caution): the risk-keyword scan matches "authentication" inside a negating `outOfScope: ["Do not implement authentication"]` entry, conservatively classifying that Work Unit as more complex than a human would. This is the safe direction the spec allows.

## Validation / CI evidence

- Per-WU: focused + directly-impacted tests only, escalated to the full next/preview/checkpoint-flow + `cli.test.ts` historical-compatibility suite whenever a WU touched those shared command files (WU39-04, WU39-05, HF01) — always green, zero regressions across all escalations.
- Milestone-closure boundary: `typecheck`/`lint`/`build` clean; `version:check` (local + `--base main`) passed with `requiredBumpPresent: true`, `increment: minor`.
- **Full local suite** (`vitest run`, 3031 tests): 6 failures, all `Test timed out` (30-40s timeouts), all in process-spawning integration suites unrelated to any M39-changed file (`evidence-advisory-hardening`, `evidence-gate-full-lifecycle`, `execution-adapter-claude-code-import`, `execution-external-import`, `workspace-cli`). **Isolated re-run of those exact 5 files: 38/38 passed** — confirms transient machine-load contention under the massive concurrent full-suite run, not a regression, matching this repository's own documented timeout-under-load pattern for this test class (see the versioning/test-workload governance referenced from `pnpm test`'s own troubleshooting notes).
- HF02-specific: `tests/unit/prompt-templates.test.ts` (36), `tests/integration/autonomous-candidate-intake-service.test.ts` (12), `tests/unit/autonomous-run-boundary-scan.test.ts` (58), `tests/integration/autonomous-cli-lifecycle.test.ts` (22) — all pass.
- **Final branch CI:** `.github/workflows/validate.yml` triggers only on `push: branches: [main]` or `pull_request` — it does **not** run on pushes to a feature branch with no open PR. Confirmed via `gh run list`: no workflow run exists for any commit on `milestone/m39-agent-execution-efficiency` throughout the branch's life. This is a structural fact of the workflow configuration, not a red/failing signal — there is no "final branch CI" result to report. The local full-suite run plus the isolated re-runs above are the authoritative evidence at this boundary; real CI will run for the first time when the PR is opened against `main`.
- `git diff --check`: clean throughout every commit.

## Defects found and fixed during M39

1. **Dependency-edge-id resolution bug** (WU39-05, caught by its own dogfood test): `buildExecutionGuidanceForWorkUnit` initially treated `WorkUnit.dependencies` entries as prerequisite Work Unit ids directly; they are dependency-edge ids. Fixed by resolving through `state.workGraph.dependencies` first, mirroring the existing `satisfiedBlockingDependencies` pattern.
2. **Missing human-mode render** (found at Integrated Review, fixed as HF01): `renderExecutionGuidanceHuman` (built WU39-03) was never called; `aiqt next` human-mode output only exposed guidance via `--json`. Fixed by inserting the block into the existing packet raw-text bypass site.
3. **Unwired prompt/autonomous surfaces** (found at Integrated Review, fixed as HF02): the build spec's Sec 9 "Prompt/autonomous integration" was not implemented by any of WU39-01–05. Fixed narrowly per Sections 1–2 above.

No defect required a canonical schema change, weakened any M37/M38 safety control, or required redesign.

## Residual risk

**Overall M39 risk: 30/100 — 🟠 orange (low-moderate), unchanged from the pre-HF02 integrated report; HF02 added only low-risk (15/100), advisory-only surface area.**

- Main contributors: real CLI wiring in widely-covered command files (`next.command.ts`, `next-preview.command.ts`, `register-commands.ts`); one real dependency-resolution bug found and fixed mid-milestone.
- Mitigations: every touch to shared command files is purely additive; a shared helper structurally prevents preview/apply drift; 170+ directly-impacted tests re-run green at every touch; both HF Work Units targeted real, human/review-identified gaps with minimal, isolated changes.
- Residual, accepted, documented (not defects):
  - The risk-keyword scan is negation-blind (safe-direction heuristic limitation).
  - Autonomous integration is advisory-only and does not extend to a full `ExecutionGuidance` object for candidates (no scope/suggestedFiles/dependencies/validationCommands exist on `AutonomousCandidate`) — recorded as the concrete reason, not an oversight.
  - No GitHub Actions run exists yet for this branch (workflow trigger scope, not a defect); real CI will execute for the first time at PR-open.

## Prompt/autonomous integration outcome

- **Prompt:** wired. `aiqt prompt driver`'s operating prompt now carries the four required directives (follow guidance; start from recommended context; expand only on evidence; prefer progressive validation over full-suite-by-default), reusing zero new decision logic.
- **Autonomous:** wired, advisory-only, at the one real bounded-task fit found (`buildDryRunClassificationReport` / `aiqt autonomous classify`). A full `ExecutionGuidance` reuse across the rest of the M37/M38 execution pipeline (worktree creation, sandboxed command loop, evidence binding) was inspected and correctly not forced — none of those surfaces classify a Work-Unit-shaped task the decision owner's signals are designed for, and forcing it would have required inventing signals that don't exist on those data shapes. Recommendations remain advisory throughout and never override approval/sandbox/command/network/budget policy anywhere.

## M40 entry decision

M39 is closed on its branch, with all planned WUs, both stabilization Work Units, an integrated review, and milestone-closure validation complete. Per `docs/governance/versioning.md`'s lifecycle and this milestone's own Definition of Done, **M40 — Release Governance, Risk Assessment, and Provenance — may begin only after M39 is merged and closed** (PR still pending; not opened by this closure). This report, plus the milestone tag below, prepares the branch for that PR.
