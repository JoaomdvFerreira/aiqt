<div align="center">

# AIQT

### Workflow and governance for AI coding agents

**Plan · Execute · Validate · Review · Govern**

Local-first · Provider-neutral · Resumable

[![CI](https://github.com/JoaomdvFerreira/aiqt/actions/workflows/validate.yml/badge.svg)](https://github.com/JoaomdvFerreira/aiqt/actions/workflows/validate.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

</div>

<p align="center">
  <img src="docs/assets/aiqt-workflow.svg" alt="AIQT workflow: State, Graph, Work Unit, Agent, Validate, Review" width="100%">
</p>

> **Public Preview / Active Dogfood.** AIQT's functional baseline is complete, but the CLI is pre-1.0 and is being dogfooded on real external projects. Contracts may evolve as that evidence reveals gaps; do not treat this as production/stable or 1.0 software.

## What AIQT is

AIQT is a **local CLI workflow and governance engine** for software development with AI coding agents. It is not another coding model — it owns the *workflow state, bounded work, execution guidance, validation evidence, review, controlled autonomy, and governed release/PR integration* around whatever agent (or human) is actually writing the code.

## Quick start

```bash
pnpm install --frozen-lockfile
pnpm build
node dist/index.js init
node dist/index.js plan --file my-plan.json
node dist/index.js next
```

Requirements: Node.js 24+, pnpm 7.33.5, and Git. Docker is required only for the optional sandboxed live-execution path. `pnpm build` does **not** install a global `aiqt` command and AIQT is not currently published to npm — every example below uses `aiqt` as shorthand for `node dist/index.js` run from a clone. Every command supports `--json`.

## The problem it solves

| Without workflow control | With AIQT |
|---|---|
| Huge / repeated context | Bounded execution context per Work Unit |
| Lost progress between sessions | Resumable, canonical, versioned workflow state |
| Vague agent tasks | Explicit Work Units with scope and acceptance criteria |
| Ad-hoc validation | Evidence-driven checkpoints and trust-scored evidence |
| Uncontrolled automation | Sandboxed, budget-checked, policy-gated execution |
| Silent defects | A discovered → triaged → queued → remediated defect lifecycle |
| Manual, ad-hoc GitHub pushes | Exact-SHA, fail-closed, reconciled PR integration |
| "Looks done" | Review, structural analysis, and governance evidence |

## Core execution/workflow model

```
   Human                AIQT                 Coding Agent            AIQT
 owns intent    →   owns workflow control →  owns implementation  →  validates
                                                                       progress
                                                                       & evidence
```

```bash
aiqt init                    # create the canonical .aiqt/ workflow state
aiqt update                  # capture durable project context
aiqt plan                    # ingest a structured plan into the work graph
aiqt next                    # hand out the next ready, bounded Work Unit

# → the coding agent (or a human) implements one bounded Work Unit →

aiqt checkpoint               # record the validated result (progress or terminal)
aiqt review                   # full-project integrity, quality, and structural findings
```

Canonical `.aiqt/` state, the work graph, and bounded Work Unit handoff are the product's core; everything below is built around that same loop, never a parallel state model. A `progress` checkpoint persists evidence while the Work Unit stays `in_progress` — it does not unblock dependencies or complete the Work Unit. Terminal checkpoints remain `done` or `needs_review`.

## Current capability areas

| Area | What it does |
|---|---|
| 🧭 **Canonical state & resumability** | Structured, versioned, atomically-written project/workflow state (`.aiqt/`) — the single source of truth, never markdown or chat history. |
| 📦 **Bounded Work Units & execution guidance** | `aiqt next` hands out one self-contained, scoped Work Unit at a time, with a context manifest, continuation capsule, and validation guidance tuned to what actually changed. |
| 🤖 **Controlled agent execution / handoff** | Portable external-agent handoff (branch/patch/PR-draft) or live sandboxed execution — network-denied, resource-capped, budget/command-policy-checked, escape-tested — never unattended or unbounded. |
| ✅ **Evidence & validation** | Trust-scored evidence (`unverified` → `self_reported` → `repository_local` → `platform_verified`), evidence-gate policies, and adaptive/impacted test selection that never replaces authoritative closure validation. |
| 🔍 **Structural project review** | Read-only, offline-capable structural analysis across ownership divergence, dependency coupling, responsibility concentration, dead paths, public-contract drift, test-infrastructure health, and execution-safety boundaries. |
| 🐞 **Defect discovery, triage & remediation queue** | Discovers defects from failed validation/checkpoints/human reports, triages and scores remediation risk deterministically, and hands off remediation — resolution is controlled by recorded validation evidence, not agent assertion. |
| 🚀 **Release governance & evidence** | Read-only release readiness, four-band risk assessment, provenance, and historical release reconstruction — drafts and evidence, never an automatic publish. |
| ⏰ **Background maintenance scheduling** | Persistent, timing-only schedules for structural review and defect discovery/remediation — a schedule can only narrow existing automatic-approval limits, never widen them. |
| 🗂️ **Multi-repository portfolio governance** | Explicit, read-mostly registry of AIQT-managed repositories — membership is a directory, never write authority or a batch-mutation mechanism. |
| 🔀 **Controlled Git/GitHub Pull Request integration** | Exact-SHA branch push and PR creation on a real remote — see below. |
| 🌙 **Night Audit (bounded review)** | A bounded `review night run`/`submit` session with durable coverage/session state and quality-gated GitHub Issue publication — see below. |

### Controlled Pull Request Integration

AIQT's PR integration (`aiqt pr prepare|push|create|status|validate|inspect`) may:

- **prepare** an exact repository/remote/base/source/commit-SHA binding with full read-only policy preflight;
- **push** that exact source SHA under bounded, non-force, single-ref, fast-forward-only rules, with the outcome verified by re-reading the remote rather than inferred from an exit code;
- **create or reconcile** exactly one Pull Request, draft by default, and **request reviewers** explicitly;
- **inspect / validate** status, entirely read-only.

AIQT's PR integration does **not** approve, merge, auto-merge, deploy, or publish a GitHub Release implicitly. GitHub's merge and review endpoints appear nowhere in the codebase; PR merge and Release publication remain a manual, human decision.

### Night Audit

`aiqt review night run`/`submit` is a bounded, resumable review session: it hands out small ReviewTasks, quality-gates and deduplicates reported findings, intakes them into the defect queue, and may publish an evidence-backed GitHub Issue. It is **not** a background daemon, an autonomous fixer, a source-mutating agent, or a mechanism that opens a Pull Request or merges.

## Current intentional boundaries

- Only **one Work Unit** can be active at a time today; parallel active Work Units and parallel orchestration are not supported. [Issue #25](https://github.com/JoaomdvFerreira/aiqt/issues/25) tracks that as design exploration, not shipped work.
- Remote PR/Issue integration is currently **GitHub-specific**.
- **PR merge and Release publication are human-governed** — AIQT never merges or publishes a Release automatically.
- **Autonomous issue remediation is not implemented.**
- [Issue #33](https://github.com/JoaomdvFerreira/aiqt/issues/33) is an open reliability backlog item (an intermittent, unreproduced real-Docker disk-measurement finding), not a headline product capability.

## Safety/governance boundaries

- **Evidence over assertion.** Success is recorded, verified, and trust-scored — never a self-reported claim taken at face value.
- **Fail-closed ambiguity.** An unverifiable or ambiguous outcome (a network drop mid-push, an unreadable branch-protection response, an unavailable disk measurement) blocks further action until it is reconciled from real state — it is never guessed toward success.
- **Bounded execution.** Live agent execution runs against an isolated worktree, optionally inside a network-denied, resource-capped Docker sandbox, gated by budgets, command-class policy, and explicit approval.
- **Human authority at defined risk boundaries.** Any Work Unit whose implementation risk reaches 50/100 stops for human review. Orange-or-above release/PR actions require human approval and manual merge.
- **No self-management.** AIQT never uses itself, and never writes `.aiqt/` state into its own repository, to develop AIQT.
- **Credential discipline.** Tokens are read only from an operator-named environment variable, never a flag, never persisted, never logged.

## What AIQT deliberately does not automate

- Approving, merging, or auto-merging a Pull Request;
- deploying or publishing a GitHub Release automatically;
- unconstrained autonomous software development or recursive agent swarms;
- unrestricted network access or arbitrary privileged host execution;
- silent secret discovery or credential provisioning;
- force-push, ref deletion, tag push, or any destructive Git operation;
- a generic CI/CD replacement or a general multi-user SaaS backend.

## A representative end-to-end workflow

```bash
aiqt init && aiqt update && aiqt plan --file plan.json
aiqt next                              # hand the agent one bounded Work Unit
#  ... agent implements it (handoff or sandboxed execution) ...
aiqt checkpoint                        # record validated evidence
aiqt review                            # integrity, quality, structural findings
aiqt defects discover                  # capture any failures as governed defects
aiqt defects triage <id> && aiqt defects remediate <id>
aiqt release assess                    # read-only readiness / risk / provenance
aiqt pr prepare --repository . --base main --source <branch>
aiqt pr push <integration-id>          # exact-SHA, fast-forward-only
aiqt pr create <integration-id>        # draft PR, reviewers requested
aiqt pr status <integration-id>        # reconcile, read-only
# → a human reviews and manually merges; a Release is a separate, explicit decision
```

## Current phase

Functional baseline complete → Public Preview / Active Dogfood → real-world evidence → future development based on observed gaps.

Potential future work is exploratory and evidence-driven rather than a committed numbered roadmap.

## Documentation

- 📘 [Product specification](docs/product/AIQT_Product_Specification_v0.9.md)
- 🏗️ [Technical architecture specification](docs/product/AIQT_Technical_Architecture_Specification_v0.6.md)
- ⚙️ [Governance](GOVERNANCE.md)
- 🔌 [CLI machine contract](docs/governance/cli-machine-contract.md)

The canonical product and architecture contracts live under [`docs/product/`](docs/product/); this README is a snapshot, not a specification.

## Support and security

Use [GitHub Issues](https://github.com/JoaomdvFerreira/aiqt/issues) for non-security bugs, product gaps, and ideas. Do **not** report vulnerabilities there; follow the private reporting path in [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm install
pnpm validate   # typecheck + lint + build + test + version:check
```

See [`docs/governance/versioning.md`](docs/governance/versioning.md) for versioning/release rules.

## License

Licensed under the [Apache License 2.0](LICENSE). The repository is open source; `package.json` remains `private: true` to prevent accidental npm publication.
