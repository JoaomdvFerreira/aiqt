# AIQT Product Specification v0.7

**Local-First AI Workflow & Governance Engine**

| Field | Value |
|---|---|
| Product | AIQT CLI |
| Specification | Product Specification |
| Version | v0.7 |
| Supersedes | AIQT MVP Specification v0.6 as the active product baseline |
| Status | Implementation-aligned baseline through M40 |
| Primary User | Human project owner or maintainer using AI coding agents |
| Primary Agent Target | Claude Code, Codex, or equivalent coding agent through provider-neutral contracts |
| Primary Design Principle | State first, documents second |
| Canonical Schema Baseline | AIQT_SCHEMA_VERSION `0.5.0` |

## 1. Purpose and Baseline

AIQT is a local-first workflow and governance engine for AI-assisted software development. It converts project intent into structured state, bounded work, agent-ready context, controlled execution decisions, validation evidence, and governed release decisions without turning markdown documents or chat history into the source of truth.

This specification replaces the MVP v0.6 document as the active product-level baseline. The v0.6 document remains an important historical MVP baseline. The core MVP decisions are preserved where they still define the product: compact canonical state, a dynamic work graph, bounded Work Units, resumability, generated human views, and a lean CLI.

This v0.7 baseline is implementation-aligned through M40. M41 Adaptive Test Selection and later roadmap items are not assumed to be implemented by this document unless explicitly marked as future evolution.

## 2. Product Positioning

AIQT is **not** a general project-management platform, a hosted coding service, or an unconstrained autonomous developer.

AIQT is a **local-first workflow, context, execution, evidence, and governance engine for AI coding agents**.

Its job is to answer, deterministically where governance matters:

1. What is the project trying to achieve?
2. What bounded Work Unit should happen next?
3. What context does the agent actually need?
4. What execution mode is allowed?
5. What validation is required now versus later?
6. What evidence proves what happened?
7. What risk and approval authority apply?
8. What should the human or agent do next?

## 3. Evolution from the MVP Baseline

The MVP established this core loop:

```text
state -> graph -> packet -> checkpoint
```

That loop remains valid, but the product has expanded coherently around it:

```text
state
  -> graph
  -> bounded Work Unit
  -> execution guidance
  -> handoff OR controlled execution
  -> validation and evidence
  -> checkpoint/review
  -> release governance when explicitly requested
```

The important change is not a replacement of the workflow engine. It is the addition of deterministic guidance, controlled execution, evidence, and release governance around the same bounded-work model.

## 4. Core Problems AIQT Solves

### 4.1 Context overload and context loss

AI agents often receive either insufficient context or broad, repeated, unstructured context. Long chat sessions and repository reinvestigation waste tokens while increasing the chance that important constraints are missed.

AIQT must provide bounded, prioritized context for the current Work Unit and preserve only durable continuation evidence.

### 4.2 Unbounded or ambiguous AI work

"Build the app" is not a safe execution unit. AIQT decomposes projects into explicit Work Units with objective, scope, out-of-scope boundaries, acceptance criteria, dependencies, and validation expectations.

### 4.3 Weak execution evidence

A successful agent message is not proof that work is correct. AIQT must preserve evidence about repository state, changed files, validation, review findings, approvals, budgets, and outcomes.

### 4.4 Unsafe autonomy

AI-assisted execution may involve filesystem writes, processes, Git, network access, credentials, and external tools. AIQT must fail closed when required isolation, permissions, evidence, or approvals cannot be enforced.

### 4.5 Expensive feedback loops

Running broad context, strong models, subagents, and full validation for every Work Unit wastes time and provider budget. AIQT should spend context and computation where they produce useful evidence without weakening authoritative confidence gates.

### 4.6 Release ambiguity

A completed milestone is an engineering event, not automatically a product release. AIQT must distinguish release intent, candidate integrity, provenance, risk, approval authority, and publication state.

## 5. Product Pillars

### 5.1 Canonical State and Resumability

**State is truth. History is evidence. Documents are views.**

AIQT stores durable project knowledge and workflow position in structured local state. Human-readable documents are generated views or engineering artifacts, not a second database.

Required outcomes:

- resume from saved state without relying on chat history;
- preserve stable IDs and history across replanning;
- validate canonical files before mutation;
- fail safely on unsupported or malformed canonical state;
- preserve append-only execution history.

### 5.2 Bounded Work and Context

**The unit of AI execution is one bounded Work Unit.**

Every executable Work Unit should make the following explicit:

- objective;
- in-scope work;
- out-of-scope work;
- dependencies;
- acceptance criteria;
- relevant context references;
- validation expectations.

AIQT must not assume a fixed number of milestones or a file-per-milestone model.

### 5.3 Deterministic Governance and Evidence

**Important decisions must be explainable from durable evidence.**

Where governance matters, AIQT should prefer deterministic contracts over opaque model judgment. This includes readiness, approval boundaries, risk classification, candidate freshness, policy checks, and evidence binding.

### 5.4 Controlled Agent Execution

**AIQT may hand work to an external agent or execute through a controlled local path, but both remain bounded.**

Execution must remain explicit, observable, policy-constrained, and fail closed. AIQT must not silently fall back from a required sandbox to unsandboxed execution.

### 5.5 Efficient Feedback

**Use the minimum necessary context and validation effort that still preserves required confidence.**

Efficiency means reducing repeated context, unnecessary model strength, unnecessary subagents, redundant validation, and verbose success output. It does not mean hiding regressions, skipping mandatory tests, or weakening authoritative release/merge gates.

## 6. Canonical File Model

The canonical project model remains intentionally small:

```text
.aiqt/
  project.json
  state.json
  runlog.jsonl
  exports/
```

- **`.aiqt/project.json`** - Durable project definition and project knowledge: objective, users, requirements, constraints, decisions, risks, assumptions, quality expectations, and integrations.
- **`.aiqt/state.json`** - Workflow position and dynamic work graph: milestones, Work Units, dependencies, checkpoints, current pointers, and execution-related state where canonically required.
- **`.aiqt/runlog.jsonl`** - Append-only event and execution history.
- **`.aiqt/exports/`** - Optional generated human-readable views only.

### 6.1 Hard file-model invariants

AIQT must not require one markdown file per milestone, Work Unit, task, review, or session.

`aiqt init` must not create `AGENTS.md`, `CLAUDE.md`, a project `docs/` hierarchy, `.milestones/`, `.tasks/`, or ad-hoc session/history files as new canonical sources of truth.

### 6.2 Versioning

Canonical file schema version and distributed package version are separate contracts.

```text
AIQT_SCHEMA_VERSION = canonical file schema
package.json.version = distributed package version
Git milestone tag      = engineering provenance
GitHub Release         = explicit product publication decision
```

These values may evolve independently when governance permits.

## 7. Work Graph and Planning Model

AIQT models implementation as a dynamic graph:

```text
Project
  -> Milestones
       -> Work Units
            -> Dependencies
```

The graph may contain one milestone or many milestones, blocked work, parallel-ready work, replanned work, cancelled work, and dependency changes.

Planning rules:

- milestone count is never assumed;
- Work Units are split by agent-executable outcomes, not document structure;
- replanning is normal and must preserve history;
- a ready Work Unit must have sufficient acceptance criteria and validation guidance;
- dependency semantics must be explicit enough to support deterministic readiness decisions.

## 8. Execution Guidance

Execution Guidance is a first-class decision layer between the current Work Unit and execution.

```text
Work Unit
  -> complexity
  -> reasoning / agent-class recommendation
  -> bounded context manifest
  -> continuation evidence
  -> validation guidance
  -> output policy
  -> subagent guidance
```

### 8.1 Principles

- One shared decision owner should produce guidance for equivalent surfaces.
- Provider-neutral recommendations are canonical; operator-configured model labels are advisory mappings.
- AIQT must not maintain a hardcoded live inventory of provider model names as product truth.
- Context begins with a prioritized bounded manifest and expands only when evidence is insufficient.
- Raw chat history is not canonical continuation state.
- Success output should be compact; failures should retain diagnostic detail.
- Subagents default to none and should be targeted and justified when allowed.

### 8.2 Validation depth boundary

Execution Guidance may decide validation depth and classify explicit validation work. Automatic discovery of exactly which tests are impacted is a distinct capability and is not assumed by this v0.7 baseline.

## 9. Execution Modes

AIQT supports two complementary execution models.

### 9.1 Portable external-agent handoff

AIQT can generate a bounded packet or prompt for an external coding agent. This remains the portable, provider-neutral, lower-coupling execution path.

The packet should include:

- project objective;
- current Work Unit;
- scope and non-goals;
- relevant context;
- constraints;
- acceptance criteria;
- suggested files/areas when known;
- validation expectations;
- required result/evidence format.

### 9.2 Controlled local execution

Where explicitly configured and supported, AIQT may coordinate bounded local agent execution.

The controlled path may include:

```text
candidate
  -> preflight
  -> safety classification
  -> approval when required
  -> isolated workspace
  -> sandbox capability check
  -> bounded agent process
  -> command/network/resource policy
  -> validation
  -> self-review
  -> evidence packet
  -> human integration decision
```

### 9.3 Permanent safe fallback

Request/import or equivalent externally executed handoff remains a valid lower-risk fallback. A live backend must not silently weaken isolation requirements when the host cannot enforce them.

## 10. Controlled Execution Safety

Controlled execution must preserve these invariants:

- no AIQT self-management of the AIQT product repository by default;
- no automatic merge or production deployment;
- no silent unsandboxed fallback;
- isolation before mutation when the execution mode requires it;
- explicit command policy;
- explicit network policy;
- explicit resource and time budgets;
- minimal environment projection;
- no unapproved secret discovery or credential exposure;
- deterministic cancellation and cleanup where supported;
- evidence retained for success, failure, cancellation, and budget exhaustion;
- human integration remains a distinct decision boundary unless future governance explicitly changes it.

`cwd`, prompt instructions, path-prefix checks, or post-hoc diff inspection alone do not constitute sandboxing.

## 11. Evidence and Review

AIQT should make important claims traceable to evidence.

Evidence may include:

- base and final commits;
- changed files and diff summary;
- validation commands and outcomes;
- checkpoint results;
- review findings and acknowledgments;
- approval state;
- command/network/resource policy;
- budgets and cancellation state;
- external verification gaps;
- release-candidate provenance.

Read-only assessment surfaces must not fabricate successful external verification when credentials, services, or environment access are unavailable.

## 12. Release Governance

Release governance is explicit and separate from milestone completion.

```text
milestone completion != product release
package version       != automatic GitHub Release
```

A release flow is conceptually:

```text
release intent
  -> candidate
  -> provenance
  -> readiness
  -> deterministic risk assessment
  -> approval authority
  -> notes / local preparation
  -> controlled draft integration where supported
  -> separate publication decision
```

### 12.1 Four-band risk model

| Score | Status | Publication authority |
|---:|---|---|
| 0-24 | Green | Agent/automation approval permitted when all other gates pass |
| 25-49 | Yellow | Agent/automation approval permitted when all other gates pass |
| 50-74 | Orange | Human approval required |
| 75-100 | Red | Human approval plus explicit waiver required |

Readiness and approval authority are separate. A release can be technically ready while still requiring human intervention.

### 12.2 Publication boundary

M40 establishes controlled GitHub **draft** integration only. This v0.7 baseline does not define an automatic publication path. Release publication remains a separate governed decision.

## 13. CLI Capability Families

The top-level CLI should remain lean. Related capabilities should be grouped under coherent command families instead of creating one top-level command per feature.

The current product is best understood through capability families rather than a permanently exhaustive command list.

| Family | Representative capabilities |
|---|---|
| Core workflow | `init`, `update`, `plan`, `next`, `checkpoint`, `review`, `manage`, `status`, `export` |
| Agent operation | prompt/driver/import flows, bounded handoff, skills/recommendation surfaces where supported |
| Controlled autonomy | `autonomous inspect`, `classify`, `approve`, `run`, `status`, `cancel`, `result`, `cleanup` |
| Release governance | `release assess`, `validate`, `notes`, `prepare`, `status`, `draft` |

Machine-readable and human-readable outputs should derive from the same canonical decision data and established result contracts.

## 14. Validation and Feedback Model

AIQT distinguishes development feedback from authoritative confidence gates.

### 14.1 Work Unit feedback

During bounded implementation, prefer:

- focused tests;
- directly impacted tests identified from available evidence;
- relevant static/type/lint/build/version checks;
- progressive escalation when blast radius or uncertainty increases.

Ordinary Work Units should not default to the full repository suite without a concrete reason.

### 14.2 Milestone and release confidence

Milestone closure, PR, main-branch, and release gates remain authoritative according to repository/project governance. Efficiency work must not remove high-value coverage merely to reduce runtime.

### 14.3 Forward boundary: adaptive selection

Automatic impacted-test selection and feedback adaptation belong to M41 and later implementation. They must optimize the development feedback loop, not silently replace authoritative PR/main confidence gates.

## 15. Provider Neutrality

AIQT core contracts should remain provider-neutral.

Provider-specific execution is permitted behind bounded adapters, but the product must not depend on one provider's model naming, quota API, billing API, or proprietary conversation history as canonical state.

Operator mappings may translate generic recommendations such as:

```text
balanced + medium
```

into a local configured label such as a particular coding agent/model. Such mappings remain advisory configuration, not canonical product truth.

## 16. Explicit Non-Goals

The following remain outside the product boundary unless a future explicit product decision changes them:

- full SaaS project-management backend;
- cloud synchronization as a canonical requirement;
- general multi-user collaboration platform;
- unconstrained autonomous software development;
- recursive agent swarms by default;
- arbitrary privileged host execution;
- unrestricted network access;
- silent secret discovery or credential provisioning;
- automatic merge or production deployment by default;
- generic CI/CD replacement;
- graph database or custom workflow DSL as a core dependency;
- markdown-first project state;
- persistent raw chat/session history as canonical context;
- automatic GitHub Release publication merely because a milestone or version bump exists.

## 17. Product Acceptance Principles

AIQT remains aligned with this specification when all of the following are true:

1. Canonical structured state remains the project source of truth.
2. The work graph supports any reasonable milestone count without file-per-milestone state.
3. Agent work is bounded to explicit outcomes with scope, non-goals, criteria, and validation.
4. Equivalent decision surfaces reuse shared deterministic owners where governance matters.
5. Execution Guidance reduces irrelevant context/effort without removing mandatory evidence.
6. External handoff remains supported even when live controlled execution exists.
7. Controlled execution fails closed when required safety capabilities are unavailable.
8. Evidence is bound to the action, repository state, validation, and approvals it claims to represent.
9. Human authority is preserved at defined risk and integration boundaries.
10. Release intent, readiness, risk, approval, and publication remain distinct states.
11. Package version, schema version, milestone identity, and product release remain distinct contracts.
12. Human-readable output remains a view over canonical decisions, not an independent source of truth.
13. CLI growth remains organized into coherent capability families.
14. Efficiency improvements do not weaken authoritative confidence gates.
15. AIQT remains local-first and provider-neutral at its core.

## 18. Future-Milestone Product Gate

Every future milestone should answer these questions before implementation:

1. Which product pillar does this strengthen?
2. Does it preserve structured state as source of truth?
3. Is behavior deterministic where governance matters?
4. Does it preserve bounded agent scope?
5. Does it preserve human authority at defined risk boundaries?
6. Does it avoid creating duplicate state or documentation?
7. Does it remain local-first and provider-neutral at the core?
8. Does it improve reliability, evidence, safety, or execution efficiency?
9. Does it create generic platform scope unrelated to the core workflow?

A milestone that cannot identify a strong connection to the first eight questions, or that substantially triggers the ninth, requires explicit product-level reconsideration.

## 19. Roadmap Boundary at v0.7

The v0.7 baseline is implementation-aligned through M40.

Planned roadmap areas after this baseline include adaptive test selection, defect discovery and remediation queues, structural project review, historical release reconstruction, background scheduling, multi-repository governance, and controlled PR integration.

These are future capabilities, not assumptions baked into the current canonical contracts.

## 20. Key Product Decision

AIQT remains a workflow state engine at its core, but the complete product loop is now broader than the original MVP shorthand.

Prioritize:

```text
state
-> graph
-> bounded Work Unit
-> execution guidance
-> handoff OR controlled execution
-> evidence and validation
-> checkpoint/review
-> governed release decision when requested
```

Do not prioritize:

```text
chat history
-> broad repository dump
-> unbounded agent action
-> ad-hoc markdown state
-> opaque success claim
-> automatic publication
```
