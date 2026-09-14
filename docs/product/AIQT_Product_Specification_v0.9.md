# AIQT Product Specification v0.9

**Local-First AI Workflow & Governance Engine**

| Field | Value |
|---|---|
| Status | Implementation-aligned public-preview baseline |
| Package baseline | `0.46.0` at reconciliation; public-readiness patch `0.46.2` |
| Canonical schema baseline | `AIQT_SCHEMA_VERSION` `0.10.0` |
| Supersedes | Product Specification v0.8 |

## Purpose and current phase

AIQT turns project intent into canonical state, bounded Work Units, agent-ready guidance, validation evidence, review, and governed integration decisions. It is local-first and provider-neutral.

The functional baseline is complete. AIQT is in **Public Preview / Active Dogfood**: real external-project use supplies evidence for future work, and its pre-1.0 contracts may evolve in response. This specification describes shipped behaviour, not a committed numbered roadmap.

## Core workflow

```text
state -> graph -> bounded Work Unit -> guidance -> evidence -> checkpoint/review
```

Canonical `.aiqt/` state is the operational source of truth; markdown and chat history are not substitutes.

One Work Unit may be active at a time. That invariant keeps ownership, continuation, checkpoint transitions, and dependency readiness deterministic. External work may occur in parallel, but canonical lifecycle progression remains serialized. Multi-active-Work-Unit execution is design exploration, not a shipped capability.

## Checkpoints

A checkpoint records evidence at a durable boundary.

- A `progress` checkpoint records intermediate evidence while the Work Unit remains `in_progress`.
- Progress checkpoints have no terminal final Work Unit status, do not unblock dependencies, and do not recalculate milestone completion.
- Terminal checkpoints retain `done` and `needs_review` outcomes and remain backward compatible.

## Shipped capability areas

- canonical state, graph planning, bounded guidance, continuation, and validation evidence;
- controlled agent handoff/live execution with safety and approval boundaries;
- structural review, defect discovery/triage, release readiness, and exact-SHA GitHub PR integration;
- M48 Night Audit: bounded, resumable review sessions with durable coverage/session state, quality-gated defect intake, and narrowly bounded GitHub Issue creation.

Night Audit is invoked through explicit `run`/`submit` rounds. It is not an automatic background daemon, does not modify source, and does not create PRs or merge.

## Product boundaries

AIQT does not provide automatic PR approval/merge, Release publication, autonomous issue remediation, generic CI/CD replacement, unrestricted execution, or parallel Work Unit orchestration. GitHub is the current remote PR/Issue provider.

## Evidence-driven evolution

Future development is selected from observed product gaps and user evidence. Candidate areas may be discussed, but no M49/M50 or parallel-execution commitment is implied by this specification.
