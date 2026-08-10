<div align="center">

# AIQT

### Workflow and governance for AI coding agents

**Plan · Execute · Validate · Review · Govern**

Local-first · Agent-agnostic · Resumable

[![CI](https://github.com/JoaomdvFerreira/aiqt/actions/workflows/validate.yml/badge.svg)](https://github.com/JoaomdvFerreira/aiqt/actions/workflows/validate.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: UNLICENSED](https://img.shields.io/badge/license-UNLICENSED-lightgrey)](package.json)

</div>

<p align="center">
  <img src="docs/assets/aiqt-workflow.svg" alt="AIQT workflow: State, Graph, Work Unit, Agent, Validate, Review" width="100%">
</p>

## What AIQT is

AIQT is a **local CLI workflow and governance engine** for software
development with AI coding agents. It is not another coding model — it
controls the *workflow state, bounded work, execution guidance, validation
evidence, review, controlled autonomy, and governed release/PR integration*
around whatever agent (or human) is actually writing the code.

## Quick start

```bash
pnpm install && pnpm build
aiqt init
aiqt plan --file my-plan.json
aiqt next
```

`aiqt next` hands your agent one bounded Work Unit at a time. Every command
supports `--json`.

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
aiqt init                   # create the canonical .aiqt/ workflow state
aiqt update                  # capture durable project context
aiqt plan                    # ingest a structured plan into the work graph
aiqt next                    # hand out the next ready, bounded Work Unit

# → the coding agent (or a human) implements one bounded Work Unit →

aiqt checkpoint               # record the validated result
aiqt review                   # full-project integrity, quality, and structural findings
```

Canonical state, the work graph, and bounded Work Unit handoff are the
product's core; everything below is built around that same loop, never a
parallel state model.

## Current major capability areas

| Area | What it does |
|---|---|
| 🧭 **Canonical state & resumability** | Structured, versioned, atomically-written project/workflow state (`.aiqt/`) — the single source of truth, never markdown or chat history. |
| 📦 **Bounded Work Units & execution guidance** | `aiqt next` hands out one self-contained, scoped Work Unit at a time, with a context manifest, continuation capsule, and validation guidance tuned to what actually changed. |
| 🤖 **Controlled agent execution / handoff** | Portable external-agent handoff (branch/patch/PR-draft) or live sandboxed execution — network-denied, resource-capped, budget/command-policy-checked, escape-tested — never unattended or unbounded. |
| ✅ **Evidence & validation** | Trust-scored evidence (`unverified` → `self_reported` → `repository_local` → `platform_verified`), evidence-gate policies, and adaptive/impacted test selection that never replaces authoritative closure validation. |
| 🚀 **Release governance & evidence** | Read-only release readiness, four-band risk assessment, provenance, and historical release reconstruction — drafts and evidence, never an automatic publish. |
| 🐞 **Defect discovery, triage & remediation queue** | Discovers defects from failed validation/checkpoints/human reports, triages and scores remediation risk deterministically, and hands off remediation — resolution is controlled by recorded validation evidence, not agent assertion. |
| 🔍 **Structural project review** | Read-only, offline-capable structural analysis across ownership divergence, dependency coupling, responsibility concentration, dead paths, public-contract drift, test-infrastructure health, and execution-safety boundaries. |
| 🕰️ **Historical release reconstruction** | Reconstructs evidence-backed release status for tags that predate current release governance, without fabricating a release that never happened. |
| ⏰ **Background maintenance scheduling** | Persistent, timing-only schedules for structural review and defect discovery/remediation — a schedule can only narrow existing automatic-approval limits, never widen them. |
| 🗂️ **Multi-repository portfolio governance** | Explicit, read-mostly registry of AIQT-managed repositories — membership is a directory, never write authority or a batch-mutation mechanism. |
| 🔀 **Controlled Git/GitHub Pull Request integration** | Exact-SHA branch push and PR creation on a real remote — see below. |

### Controlled Pull Request Integration

AIQT's PR integration (`aiqt pr prepare|push|create|status|validate|inspect`)
may:

- **prepare** an exact repository/remote/base/source/commit-SHA binding with
  full read-only policy preflight;
- **push** that exact source SHA under bounded, non-force, single-ref,
  fast-forward-only rules, with the outcome verified by re-reading the
  remote rather than inferred from an exit code;
- **create or reconcile** exactly one Pull Request, draft by default;
- **request reviewers** explicitly, with reviewer-assignment failure
  recoverable as a typed partial state, never a duplicate PR;
- **inspect / validate** status, entirely read-only.

AIQT's PR integration does **not**:

- approve a Pull Request;
- merge or auto-merge;
- deploy;
- publish a GitHub Release implicitly.

GitHub's merge and review endpoints appear nowhere in the codebase.

## Safety/governance boundaries

- **Evidence over assertion.** Success is recorded, verified, and trust-scored — never a self-reported claim taken at face value.
- **Fail-closed ambiguity.** An unverifiable or ambiguous outcome (a network drop mid-push, an unreadable branch-protection response) blocks further action until it is reconciled from real state — it is never guessed toward success.
- **Bounded execution.** Live agent execution runs against an isolated worktree, optionally inside a network-denied, resource-capped Docker sandbox, gated by budgets, command-class policy, and explicit approval.
- **Human authority at defined risk boundaries.** Any Work Unit whose implementation risk reaches 50/100 always stops for human review, regardless of milestone classification. Orange-or-above release/PR actions require human approval and manual merge.
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

A repository previously carried an automated `approved-for-merge` label plus
auto-merge workflow, twice, and both attempts were removed after review —
merging in this repository is, and remains, a manual human action. There is
no automatic-merge capability in AIQT today.

## A representative end-to-end workflow

```bash
aiqt init && aiqt update && aiqt plan --file plan.json
aiqt next                        # hand the agent one bounded Work Unit
#  ... agent implements it (handoff or sandboxed execution) ...
aiqt checkpoint                  # record validated evidence
aiqt review                      # integrity, quality, structural findings
aiqt defects discover            # capture any failures as governed defects
aiqt defects triage <id> && aiqt defects remediate <id>
aiqt release assess              # read-only readiness / risk / provenance
aiqt pr prepare --repository . --base main --source <branch>
aiqt pr push <integration-id>    # exact-SHA, fast-forward-only
aiqt pr create <integration-id>  # draft PR, reviewers requested
aiqt pr status <integration-id>  # reconcile, read-only
# → a human reviews and manually merges; a Release is a separate, explicit decision
```

## Roadmap

```
✅ M40  Release Governance, Risk Assessment & Provenance
✅ M41  Adaptive Test Selection & Feedback Acceleration
✅ M42  Defect Discovery, Triage & Remediation Queue
✅ M43  Project Structural Review & Issue Discovery
✅ M44  Historical Release Reconstruction
✅ M45  Background Maintenance Scheduling
✅ M46  Multi-Repository Portfolio Governance
✅ M47  Controlled Pull Request Integration
🔎  —   M47 Execution-Efficiency Postmortem (analytical process input, not a numbered milestone)
▶  M48  Night Project Review & Issue Generation — bounded overnight review, evidence-backed GitHub Issues, no code fixes/PRs/merges
○  M49  Cost-Aware Execution Profiles & Escalation — stable milestone-level execution baseline, bounded escalation for genuinely hard reasoning
○   —   Human-directed issue-to-remediation workflow — uncommitted future candidate, pending real M48 usage; autonomous remediation remains deferred until real usage demonstrates a need
```

## Documentation

- 📘 **Product** — [`docs/product/`](docs/product/)
- 🏗️ **Architecture** — [`docs/product/`](docs/product/)
- ⚙️ **Governance** — [`docs/governance/`](docs/governance/)
- 🗺️ **Milestones** — [`docs/milestones/`](docs/milestones/)

The canonical product and architecture contracts live in
[`docs/product/`](docs/product/); this README is a snapshot, not a
specification. Machine-readable CLI/JSON contracts are documented at
[`docs/governance/cli-machine-contract.md`](docs/governance/cli-machine-contract.md).
Every command supports `--json`.

## Development

```bash
pnpm install
pnpm validate   # typecheck + lint + build + test + version:check
```

See [`docs/governance/versioning.md`](docs/governance/versioning.md) for
versioning/release rules and [`SECURITY.md`](SECURITY.md) for the security
policy.

---

<div align="center">

UNLICENSED — see <a href="package.json">package.json</a>

</div>
</content>
