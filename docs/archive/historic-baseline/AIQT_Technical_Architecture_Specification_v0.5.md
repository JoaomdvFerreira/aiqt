# AIQT Technical Architecture Specification v0.5

**Local-First Workflow, Execution & Governance Architecture**

| Field | Value |
|---|---|
| Product | AIQT CLI |
| Specification | Technical Architecture Specification |
| Version | v0.5 |
| Aligns With | AIQT Product Specification v0.8 |
| Supersedes | Technical Architecture Specification v0.4 as the active architecture baseline |
| Status | Implementation-aligned architecture through M47 |
| Architecture Positioning | Local-first workflow, execution, evidence, and governance engine |
| Primary Runtime | Node.js 24 + TypeScript CLI |
| Canonical Schema Baseline | AIQT_SCHEMA_VERSION `0.7.0` |

## 1. Purpose

This document defines the stable technical architecture of AIQT after the product evolved beyond the original MVP implementation plan.

The architecture remains centered on a local structured workflow state engine, but now includes first-class execution guidance, evidence, bounded autonomous execution, sandboxed live execution, a defect/remediation-queue domain, read-only structural review, background maintenance scheduling, multi-repository portfolio membership, controlled Pull Request integration, and release governance.

This document intentionally describes **stable architectural ownership and invariants**, not an exact repository file tree. Exact physical ownership belongs in the maintained repository owner map and live codebase.

The baseline is implementation-aligned through M47. M48 Night Project Review & Issue Generation and later items are treated as forward evolution and are not assumed to exist in this architecture unless explicitly marked.

## 2. v0.5 Architecture Change Summary

Compared with v0.4, v0.5:

- preserves the canonical state-first architecture and schema/package version separation;
- adds the defect/remediation-queue domain as an additive canonical `StateModel` section, fingerprint-deduplicated and lifecycle-governed;
- adds structural review as a read-only, offline-capable, transient evidence domain that is never persisted to canonical state by its own read path;
- adds background maintenance scheduling as a second additive canonical `StateModel` section (timing/occurrence only, narrowing-only policy, no daemon);
- adds multi-repository portfolio membership as a separate, user-home-scoped schema/version domain, distinct from any member's own canonical state;
- adds controlled Pull Request integration as a separate, user-home-scoped schema/version domain with a structurally-bounded Git/GitHub write surface;
- adds historical release reconstruction as a transient assessment layered on the existing release-governance owner, never a second release-decision authority;
- folds in adaptive impacted-test selection (M41) as an implemented, deterministic layer over validation guidance, no longer a forward boundary;
- records the precedent that a new canonical `StateModel` section requires an explicit schema-version decision at the owning Work Unit, while a transient or separately-versioned domain does not;
- confirms the twice-attempted, twice-discontinued `approved-for-merge` auto-merge experiment is not part of the current architecture.

## 3. Architectural Principles

### 3.1 State first

`project.json` and `state.json` are operational canonical state. `runlog.jsonl` is append-only history/evidence. Generated markdown is never required as a second workflow database.

### 3.2 Bounded domain decisions

Planning, readiness, execution guidance, safety classification, validation, defect triage, remediation risk, structural-finding disposition, release risk, and approval authority should have explicit owners. Equivalent callers must not reproduce divergent decision logic.

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
- defect discovery, triage, and remediation queue;
- structural review;
- background maintenance scheduling;
- multi-repository portfolio membership;
- Pull Request integration;
- release candidate/readiness/risk/approval.

### 4.5 Persistence and Adapter Layer

Persistence owns canonical `.aiqt` state, plus the separately-versioned portfolio manifest and Pull Request integration plan stores. Adapters own interactions with Git, subprocesses, sandbox backends, coding agents, and GitHub. Domain services should not directly depend on provider-specific implementation details.

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

Workflow state, including project status, dynamic work graph, current pointers, checkpoints, packet metadata, the defect/remediation queue, maintenance schedules and active occurrence, and other canonically persisted workflow records introduced by schema-governed features.

### 6.3 `runlog.jsonl`

Append-only event history. Each valid line is one event object. Individual malformed lines may degrade runlog health without corrupting otherwise valid operational state, according to established runlog rules.

### 6.4 `exports/`

Generated views only. Exports must not be required to resume operational workflow.

### 6.5 Separately-versioned stores

Two capabilities deliberately do not extend `AIQT_SCHEMA_VERSION` or live inside a managed repository's `.aiqt/` directory: the multi-repository portfolio manifest and a Pull Request integration plan. Both are user-home-scoped, own schema/version domain, and record only what their bounded authority actually needs — membership facts, or one plan's binding/side-effect record — never a copy of another repository's canonical state.

### 6.6 Write safety

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
AIQT_SCHEMA_VERSION = "0.7.0"   // current canonical schema baseline
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

### 7.1 Precedent: when a new capability requires a schema bump

In practice, every capability that added a **new top-level, canonical `StateModel` section** (the defect/remediation queue in M42; maintenance schedules and the active-occurrence slot in M45) paired that addition with an explicit `AIQT_SCHEMA_VERSION` minor bump, decided and recorded by the owning Work Unit. A capability that instead used a **transient, read-only evidence object never written to `StateModel`** (structural review) or a **separate schema/version domain stored outside `.aiqt/`** (the portfolio manifest, a Pull Request integration plan) did not bump `AIQT_SCHEMA_VERSION` at all. A future milestone adding durable state should expect to follow whichever precedent actually matches its shape, and must record that decision explicitly rather than assume either outcome by default.

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

The through-M47 architecture permits two narrow explicit GitHub side effects, each behind its own bounded write surface: a **draft release** (§15) and a **Pull Request** (§20). Neither implies the other, and neither implies a merge or a publication.

Constraints on the draft-release path:

- explicit command intent;
- repository identity verification;
- candidate freshness checks;
- environment-only credentials;
- secret redaction;
- idempotent/existing-draft handling;
- `draft: true` enforced;
- no publication endpoint/path in this baseline;
- no merge/deploy/version-bump side effect.

### 15.6 Historical Release Reconstruction

A historical reconstruction assessment is a transient evidence object, never a release candidate/decision in its own right — it reuses the existing readiness/risk/approval-authority owner (§15.2/§15.3) via the same mapping a live release candidate would use, plus a verification pass against the provider for an already-published release. Ancestry-only tag/base-release discovery avoids fabricating a lineage that does not exist in Git history. `unverified` (no credential, non-owner identity, or API failure) and a confirmed absence are always kept distinct — an inability to check is never collapsed into a negative finding, and a confirmed existing release is reported as such, never re-derived locally as though AIQT had produced it.

## 16. Defect and Remediation-Queue Architecture

The defect/remediation-queue domain owns a single durable defect record per structurally-fingerprinted defect, persisted as an additive canonical `StateModel` section (no parallel `.aiqt/defects.*` file or database). Discovery only accepts evidence AIQT can already point to — failed validation, a checkpoint issue, an accepted structural finding, an autonomous-execution failure, imported external evidence, or an explicit human report — and never authorizes remediation by itself. A pure, deterministic triage function derives severity, confidence, reproducibility, queue disposition, and approval authority from that evidence. The remediation queue is the same defect list filtered to queue-eligible statuses, not a second stored list.

Remediation risk is scored from the proposed change's scope alone, reusing the repository's four-band scale but a distinct scoring input from both defect severity and release risk; a score of 50 or above blocks any persisted remediation decision on explicit human approval. Resolution is controlled by recorded validation evidence, never by an agent's own claim of success.

## 17. Structural Review Architecture

Structural review is a read-only, offline-capable, bounded set of deterministic domain rule sets (ownership divergence, dependency coupling, responsibility concentration, dead structural paths, public-contract drift, test-infrastructure health, execution-safety-boundary duplication). A structural finding is a transient evidence object — never written to canonical `StateModel` or the runlog by review execution itself, and never itself a defect record. Its finding-identity key is a structural-identity digest that excludes the reviewed commit, so the same real condition keeps the same identity across commits and can be tracked/consolidated over time; the commit under review is a separate freshness binding checked at the point a finding is promoted.

Promotion into the durable defect record is one explicit, freshness-bound adapter reusing the existing defect-discovery pipeline verbatim — there is no second, parallel defect-tracking concept.

## 18. Background Maintenance Scheduling Architecture

A maintenance schedule is timing intent only — cadence, anchor, and next/last occurrence — never execution or approval authority; its automatic-risk policy field is schema-bounded so it can only lower an existing automatic-approval ceiling, never raise it. Persisted as an additive canonical `StateModel` section alongside a single nullable active-occurrence slot, making "no parallel scheduled maintenance" a structural property of the state shape rather than a runtime check.

Due-time selection is a pure, injectable-clock function so identical state and time always produce identical selection; occurrence identity is a digest over the schedule's own configuration and due point. Orchestration reuses the existing workspace-operation lock only for the short read-select-claim sequence, never for the task itself, which always completes synchronously in-process; a claim that outlives the expected completion window is reconciled to a failed outcome, never assumed successful. No daemon process is implied — a schedule becomes due work only when something evaluates it.

## 19. Multi-Repository Portfolio Architecture

A portfolio manifest is a separate schema/version domain from the canonical per-project `AIQT_SCHEMA_VERSION` contract, stored user-home-scoped rather than inside any member repository. It records only membership — an id, a resolved absolute repository root, and optional metadata — never a member's own mutable workflow/defect/maintenance/execution/review/release state, which continues to live entirely inside that member's own `.aiqt/` directory.

Portfolio membership may resolve exactly one member id to exactly one repository root for a caller that already carries its own bounded authority (for example, Pull Request integration, or a future Night Audit session). It is a directory lookup, never a batch-mutation mechanism and never write authority in its own right.

## 20. Pull Request Integration Architecture

A Pull Request integration plan is a separate, user-home-scoped schema/version domain (mirroring the portfolio manifest), never written inside a managed repository and never a substitute for `AIQT_SCHEMA_VERSION`. One plan binds exactly one repository, remote, base branch, source branch, exact 40-hex commit SHA, and at most one Pull Request; every write-relevant fact is covered by a binding digest recomputed and compared before every remote write, so a plan whose local state has moved on is stale and blocked rather than silently reused.

The only mutating Git primitive is a fixed, non-force, single-ref, fast-forward-only push of an already-resolved commit SHA — never a ref, wildcard, `--all`, `--mirror`, tag, or deletion — and its outcome is decided by re-reading the remote afterward, so a thrown error is not proof of failure and an exit-0 result is not proof of success. Pull Request creation always performs a provider lookup before any create call and is never retried blind: a matching open PR is adopted, a PR at a different head SHA or more than one match blocks as a conflict, and a failed create is resolved by a second lookup rather than a guess. Ambiguous push/create outcomes are first-class plan states that block all further remote action until resolved from real provider evidence.

GitHub's merge and review endpoints do not appear anywhere in this architecture.

## 21. External Integration Security

External integrations must follow least-privilege principles.

- credentials are not stored in canonical project files unless a future explicit secure-secret design says otherwise;
- environment variables or operator-managed credential stores are preferred for sensitive tokens;
- output/evidence must redact secrets;
- integration absence should return actionable setup guidance rather than fabricated success;
- external errors map to the common result/exit contract;
- generic arbitrary-network execution is not implied by one bounded integration.

## 22. Validation Architecture

Validation has two distinct purposes: fast development feedback and authoritative confidence.

### 22.1 Work Unit feedback

Use focused and directly impacted validation, escalating when uncertainty/blast radius demands it. Cheap static/type/lint/build/version gates run when relevant to the changed surface.

A full repository suite is not the ordinary default after every Work Unit.

### 22.2 Workload-aware testing

The test architecture recognizes different workload classes, including:

- fast unit tests;
- filesystem integration;
- process-spawning CLI integration;
- Git/worktree integration;
- evidence/execution integration;
- built-binary smoke coverage.

Timeout and concurrency policy should be workload-driven rather than scattered per-file patches.

### 22.3 Built artifact

Representative validation must execute the built CLI artifact, not only TypeScript source, so packaging/build regressions are observable.

### 22.4 Authoritative gates

Milestone closure and repository governance define broad/full validation. PR and `main` CI remain authoritative confidence gates for integration.

Development-efficiency features must not silently weaken these gates.

### 22.5 Adaptive impacted-test selection

Adaptive impacted-test selection chooses exactly which focused/impacted tests run during development, on top of the mandatory/explicit set. It always preserves explicit/mandatory tests, and always broadens/escalates to a fuller run when blast radius is wide or evidence is uncertain — it never narrows validation below what the acceptance-criteria/blast-radius evidence supports. This capability is implemented as of M41 and is a refinement of §10 Execution Guidance's validation guidance, not a second decision owner.

## 23. Provider and Model Architecture

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

## 24. Repository Physical Ownership

The Technical Architecture Specification no longer defines an exact `src/` file tree as a normative contract.

Instead:

- this document defines stable logical boundaries;
- `docs/governance/repository-owner-map.json` is the maintained implementation-level ownership map;
- code/tests/CI are the executable source of truth for exact paths;
- architecture/security guards should discover relevant files dynamically where practical.

This prevents the architecture specification from becoming stale whenever modules are reorganized without changing architectural responsibilities.

## 25. Versioning and Provenance

Four identities must remain distinct:

```text
canonical schema version
package version
milestone engineering provenance
product release identity
```

A package bump may occur without a GitHub Release. A milestone may close without a GitHub Release. A release may aggregate multiple milestones. Two further identities — the portfolio-manifest schema version and the Pull Request integration plan schema version — are distinct again from all four, and from each other; none of the six ever substitutes for another.

Repository version checks should govern whether a package bump is required by a change; tests should not hardcode the latest published release as the package-version truth.

## 26. Failure Handling and Resumability

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
- provenance mismatch;
- ambiguous external mutation outcome (push/create) pending reconciliation;
- interrupted scheduled occurrence pending reconciliation.

Resume is allowed only from safe persisted boundaries. A partially running agent process must not be blindly "resumed" as though its in-memory execution were durable state. An ambiguous external mutation is never retried blind; it is reconciled from freshly observed provider/remote state before any further write.

## 27. Test Strategy

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
- defect fingerprint/dedup/triage/remediation-risk boundaries;
- structural-finding freshness and non-persistence;
- maintenance occurrence overlap/staleness reconciliation;
- portfolio membership isolation from member canonical state;
- Pull Request push/create idempotency and ambiguity reconciliation;
- secret redaction;
- architecture/security dynamic coverage.

No high-value test should be removed solely to hit a runtime target. Rationalization must preserve equivalent critical coverage.

## 28. Architecture Invariants

The following are hard invariants for the v0.5 baseline:

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
17. A new canonical `StateModel` section requires the owning Work Unit to make and record an explicit schema-version decision; it is never silently exempted merely because the section is additive/optional.
18. A transient evidence domain (e.g. structural findings) is never persisted to canonical state or the runlog by its own read path.
19. A portfolio or cross-repository registry records membership only; it never stores or mutates a member's own canonical state, and never grants write authority by itself.
20. A remote Git/GitHub write is expressed in a form that makes the disallowed action (force, wildcard ref, mirror, tag, deletion, merge) structurally inexpressible, not merely blocked by a runtime check.

## 29. Forward Architecture Boundary

Planned capabilities after this baseline may add:

- a bounded, resumable overnight project-review session that produces evidence-backed GitHub Issues from candidate findings, reusing the existing structural-review/defect-discovery/quality-gate pattern rather than a new one, and that never modifies project source, creates a commit or Pull Request, merges, or deploys (M48);
- a stable, provider-neutral, milestone-level execution baseline with narrow, pre-named, exceptional escalation to stronger reasoning (M49).

They must extend the existing state/evidence/governance architecture rather than create parallel sources of truth or bypass established safety boundaries. A human-directed issue-to-remediation workflow is a candidate for future consideration once M48 demonstrates real usage; autonomous remediation specifically remains explicitly deferred, not a committed roadmap item or assumed by this baseline.

## 30. Key Architecture Decision

The original architecture priority remains recognizable but is now expanded:

```text
state
-> graph
-> bounded Work Unit
-> execution guidance
-> packet OR controlled execution
-> evidence + validation
-> checkpoint/review
-> defect/structural governance
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
automatic Pull Request merge or approval
portfolio membership as write authority
```
