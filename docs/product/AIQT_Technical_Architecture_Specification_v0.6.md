# AIQT Technical Architecture Specification v0.6

**Local-First Workflow, Execution & Governance Architecture**

| Field | Value |
|---|---|
| Status | Implementation-aligned public-preview baseline |
| Aligns with | Product Specification v0.9 |
| Canonical schema baseline | `AIQT_SCHEMA_VERSION` `0.10.0` |
| Supersedes | Technical Architecture Specification v0.5 |

## Architecture

```text
CLI -> commands/results -> orchestration services -> workflow/evidence/policy
                                                -> canonical persistence/external adapters
```

Canonical project state remains structured and versioned. `project.json` and `state.json` are operational truth; runlog entries are append-only evidence. `AIQT_SCHEMA_VERSION` and `package.json.version` remain independent contracts.

## Workflow and checkpoint lifecycle

The work graph has a single active Work Unit invariant. Readiness, current-work ownership, continuation, and terminal dependency transitions derive from that invariant.

Checkpoints use a disposition:

- `progress` persists evidence with a null final Work Unit status and retains the current Work Unit as `in_progress`;
- `terminal` uses `done` or `needs_review`, performs the normal terminal lifecycle, and remains compatible with legacy terminal checkpoint records.

Progress does not ready dependent Work Units or recalculate milestone completion. It is a durable resumability boundary, not a second active-work model.

## M42 and M48 ownership

M42 defect authority owns durable defect identity, deterministic triage, remediation risk, and GitHub Issue projection. Discovery does not authorize remediation.

M48 Night Audit owns bounded review-session orchestration, coverage ledger state, and a nullable active-session claim. It runs as explicit `run`/`submit` rounds; it is not a background daemon. Its only external mutation is constrained GitHub Issue creation after quality, deduplication, and backlog checks. It has no source-modification, PR, merge, or issue-edit/close capability.

## Boundaries and invariants

- Human-readable and JSON results derive from shared decision data.
- External writes are exact, bounded, and reconciled from observed provider state; ambiguity blocks retry.
- Human approval controls risk boundaries; PR merge and Release publication are separate human-governed actions.
- Provider-specific execution remains behind adapters; automatic model routing and parallel/multi-agent orchestration are not part of current architecture.
- AIQT does not create `.aiqt/` state to govern development of this repository.

## Evolution

The functional architecture is complete for the public-preview baseline. Future work is evidence-driven and must preserve the state-first, bounded-authority, and single-active-Work-Unit invariants unless an explicit future design changes them.
