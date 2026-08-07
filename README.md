# AIQT

AIQT is a local, deterministic **workflow state engine** for AI-assisted
software delivery, shipped as a CLI (`aiqt`). It gives an AI coding agent (or
a human driving one) a single, canonical, git-committed source of truth for a
project's plan, work units, checkpoints, evidence, and review state, plus a
policy-gated path to sandboxed autonomous execution.

## Why AIQT

Long AI-assisted projects tend to lose track of what's actually been
verified: a work unit gets marked "done" without evidence, a checkpoint gets
silently re-litigated, dependency readiness drifts from reality. AIQT makes
that impossible by construction: one canonical state file plus an
append-only runlog, deterministic dependency readiness, evidence-aware
completion gates, and read-only-by-default inspection commands.

## Current Capabilities

- **Canonical workflow state** — `.aiqt/state.json` (current operational
  authority) plus an append-only runlog (historical audit trail); every
  mutation is atomic, state-then-runlog, and idempotent on retry.
- **Work graph and packets** — plans decompose into a dependency-aware work
  graph; `aiqt next` hands out one well-formed agent packet at a time.
- **Evidence-gated checkpoints** — optional policies require real, bounded,
  typed evidence before a checkpoint completes, with advisory (non-blocking)
  and required (blocking) modes, scoped/expiring exceptions, and recovery
  paths.
- **External execution adapters** — a vendor-neutral execution
  request/result contract, plus a data-only Claude Code stream-json adapter.
- **Autonomous and sandboxed execution** — policy-checked autonomous runs
  against isolated Git worktrees, with an opt-in, Docker-backed sandbox
  (network-denied, resource-capped, escape-tested) for live command
  execution. See [Autonomous / Controlled Execution](#autonomous--controlled-execution).
- **Read-only inspection** — `status`, `review`, `manage`, and `export` never
  mutate state.

## Workflow

1. **`aiqt init`** — creates `.aiqt/` in the current repository.
2. **`aiqt update`** — captures durable project context.
3. **`aiqt plan`** — ingests a structured plan into the canonical work graph.
4. **`aiqt next`** — hands out the next ready work unit as an agent packet.
5. An agent (human-directed or automated) does the work.
6. **`aiqt checkpoint`** — records the result; evidence gates can block or
   downgrade the outcome based on real evidence.
7. **`aiqt review`** / **`aiqt status`** / **`aiqt manage`** / **`aiqt
   export`** — read-only integrity, workflow, and reporting views.

## Quick Start

```bash
pnpm install
pnpm build
aiqt init
aiqt plan --file my-plan.json
aiqt next
```

Every command supports `--json` for machine-readable output. See
[`docs/governance/cli-machine-contract.md`](docs/governance/cli-machine-contract.md)
for the exact result shape, exit-code table, and stream policy.

## Main Commands

```
aiqt init                        Initialize a new AIQT project
aiqt update                      Capture durable project context
aiqt plan                        Ingest a structured plan into the work graph
aiqt next                        Get the next ready work unit as an agent packet
aiqt checkpoint / amend          Record / amend a work unit's execution result
aiqt review                      Full-project integrity and quality findings
aiqt status / manage / export    Read-only inspection and reporting
aiqt prompt start / continue     Generate a copy-paste prompt for an external agent
aiqt issue list / update / promote
                                  Inspect and manage the issue lifecycle
aiqt graph validate / repair     Validate and deterministically repair the work graph
aiqt evidence import             Import external evidence from a bounded JSON format
aiqt evidence gate policy / simulate / advisory / enforcement / exception
                                  Evidence-gate policy management, simulation, and governance
aiqt workspace prepare / status / release / recover
                                  Managed local Git workspace bindings per work unit
aiqt execution import / status / external ... / adapter claude-code ...
                                  Execution session protocol and vendor-neutral adapters
aiqt autonomous inspect / classify / approve / run / status / cancel / result / cleanup / agent-import
                                  Autonomous run lifecycle and sandboxed live execution
```

Run `aiqt --help` (or `aiqt <command> --help`) for the full, current list —
this table is illustrative, not exhaustive.

## Autonomous / Controlled Execution

AIQT can run a policy-checked command loop against an isolated Git worktree
(`aiqt autonomous run`), and — opt-in only, via `--live` plus a standing
operator config flag — inside a Docker-backed sandbox with no network
access, capped CPU/memory/disk/process resources, and escape-tested
isolation. AIQT itself never spawns an ad-hoc process, shell, or network
request outside these explicit, policy-gated paths, and never invokes a
coding model directly. See the M36–M38 milestone records under
[`docs/milestones/completed/`](docs/milestones/completed/) for the contract,
threat model, and pilot evidence.

## Safety and Governance

- **State-first, runlog-second, always.**
- **Read-only stays read-only** for `status`/`review`/`manage`/`export`/
  `--preview`/simulation paths.
- **No silent bypass** — evidence and enforcement gates only have exact,
  scoped, expiring, auditable exceptions, never a generic force/skip flag.
- **No hidden runtime surface** — no ad-hoc process/shell/network/dynamic
  plugin outside the explicit, policy-gated autonomous/sandbox paths above.
- **Grandfathering, not retroactive punishment** for stricter evidence
  requirements.
- **One engine per concern** — readiness, evidence simulation, checkpoint
  completion, and issue lifecycle each have exactly one implementation.

## Documentation

- [`docs/product/`](docs/product/) — product specifications (MVP, technical
  architecture).
- [`docs/governance/`](docs/governance/) — milestone protocol, versioning
  policy, repository owner map, CLI machine contract, and other durable
  repository governance.
- [`docs/milestones/`](docs/milestones/) — per-milestone build
  specifications and closure reports (`completed/`, `active/`).
- [`GOVERNANCE.md`](GOVERNANCE.md) — repository-level process notes.
- [`AGENTS.md`](AGENTS.md) — instructions for coding agents working on this
  repository (this repository is AIQT's own product, developed with
  ordinary Git/CI governance, not with AIQT itself).

## Roadmap

- **M38 — Sandboxed Live Agent Execution — Closed.**
- **M39 — Agent Execution Efficiency and Context Control — Next.**
- **M40 — Release Governance, Risk Assessment, and Provenance.**
- **M41 — Adaptive Test Selection and Feedback Acceleration.**
- **M42 — Defect Discovery, Triage, and Remediation Queue.**
- **M43 — Project Structural Review and Issue Discovery.**
- **M44 — Historical Release Reconstruction.**
- **M45 — Background Maintenance Scheduling.**
- **M46 — Multi-Repository Portfolio Governance.**
- **M47 — Controlled Pull Request Integration.**

## Development Status

AIQT is under active, spec-driven development. Each milestone is delivered
against a written build specification, decomposed into small, independently
committed and tagged Work Units, and closed only after full local
validation and a green real CI run on the supported Node.js version (see
`package.json#engines`).

```bash
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint .
pnpm build          # tsc -- must run before `test` so dist/ exists for
                     # tests/integration/built-binary-smoke.test.ts
pnpm test           # vitest run
pnpm validate       # typecheck + lint + build + test + version:check,
                     # in this order -- the same sequence CI runs
```

`pnpm validate` is the single authoritative local validation command; CI
(`.github/workflows/validate.yml`) runs the identical sequence.
See [`docs/governance/versioning.md`](docs/governance/versioning.md) for
this project's semantic versioning and release-tagging rules, and
[`SECURITY.md`](SECURITY.md) for the security policy.

## License

UNLICENSED — see [`package.json`](package.json).
