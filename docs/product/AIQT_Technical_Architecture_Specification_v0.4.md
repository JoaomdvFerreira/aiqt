# AIQT Technical Architecture Specification v0.4

**Local-First Workflow, Execution & Governance Architecture**

| Field | Value |
|---|---|
| Product | AIQT CLI |
| Specification | Technical Architecture Specification |
| Version | v0.4 |
| Aligns With | AIQT Product Specification v0.7 |
| Supersedes | Technical Architecture Specification v0.3 as the active architecture baseline |
| Status | Implementation-aligned architecture through M40 |
| Architecture Positioning | Local-first workflow, execution, evidence, and governance engine |
| Primary Runtime | Node.js 24 + TypeScript CLI |
| Canonical Schema Baseline | AIQT_SCHEMA_VERSION `0.5.0` |

## 1. Purpose

This document defines the stable technical architecture of AIQT after the product evolved beyond the original MVP implementation plan.

The architecture remains centered on a local structured workflow state engine, but now includes first-class execution guidance, evidence, bounded autonomous execution, sandboxed live execution, and release governance.

This document intentionally describes **stable architectural ownership and invariants**, not an exact repository file tree. Exact physical ownership belongs in the maintained repository owner map and live codebase.

The baseline is implementation-aligned through M40. M41 Adaptive Test Selection is treated as forward evolution and is not assumed to exist in this architecture unless explicitly marked.

## 2. v0.4 Architecture Change Summary

Compared with v0.3, v0.4:

- preserves the canonical state-first architecture and schema/package version separation;
- replaces the early milestone-oriented physical file tree with stable architectural layers;
- updates the official runtime contract to Node.js 24;
- recognizes the unified command-result/output contract introduced after the original MVP;
- adds Execution Guidance as a shared domain service;
- adds evidence and provenance as first-class architectural concerns;
- adds controlled autonomous execution and sandboxed live execution while preserving external request/import as a safe fallback;
- adds release-candidate, risk, approval-authority, and draft-release architecture;
- formalizes provider neutrality and secret-minimizing integrations;
- formalizes progressive validation and authoritative CI boundaries;
- keeps adaptive impacted-test discovery outside the through-M40 baseline;
- explicitly separates schema version, package version, milestone provenance, and product release identity.

## 3. Architectural Principles

### 3.1 State first

`project.json` and `state.json` are operational canonical state. `runlog.jsonl` is append-only history/evidence. Generated markdown is never required as a second workflow database.

### 3.2 Bounded domain decisions

Planning, readiness, execution guidance, safety classification, validation, release risk, and approval authority should have explicit owners. Equivalent callers must not reproduce divergent decision logic.

### 3.3 Fail closed

When required state, evidence, permissions, sandbox capabilities, provenance, credentials, or policy inputs are missing, high-impact operations must block rather than silently broaden permissions or infer success.

### 3.4 Provider-neutral core

Canonical contracts describe generic agent/reasoning/execution concepts. Provider-specific invocation belongs behind adapters and configuration.

### 3.5 Human and machine parity

Human-readable output and JSON output should be rendered from the same command/result data. Human convenience must not bypass machine contract semantics.

### 3.6 Evidence over assertion

A command result should distinguish what is proven, inferred, pending, blocked, or externally unverifiable.

### 3.7 Lean public surface

The CLI should use coherent capability families. Internal architectural breadth must not force uncontrolled top-level command growth.

## 4. Logical Architecture

```text
CLI / Parser Layer
        |
        v
Command & Result Layer
        |
        v
Application / Orchestration Services
        |
        +-------------------------------+
        |               |               |
        v               v               v
Workflow Domain   Execution Domain   Release Domain
        |               |               |
        +-------+-------+-------+-------+
                |
                v
Evidence / Policy / Validation Services
                |
        +-------+----------------+
        |                        |
        v                        v
Canonical Persistence      External Adapters
(project/state/runlog)     (Git, process, sandbox, GitHub, agent)
```

### 4.1 CLI / Parser Layer

Responsibilities:

- command registration and option parsing;
- interactive/non-interactive boundary where explicitly supported;
- no domain decision duplication;
- route all meaningful outcomes through the common result contract;
- preserve deterministic JSON mode.

### 4.2 Command & Result Layer

Responsibilities:

- map domain outcomes to the established command-result contract;
- centralize exit-code semantics;
- route human, JSON, and stream output consistently;
- prevent raw-output bypasses for governed command outcomes.

### 4.3 Application / Orchestration Layer

Responsibilities:

- load validated state and configuration;
- invoke domain owners in a bounded sequence;
- coordinate mutations, side effects, and evidence;
- enforce preconditions and idempotency/freshness where applicable;
- avoid embedding rendering logic.

### 4.4 Domain Services

Stable domain areas include:

- project/context capture;
- planning/work graph;
- next-action/work-unit selection;
- checkpoint/review/management;
- Execution Guidance;
- autonomous candidate and safety classification;
- execution lifecycle/evidence;
- release candidate/readiness/risk/approval.

### 4.5 Persistence and Adapter Layer

Persistence owns canonical `.aiqt` state. Adapters own interactions with Git, subprocesses, sandbox backends, coding agents, and GitHub. Domain services should not directly depend on provider-specific implementation details.

## 5. Runtime and Tooling Policy

| Area | Decision |
|---|---|
| Runtime | Node.js 24 official runtime |
| Node.js 22 | Unsupported by the current official support policy |
| Package manager | pnpm |
| Module format | ESM |
| Language | TypeScript |
| CLI framework | commander |
| Schema validation | zod |
| Testing | vitest plus integration/built-binary/fixture coverage as applicable |
| Canonical package version | `package.json.version` |
| Canonical file schema version | `AIQT_SCHEMA_VERSION` |

Dependencies should remain minimal. New libraries require a concrete product or reliability need.

## 6. Canonical Persistence Architecture

```text
.aiqt/
  project.json
  state.json
  runlog.jsonl
  exports/
```

### 6.1 `project.json`

Durable project knowledge, including objective, users, context, requirements, decisions, risks, assumptions, quality expectations, and integration configuration that belongs in canonical project state.

### 6.2 `state.json`

Workflow state, including project status, dynamic work graph, current pointers, checkpoints, packet metadata, and other canonically persisted workflow records introduced by schema-governed features.

### 6.3 `runlog.jsonl`

Append-only event history. Each valid line is one event object. Individual malformed lines may degrade runlog health without corrupting otherwise valid operational state, according to established runlog rules.

### 6.4 `exports/`

Generated views only. Exports must not be required to resume operational workflow.

### 6.5 Write safety

Canonical mutation should preserve:

- schema validation;
- current-version compatibility checks;
- atomic/safe writes;
- stable IDs;
- unknown-section preservation where the compatibility model permits it;
- mutation recovery and failure visibility;
- append-only runlog semantics.

## 7. Schema and Version Compatibility

Canonical files use camelCase field names and are versioned by `AIQT_SCHEMA_VERSION`.

```text
AIQT_SCHEMA_VERSION = "0.5.0"   // current canonical schema baseline
package.json.version            // distributed package version
```

The architecture must never use package version as a substitute for canonical schema version.

Version handling must distinguish at least:

| Case | Required behavior |
|---|---|
| Current supported schema | Proceed |
| Older compatible schema | Proceed only under explicit compatibility/migration rules |
| Unsupported future schema | Block with upgrade guidance |
| Missing/invalid version | Block |
| Malformed canonical JSON | Block |

Schema evolution must be deliberate and compatibility-tested.

## 8. Command Result and Exit Semantics

The architecture uses a common result contract for meaningful command outcomes. The exact TypeScript shape may evolve additively, but the conceptual fields remain:

- status;
- action;
- workflow/project position where relevant;
- summary;
- completed actions;
- changed/affected items;
- blocking issues;
- warnings;
- human-input requirement;
- next recommendation;
- typed command-specific data;
- exit code.

### 8.1 Exit codes

The established semantic classes remain:

| Code | Meaning |
|---:|---|
| 0 | Success |
| 1 | Validation/review failure |
| 2 | Workflow action blocked |
| 3 | Invalid command/input/state or incompatible/malformed canonical state |
| 4 | Missing dependency required for the requested action |
| 5 | External integration error |
| 10 | Human input required |

New command families should reuse these meanings rather than inventing ad-hoc process semantics.

## 9. Workflow Domain Architecture

The workflow domain owns:

- command preconditions;
- status transitions;
- dynamic work-graph readiness;
- next Work Unit selection;
- checkpoint transitions;
- review/management classification;
- next recommended action.

Core workflow state remains independent from terminal rendering.

### 9.1 Dynamic graph invariants

- any number of milestones and Work Units;
- stable entity IDs;
- explicit dependency edges;
- deterministic readiness where evidence is sufficient;
- history preserved through replanning;
- no file-per-milestone persistence model.

## 10. Execution Guidance Architecture

Execution Guidance is a shared deterministic domain owner introduced to reduce repeated context and unnecessary execution effort.

Logical output includes:

```text
complexity
reasoning effort
agent class
context profile / manifest
continuation capsule
validation guidance
output policy
subagent guidance
```

### 10.1 Ownership

Equivalent surfaces such as preview, next/handoff, prompt guidance, and applicable bounded autonomous classification should reuse the shared guidance owner instead of implementing independent heuristics.

### 10.2 Context selection

Context selection must:

- preserve mandatory Work Unit objective/scope/out-of-scope/acceptance criteria;
- prioritize explicit context references and suggested files;
- remain path-safe and budgeted;
- expand only when evidence is insufficient;
- exclude raw chat history as canonical context;
- preserve a compact continuation capsule from durable execution evidence.

### 10.3 Model guidance

Canonical output uses generic reasoning/agent classes. Concrete provider/model labels are operator mappings. No billing/quota API or automatic provider switching is required by the baseline.

## 11. Evidence and Provenance Architecture

Evidence is a cross-cutting architectural layer.

Evidence records should be bound to the thing they prove, for example:

```text
candidate
+ base commit
+ approvals
+ permissions/budgets
+ execution result
+ diff/final commit
+ validation
+ review findings
= bounded evidence packet
```

For release candidates:

```text
release intent
+ included milestone provenance
+ candidate commit/version
+ CI evidence
+ readiness findings
+ risk assessment
= release decision evidence
```

Important architectural rules:

- stale approvals are rejected when their bound inputs change;
- candidate freshness/provenance mismatch blocks governed side effects;
- evidence must not claim external success that was not actually verified;
- success and failure both retain enough information for audit/recovery.

## 12. Controlled Autonomous Execution Architecture

The autonomous execution capability evolved in stages but should be understood as one bounded architecture.

```text
candidate input
  -> preflight
  -> deterministic safety classification
  -> approval when required
  -> workspace preparation
  -> bounded execution adapter
  -> validation
  -> self-review
  -> evidence/result
  -> human integration decision
```

### 12.1 Public phases

The current public family exposes distinct phases rather than one opaque operation, including representative commands:

```text
inspect
classify
approve
run
status
cancel
result
cleanup
```

This separation makes candidate, policy, approval, execution state, and evidence visible.

### 12.2 Request/import fallback

Externally executed request/import remains a permanent lower-risk path. It must not be removed merely because live execution is available.

### 12.3 Agent adapters

Provider-specific behavior stays behind a bounded adapter contract. The adapter receives only approved context, policies, budgets, and environment projection.

The adapter must not expose an automatic merge/deploy primitive.

## 13. Sandboxed Live Execution

Live agent execution is allowed only when the selected sandbox backend can enforce the required boundary.

Required capability categories include:

- filesystem isolation;
- process-tree ownership;
- environment minimization;
- network policy;
- resource limits;
- deterministic cancellation;
- output limits/capture;
- cleanup and evidence.

Core invariant:

```text
No live agent process runs when the required sandbox guarantees
cannot be enforced by the selected backend.
```

No silent fallback to unsandboxed execution is permitted.

The sandbox architecture must distinguish supported-host guarantees from unsupported-platform behavior and must not claim parity without equivalent enforcement.

## 14. Policy, Budgets, and Human Approval

Controlled execution and release operations use explicit policy rather than implicit agent permission.

Policy may cover:

- command classes;
- network access;
- filesystem/worktree boundaries;
- wall-clock/command/resource budgets;
- approval requirements;
- retry permissions;
- cleanup behavior.

Human approval remains required where the governing risk/policy contract says it is required. Low-risk automation is permitted only when policy explicitly allows it.

## 15. Release Governance Architecture

Release governance is a domain family, not a side effect of milestone closure.

### 15.1 Candidate architecture

A release candidate represents explicit release intent and binds included milestone provenance to a candidate repository/version/CI snapshot.

No candidate should be silently created merely because a milestone is complete.

### 15.2 Readiness

Readiness answers whether the candidate evidence is internally sufficient and consistent. It is separate from approval authority.

### 15.3 Deterministic risk

The four-band model is:

| Score | Status | Authority |
|---:|---|---|
| 0-24 | Green | Agent/automation permitted |
| 25-49 | Yellow | Agent/automation permitted |
| 50-74 | Orange | Human approval required |
| 75-100 | Red | Human approval plus explicit waiver required |

The scorer should derive the final score from canonical evidence/category contributions; callers must not provide an arbitrary authoritative final score.

### 15.4 Human and JSON output

Release assessment and notes must derive from the same canonical assessment data. Risk/status/approval authority should be visible near the top of human-facing notes.

### 15.5 GitHub integration

The through-M40 architecture permits one narrow explicit GitHub **draft release** side effect.

Constraints:

- explicit command intent;
- repository identity verification;
- candidate freshness checks;
- environment-only credentials;
- secret redaction;
- idempotent/existing-draft handling;
- `draft: true` enforced;
- no publication endpoint/path in the M40 baseline;
- no merge/deploy/version-bump side effect.

## 16. External Integration Security

External integrations must follow least-privilege principles.

- credentials are not stored in canonical project files unless a future explicit secure-secret design says otherwise;
- environment variables or operator-managed credential stores are preferred for sensitive tokens;
- output/evidence must redact secrets;
- integration absence should return actionable setup guidance rather than fabricated success;
- external errors map to the common result/exit contract;
- generic arbitrary-network execution is not implied by one bounded integration.

## 17. Validation Architecture

Validation has two distinct purposes: fast development feedback and authoritative confidence.

### 17.1 Work Unit feedback

Use focused and directly impacted validation, escalating when uncertainty/blast radius demands it. Cheap static/type/lint/build/version gates run when relevant to the changed surface.

A full repository suite is not the ordinary default after every Work Unit.

### 17.2 Workload-aware testing

The test architecture recognizes different workload classes, including:

- fast unit tests;
- filesystem integration;
- process-spawning CLI integration;
- Git/worktree integration;
- evidence/execution integration;
- built-binary smoke coverage.

Timeout and concurrency policy should be workload-driven rather than scattered per-file patches.

### 17.3 Built artifact

Representative validation must execute the built CLI artifact, not only TypeScript source, so packaging/build regressions are observable.

### 17.4 Authoritative gates

Milestone closure and repository governance define broad/full validation. PR and `main` CI remain authoritative confidence gates for integration.

Development-efficiency features must not silently weaken these gates.

### 17.5 Forward boundary: M41

Adaptive impacted-test selection may choose exactly which focused/impacted tests run during development. It must preserve explicit/mandatory tests and broaden/escalate when evidence is uncertain. This capability is not assumed to be implemented by the through-M40 baseline.

## 18. Provider and Model Architecture

Provider-specific invocation belongs behind interfaces.

The core architecture may express:

```text
agent class: economy | balanced | strong
reasoning:   low | medium | high
```

Operator configuration may map these to concrete tools/models. The mapping remains replaceable and advisory.

The architecture does not require:

- provider billing APIs;
- quota scraping;
- hardcoded model catalogs;
- automatic provider switching;
- provider conversation history as canonical state.

## 19. Repository Physical Ownership

The Technical Architecture Specification no longer defines an exact `src/` file tree as a normative contract.

Instead:

- this document defines stable logical boundaries;
- `docs/governance/repository-owner-map.json` is the maintained implementation-level ownership map;
- code/tests/CI are the executable source of truth for exact paths;
- architecture/security guards should discover relevant files dynamically where practical.

This prevents the architecture specification from becoming stale whenever modules are reorganized without changing architectural responsibilities.

## 20. Versioning and Provenance

Four identities must remain distinct:

```text
canonical schema version
package version
milestone engineering provenance
product release identity
```

A package bump may occur without a GitHub Release. A milestone may close without a GitHub Release. A release may aggregate multiple milestones.

Repository version checks should govern whether a package bump is required by a change; tests should not hardcode the latest published release as the package-version truth.

## 21. Failure Handling and Resumability

Architecture should classify failures rather than flatten them into generic errors.

Relevant classes include:

- validation/assertion failure;
- workflow block;
- invalid/corrupt state;
- missing dependency;
- external integration failure;
- human input required;
- timeout/resource exhaustion;
- sandbox capability failure;
- process failure;
- cancellation;
- stale approval/candidate;
- provenance mismatch.

Resume is allowed only from safe persisted boundaries. A partially running agent process must not be blindly "resumed" as though its in-memory execution were durable state.

## 22. Test Strategy

The architecture requires coverage of contracts and boundaries, not merely private implementation details.

High-value areas include:

- canonical-state/schema/version integrity;
- atomic write and preservation behavior;
- work-graph readiness and transitions;
- runlog health/recovery;
- result/exit/human/JSON parity;
- preview/non-mutation parity;
- Git/worktree safety;
- approval freshness;
- command/network/resource policy;
- sandbox boundary/capability behavior;
- evidence binding;
- cancellation/cleanup/recovery;
- built-binary behavior;
- release candidate/provenance/readiness;
- risk boundary values `24/25/49/50/74/75`;
- GitHub draft-only safety;
- secret redaction;
- architecture/security dynamic coverage.

No high-value test should be removed solely to hit a runtime target. Rationalization must preserve equivalent critical coverage.

## 23. Architecture Invariants

The following are hard invariants for the v0.4 baseline:

1. Structured canonical state remains the operational source of truth.
2. Markdown is generated/engineering documentation, not canonical workflow state.
3. Canonical schema version is distinct from package version.
4. Work is represented as a dynamic graph of bounded Work Units.
5. Equivalent governed decisions reuse shared owners.
6. Provider-specific integrations stay behind replaceable adapters.
7. No automatic merge or production deployment path is implied by controlled execution.
8. Live execution fails closed when sandbox guarantees cannot be enforced.
9. Request/import remains a valid lower-risk fallback.
10. Commands and integrations expose evidence rather than fabricate unavailable verification.
11. Human and JSON outcomes derive from the same command data.
12. Risk/readiness/approval/publication are distinct release states.
13. Scores below 50 may permit automation; 50+ requires the defined human boundary.
14. Secrets are minimized and must not leak into output/evidence.
15. PR/main authoritative confidence gates are not silently replaced by development optimizations.
16. AIQT does not self-manage its own product repository without a separate explicit future decision.

## 24. Forward Architecture Boundary

Planned capabilities after this baseline may add:

- adaptive test selection and feedback learning;
- defect discovery/triage/remediation queues;
- structural project review;
- historical release reconstruction;
- background maintenance scheduling;
- multi-repository portfolio governance;
- controlled pull-request integration.

They must extend the existing state/evidence/governance architecture rather than create parallel sources of truth or bypass established safety boundaries.

## 25. Key Architecture Decision

The original architecture priority remains recognizable but is now expanded:

```text
state
-> graph
-> bounded Work Unit
-> execution guidance
-> packet OR controlled execution
-> evidence + validation
-> checkpoint/review
-> governed release decision when explicitly requested
```

The architecture should continue to reject:

```text
markdown-first state
unbounded repository ingestion
opaque agent authority
silent unsandboxed execution
provider lock-in as core design
automatic release publication from milestone closure
```
