# AIQT

AIQT is a local, deterministic **workflow state engine** for AI-assisted
software delivery, shipped as a CLI (`aiqt`). It gives an AI coding agent (or
a human driving one) a single, canonical, git-committed source of truth for a
project's plan, work units, checkpoints, evidence, and review state — so that
"is this work unit actually done, and can I prove it?" always has one
unambiguous answer.

AIQT does not write code, run your tests, or talk to any AI provider on your
behalf. It manages the *bookkeeping and gating* around that work: turning a
plan into a dependency-aware work graph, handing out one well-formed work
packet at a time, recording checkpoints, evaluating evidence against
configurable policies, and refusing to let inconsistent or unverified state
slip through.

## Why

Long AI-assisted projects tend to lose track of what's actually been
verified: a work unit gets marked "done" without evidence, a checkpoint gets
silently re-litigated, dependency readiness drifts from reality. AIQT's job
is to make that impossible by construction:

- **One canonical state file** (`.aiqt/state.json`) plus an **append-only
  runlog** — state is the current operational authority, the runlog is the
  historical audit trail. Every mutation is atomic, ordered state-then-runlog,
  and idempotent on retry.
- **Deterministic dependency readiness** — a work unit only becomes available
  when its declared dependencies are genuinely satisfied, recalculated the
  same way every time.
- **Evidence-aware completion** — optional policies can require real,
  bounded, typed evidence (tests, scans, external reports) before a
  checkpoint is allowed to complete, with advisory (non-blocking) and
  required (blocking) modes, false-positive feedback loops, scoped
  exceptions, and full recovery/rollback paths.
- **Everything else is read-only and additive** — status, review, export,
  and manager reports never mutate state; they only observe it.

## How it works

1. **`aiqt init`** — creates `.aiqt/` in the current repository.
2. **`aiqt update`** — captures durable project context (tech stack, goals,
   constraints).
3. **`aiqt plan`** — ingests a structured plan (milestones, work units,
   dependencies, acceptance criteria) into the canonical work graph.
4. **`aiqt next`** — hands out the next ready work unit as a self-contained
   agent packet (objective, scope, acceptance criteria, suggested files,
   validation commands).
5. An agent (human-directed or automated) does the work.
6. **`aiqt checkpoint`** — records the acceptance/validation result for the
   current work unit's execution cycle. If an evidence gate is active, the
   checkpoint's outcome can be blocked or downgraded based on real evidence.
7. **`aiqt review`** — evaluates the whole project for integrity, workflow,
   context, and quality findings; **`aiqt status`** / **`aiqt manage`** /
   **`aiqt export`** give read-only views for a human or a dashboard.

Everything above happens locally, against files in your own repository. AIQT
never runs a shell command on your behalf, never makes a network request,
never invokes an AI provider, and never touches your git branches beyond
reading/committing the `.aiqt/` state it owns.

`aiqt update` is replay-safe for project context records. Requirements,
decisions, assumptions, risks, and open questions resolve identity in this
order: explicit canonical `id`, stable `clientKey`, then a deterministic
content fingerprint over the record's semantic fields. Reapplying the same
prompt-generated update JSON is therefore a no-op; changing content without
an `id` or `clientKey` creates an intentionally distinct record.

When a command writes canonical state and appends runlog events, state is
written first and remains authoritative. If the runlog append fails, AIQT
returns a `CANONICAL-RUNLOG-GAP` diagnostic instead of a generic failure; the
retry path is deterministic and must not duplicate already-persisted state.

## Command surface (selected)

```
aiqt init                        Initialize a new AIQT project
aiqt update                      Capture durable project context
aiqt plan                        Ingest a structured plan into the work graph
aiqt next                        Get the next ready work unit as an agent packet
aiqt checkpoint / amend          Record / amend a work unit's execution result
aiqt review                      Full-project integrity and quality findings
aiqt status / manage / export    Read-only inspection and reporting
aiqt prompt                      Generate a copy-paste prompt for an external agent
aiqt issue list / update / promote
                                  Inspect and manage the issue lifecycle
aiqt graph validate / repair     Validate and deterministically repair the work graph
aiqt evidence import             Import external evidence from a bounded JSON format
aiqt evidence gate policy ...    Manage and simulate evidence-gate policies (read-only)
aiqt evidence gate advisory ...  Non-blocking advisory evidence visibility
aiqt evidence gate enforcement . Required (blocking) evidence enforcement, profiles,
                                  recovery proofs, and governed activation
aiqt evidence gate exception ... Scoped, expiring exceptions to required evidence
aiqt workspace prepare / status / release / recover
                                  Managed local Git workspace bindings per work unit
aiqt execution import / status   Long-running execution session protocol
aiqt execution external ...      Vendor-neutral generic execution request/result contract
aiqt execution adapter claude-code ...
                                  Optional Claude Code stream-json adapter (data-only)
```

Run `aiqt --help` (or `aiqt <command> --help`) for the full, current list —
this table is illustrative, not exhaustive.

Every command supports `--json` for machine-readable output. See
[`docs/engineering/cli-machine-contract.md`](docs/engineering/cli-machine-contract.md)
for the exact result shape, exit-code table, and stream policy an agent or
script can rely on.

## Design principles

- **State-first, runlog-second, always.** Every canonical mutation writes
  `state.json` before appending the runlog event; a runlog-append failure
  never leaves state inconsistent, and a retry is a safe no-op.
- **Read-only stays read-only.** `status`, `review`, `manage`, `export`, and
  every `--preview`/simulation path never mutate canonical state.
- **No silent bypass.** Evidence and enforcement gates never have a generic
  force/skip/ignore flag — only exact, scoped, expiring, auditable
  exceptions for rules explicitly marked eligible.
- **No hidden runtime surface.** AIQT's own workflow logic never spawns a
  process, shell, or network request, and never loads a dynamic
  plugin/policy at runtime — everything it evaluates is data it was
  explicitly given.
- **Grandfathering, not retroactive punishment.** Turning on stricter
  evidence requirements never reverses work that was already validly
  completed under the rules in force at the time.
- **One engine per concern.** Readiness, evidence simulation, checkpoint
  completion, and issue lifecycle each have exactly one implementation,
  reused everywhere they apply rather than re-implemented per feature.

## Project status

AIQT is under active, spec-driven development. Each milestone is delivered
against a written build specification, decomposed into small, independently
committed and tagged Work Units, and closed only after full local validation,
a clean-clone rebuild, and a green real CI run on the supported Node.js
matrix (see `package.json#engines`). Milestone specifications live in
[`docs/`](docs/); engineering process and governance notes live in
[`docs/engineering/`](docs/engineering/) and [`GOVERNANCE.md`](GOVERNANCE.md).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run
pnpm build       # tsc
pnpm validate    # typecheck + lint + test + version:check
```

See [`docs/versioning.md`](docs/versioning.md) for this project's semantic
versioning and release-tagging rules, and [`SECURITY.md`](SECURITY.md) for
the security policy.

## License

UNLICENSED — see [`package.json`](package.json).
