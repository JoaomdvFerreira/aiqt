# AIQT Post-M20 Proposed Milestones Review Specification v0.4

```yaml
document:
  product: AIQT CLI
  type: Proposed Milestone Roadmap and Risk Review Specification
  version: 0.4
  status: Review candidate resolving v0.3 repository-grounded findings
  review_target: Claude Code, Claude, or equivalent reasoning model
  human_readability_priority: secondary
  machine_review_priority: primary
  baseline:
    package_version: 0.7.0
    latest_known_milestone:
      id: M20
      title: Explicit Ready Work Unit and Branch Selection
    architecture_role: local workflow control plane
    canonical_state:
      - .aiqt/project.json
      - .aiqt/state.json
      - .aiqt/runlog.jsonl
    current_execution_boundary:
      - AIQT stores and renders validationCommands as guidance.
      - AIQT does not execute arbitrary work-unit commands.
      - AIQT does not spawn coding agents.
      - AIQT does not autonomously create, reset, merge, or publish implementation changes.
  first_proposed_milestone: M21
  last_proposed_milestone: M30
```

---

## 0. v0.4 Change Summary

v0.3 received `91/100 — approve_with_changes`. The architecture and milestone decomposition were accepted, but Gate A remained blocked by one high-severity repository-grounding error and one roadmap-wide risk-control documentation gap. v0.4 resolves all four review findings and incorporates the additional governance, testing, and security requirements identified by repository inspection.

```yaml
v0_4_changes:
  f_01_project_issue_model:
    - corrects the false assumption that a persisted project-level Issue lifecycle already exists
    - preserves the existing checkpoint-scoped CheckpointIssue model
    - makes design and persistence of a new ProjectIssue schema a first-class M22 deliverable
    - keeps the existing output-only Issue DTO explicitly separate from canonical ProjectIssue state
    - requires additive optional-state compatibility and deterministic migration/default behavior
    - preserves promotion-to-repair-work-unit behavior through canonical issue keys
  f_02_risk_controls:
    - adds a named hazard/control table to every milestone M21-M30
    - derives each controlledDesignTarget from explicit controls rather than assertion
    - requires build specifications to recalculate entry risk using repository evidence
  f_03_provider_entry_thresholds:
    - lowers M25 implementation-entry target from 35 to 30
    - lowers M27 implementation-entry target from 35 to 30
    - keeps 35 reserved for M30 after its stronger prerequisite gates
  f_04_amendment_terminology:
    - removes the nonexistent targetStatus amendment field
    - references acceptanceCriteriaResult and validationResult
    - requires evidence evaluation to use computeEffectiveCheckpointResult or its canonical successor
  m21_governance_additions:
    - explicitly adds a Vitest coverage provider and baseline deliverable
    - adds SECURITY.md and vulnerability-disclosure policy
    - requires an explicit branch-protection decision rather than capability classification alone
  schema_test_contract:
    - requires Zod fixture tests for every new persisted or imported contract
    - covers minimal/full valid fixtures, optional omissions, unknown fields, invalid enums, broken references, duplicate identities, malformed JSON, and backward compatibility
  m28_runlog_rule:
    - explicitly justifies no runlog event for pure deterministic read-only simulation
```

No implementation is authorized by this roadmap. Every milestone requires a dedicated build specification, repository-grounded review, explicit hazard-control verification, and an implementation-entry risk at or below its stated threshold.

---

## 1. Review Objective

Review whether the proposed M21-M30 roadmap safely extends AIQT from a strict local workflow state engine into an agentic engineering control plane capable of governing:

- runtime and repository hardening;
- independent review;
- structured evidence;
- evidence provenance and trust;
- human decision escalation;
- external evidence normalization;
- isolated workspace metadata;
- dependency-aware parallel eligibility;
- optional provider protocols;
- evidence-gate simulation;
- advisory checkpoint evidence;
- required evidence enforcement.

Primary architecture target:

```text
AIQT defines and persists contracts.
External systems execute implementation and validation.
AIQT imports, validates, normalizes, classifies, and governs results.
AIQT controls workflow transitions only after policy requirements are proven.
```

AIQT must not become a monolithic AI runner, general shell orchestrator, dynamic plugin host, autonomous Git operator, or provider-specific automation framework.

---

## 2. Architecture Position

### 2.1 Target decomposition

```text
┌──────────────────────────────────────────────────────────────┐
│ AIQT Control Plane                                           │
│ project · graph · packets · checkpoints · review · policy    │
│ evidence contracts · workspace metadata · transition gates   │
└─────────────────────────────┬────────────────────────────────┘
                              │ versioned structured contracts
        ┌─────────────────────┼──────────────────────┐
        ▼                     ▼                      ▼
Execution provider     Validation provider    Workspace provider
external system        external system        external system
        │                     │                      │
        └─────────────────────┼──────────────────────┘
                              ▼
                  structured evidence and state input
```

### 2.2 Architectural invariants

```yaml
invariants:
  - project.json and state.json remain canonical state.
  - runlog.jsonl remains append-only history.
  - generated documents remain non-canonical views.
  - one agent packet targets one current work unit.
  - provider-specific fields never define core workflow semantics.
  - external systems may execute work; AIQT governs imported results.
  - evidence binds to work unit, packet, implementation root, provider, and code state where available.
  - human decisions are represented separately from issue severity and fixability.
  - source findings normalize into the existing CheckpointIssue lifecycle or the new persisted ProjectIssue lifecycle introduced by M22.
  - the output-only CommandResult Issue DTO remains non-canonical and is never treated as persisted ProjectIssue state.
  - no evidence import creates an uncoordinated or provider-specific issue lifecycle.
  - advisory behavior is proven before required behavior exists.
  - no milestone silently enables execution or enforcement for existing projects.
  - no milestone loads executable code from project-controlled paths.
  - structurally valid external data is not automatically trusted.
  - filesystem isolation is never treated as proof of semantic isolation.
  - legacy completed work is not retroactively invalidated by later policy activation.
```

---

## 3. Risk Scoring and Authorization Contract

### 3.1 Deterministic risk score

Canonical AIQT severity remains:

```text
low | medium | high | critical
```

Roadmap risk scores use:

```yaml
risk_scoring:
  probability_weight:
    none: 0
    low: 1
    medium: 2
    high: 3
  impact_weight:
    none: 0
    low: 1
    medium: 2
    high: 3
    critical: 4
  formula: round((probabilityWeight * impactWeight / 12) * 100)
  severity_mapping:
    closed_or_not_applicable: 0
    low: 1-24
    medium: 25-49
    high: 50-74
    critical: 75-100
```

A score of `0` is permitted only when a named risk is demonstrably closed or not applicable. It must not be used to hide an unresolved risk.

Reference matrix for open risks:

| Probability | Impact | Score | Severity |
|---|---|---:|---|
| Low | Low | 8 | Low |
| Low | Medium | 17 | Low |
| Low | High | 25 | Medium |
| Low | Critical | 33 | Medium |
| Medium | Low | 17 | Low |
| Medium | Medium | 33 | Medium |
| Medium | High | 50 | High |
| Medium | Critical | 67 | High |
| High | Low | 25 | Medium |
| High | Medium | 50 | High |
| High | High | 75 | Critical |
| High | Critical | 100 | Critical |

### 3.2 Four separate milestone scores

```yaml
milestone_risk_dimensions:
  inherentRisk:
    meaning: maximum credible hazard before milestone-specific controls
    use: architecture awareness only
  controlledDesignRisk:
    meaning: risk after the roadmap and build specification define boundaries and controls
    use: determines whether the specification is sufficiently decomposed
  implementationEntryRisk:
    meaning: maximum unresolved risk immediately before implementation starts
    use: authoritative build go_or_no_go score
  mergeResidualRisk:
    meaning: maximum known residual risk after implementation, tests, review, and dogfood required by the milestone
    use: authoritative merge/release score
  projectActivationResidualRisk:
    meaning: project-specific residual risk before enabling required enforcement
    use: authoritative required-mode activation score
```

### 3.3 Authorization thresholds

```yaml
authorization_thresholds:
  build:
    proceed: 0-20
    proceed_with_controls: 21-35
    revise_before_build: 36-49
    no_go: 50-74
    unacceptable: 75-100
  merge:
    maximum_target: 15
    interpretation: every known open residual risk must be low_low or closed
  required_mode_project_activation:
    maximum_target: 5
    interpretation: no known activation risk may remain open; any open low_low risk scores 8 and blocks activation
```

The high inherent scores in this roadmap are not build authorization scores. No milestone may begin with `implementationEntryRisk > 35`.

---

## 4. Roadmap Summary

```yaml
proposed_milestones:
  - id: M21
    title: Runtime, Supply Chain, and Repository Governance Hardening
    type: mandatory_baseline
  - id: M22
    title: Independent Review and Evidence Contracts
    type: mandatory_contract
  - id: M23
    title: External Evidence Import and Normalization
    type: mandatory_interoperability
  - id: M24
    title: Workspace Assignment and Parallel Eligibility Metadata
    type: optional_when_parallelism_is_needed
  - id: M25
    title: Managed Workspace Provider Adapters
    type: optional_provider_interoperability
  - id: M26
    title: Long-Running Execution Protocol
    type: optional_contract
  - id: M27
    title: Long-Running Execution Provider Adapter
    type: optional_provider_interoperability
  - id: M28
    title: Evidence Gate Simulation
    type: mandatory_before_enforcement
  - id: M29
    title: Advisory Checkpoint Evidence Integration
    type: mandatory_before_enforcement
  - id: M30
    title: Required Evidence Enforcement
    type: final_opt_in_enforcement
```

Recommended sequence:

```text
M21 → M22 → M23
              ├─→ M24 → optional M25
              ├─→ optional M26 → optional M27
              └─→ M28 → M29 → M30
```

M24-M27 are not mandatory prerequisites when their capabilities are not used. M28 and M29 are mandatory prerequisites for M30.

### 4.1 Risk posture summary

| Milestone | Inherent | Controlled design target | Entry target | Merge residual target |
|---|---:|---:|---:|---:|
| M21 | 50 | 33 | 25 | 10 |
| M22 | 50 | 33 | 25 | 12 |
| M23 | 50 | 33 | 33 | 15 |
| M24 | 50 | 33 | 30 | 12 |
| M25 | 75 | 50 | 30 | 15 |
| M26 | 50 | 33 | 30 | 12 |
| M27 | 75 | 50 | 30 | 15 |
| M28 | 50 | 33 | 25 | 10 |
| M29 | 50 | 33 | 30 | 12 |
| M30 | 100 | 50 | 35 | 15 |

M30 additionally requires `projectActivationResidualRisk <= 5` before any project enables required mode.

---

# 5. M21 — Runtime, Supply Chain, and Repository Governance Hardening

```yaml
milestone:
  id: M21
  objective: establish a truthful, supported, reproducible baseline before evidence or provider features
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 25
    mergeResidualTarget: 10
```

## 5.1 In scope

- supported Node.js LTS decision and CI matrix;
- explicit `engines.node` and exact `packageManager` metadata;
- explicit package license or `UNLICENSED`/private intent;
- dependency vulnerability and update automation, or a documented rejection with compensating controls;
- installation and configuration of a Vitest coverage provider, preferably `@vitest/coverage-v8` unless repository constraints justify another provider;
- coverage baseline for critical modules before thresholds are introduced;
- `SECURITY.md` with supported-version, reporting-channel, response, and disclosure expectations;
- explicit branch-protection decision: enabled, planned upgrade, repository-publication plan, or accepted unenforced gap;
- truthful classification of CI checks as enforced or advisory based on actual platform controls;
- collision-resistant, exclusive atomic temporary-file creation;
- canonicalized control-root and implementation-root trust model;
- warning-first external implementation-root diagnostics;
- maintainer recovery and release runbook.

## 5.2 Out of scope

- validation command execution;
- evidence contracts;
- provider adapters;
- agent spawning;
- worktree creation;
- checkpoint gates;
- autonomous remediation;
- arbitrary global coverage thresholds before baseline analysis.

## 5.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Runtime migration breaks ESM/build/test behavior | Medium | High | 50 | supported-version CI matrix, reversible package metadata change, no feature semantics | 25 |
| Governance claims exceed platform enforcement | Medium | High | 50 | explicit branch-protection decision and enforced/advisory terminology contract | 25 |
| External implementation-root diagnostics break separate-repository workflows | Medium | High | 50 | warning-first additive trust model; no containment rejection or execution | 33 |
| Coverage tooling or thresholds create false assurance | Medium | Medium | 33 | baseline-only release; thresholds deferred and module-specific | 17 |
| Dependency automation creates excessive update noise | Low | Medium | 17 | weekly capped updates, grouping, and review policy | 8 |
| Security policy implies unsupported response capability | Low | Medium | 17 | truthful supported-version and response-language requirements | 8 |
| Atomic temp-file hardening regresses crash safety | Medium | High | 50 | exclusive creation, same-directory rename, fsync/cleanup regression fixtures | 25 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 5.4 Entry conditions

- exact M20 commit, tag, package version, CI, runtime, package metadata, and repository settings confirmed;
- runtime migration plan is reversible;
- branch-protection limitations are verified rather than inferred from one API response;
- branch-protection decision category and compensating controls are approved;
- selected coverage provider and baseline command are reviewed;
- no behavior-changing root containment rule is proposed;
- implementation-entry risk recalculated at 25 or below.

## 5.5 Exit criteria

- old workflows behave identically;
- supported runtime and package manager are explicit;
- CI matrix is green;
- branch-protection decision is persisted in governance documentation;
- CI status is described truthfully as enforced or advisory;
- dependency monitoring decision is implemented;
- package license intent is explicit;
- coverage tooling is installed and produces a reproducible baseline without arbitrary global thresholds;
- `SECURITY.md` exists and does not overstate support capability;
- atomic writes remain crash-safe and use exclusive temp creation;
- implementation-root trust is modeled without execution;
- maintainer recovery and release runbook is tested through a documentation smoke review;
- merge residual risk is 10 or below;
- no new command-execution surface exists.

---

# 6. M22 — Independent Review, Evidence, and ProjectIssue Contracts

```yaml
milestone:
  id: M22
  objective: define provider-neutral evidence, provenance, independent-review, CheckpointIssue normalization, a new persisted ProjectIssue lifecycle, and decision-escalation contracts without execution
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 25
    mergeResidualTarget: 12
```

## 6.1 Repository-grounded issue model

M22 must distinguish four existing or new concepts explicitly:

```yaml
issue_model:
  CheckpointIssue:
    status: existing
    scope: one checkpoint and one execution cycle
    canonical_location: existing checkpoint schema
  IssueOverride_and_IssuePromotion:
    status: existing
    scope: overlay/classification and promotion-to-repair-work-unit behavior
  CommandResult_Issue_DTO:
    status: existing_output_only
    scope: ephemeral CLI output
    canonical: false
  ProjectIssue:
    status: new_in_M22
    scope: persistent project-level or cross-execution lifecycle
    canonical: true
```

M22 must design and persist a new `ProjectIssueSchema`. The exact storage location is decided by the M22 build specification, but it must be an optional additive state field with deterministic defaults so all pre-M22 fixtures remain valid. The output-only `Issue` DTO in `CommandResult` must not be reused or silently reinterpreted as `ProjectIssue`.

Minimum ProjectIssue contract responsibilities:

- stable `projectIssueId` and deterministic `issueKey`;
- title and compact description;
- canonical severity and lifecycle status;
- source type and source references;
- affected work-unit and milestone references;
- evidence, checkpoint, review, or manual provenance references;
- acknowledgment/resolution/promotion metadata where applicable;
- timestamps using existing canonical conventions;
- compatibility with existing centralized classification and repair-work-unit promotion behavior.

Missing ProjectIssue state must behave as an empty collection. A schema-version bump is not assumed; the build specification must justify one only if additive compatibility proves impossible.

## 6.2 Core evidence contract

Evidence records must bind to:

- `evidenceId`;
- `contractVersion`;
- `providerId` and `providerType`;
- `workUnitId`;
- `packetId`;
- `implementationRootId`;
- branch/commit/fingerprint when available;
- reviewer identity/type and independent-context declaration;
- review, validation, and acceptance result summaries;
- source findings;
- decision escalations;
- artifact references or digests only.

Logs, screenshots, and binary evidence remain external references, not canonical JSON payloads.

## 6.3 Exact finding normalization rule — resolves F-06

```yaml
finding_normalization:
  step_1_deduplicate:
    - compute a deterministic source fingerprint and canonical issue key
    - if that key already links to an existing CheckpointIssue or ProjectIssue, link the new evidence to the existing canonical record
  step_2_checkpoint_issue:
    create_or_link_CheckpointIssue_only_when_all_are_true:
      - source evidence references a valid checkpointId
      - finding scope is execution_local
      - related records are limited to that checkpoint, packet, and one work unit
      - remediation can be validated by a new execution, checkpoint amendment, or replacement evidence for the same work unit
      - finding does not declare cross-work-unit, project, release, architecture, legal, governance, or persistent external-setup scope
  step_3_project_issue:
    create_or_link_ProjectIssue_when_any_is_true:
      - no valid checkpointId exists
      - finding affects multiple checkpoints, work units, or milestones
      - finding concerns architecture, security policy, release readiness, legal/compliance, repository governance, or persistent external setup
      - finding remains relevant independently of the originating execution
      - project-level acknowledgment, ownership, resolution, release tracking, or promotion is required
  step_4_transition_and_promotion:
    - do not create both records for one canonical condition during initial normalization
    - when an existing CheckpointIssue later crosses the project-level trigger, create_or_link one ProjectIssue through an explicit auditable transition
    - preserve the original CheckpointIssue, evidence, and transition link
    - reuse the canonical issue key so promotion-to-repair-work-unit cannot create duplicate repair work
```

Evidence source fields do not authoritatively define canonical severity, `agentCanFix`, issue status, acknowledgment, or release classification. Existing centralized classification remains authoritative and must be extended deliberately for ProjectIssue rather than duplicated.

## 6.4 Decision escalations

Human product, architecture, security, legal/compliance, and external-setup decisions are represented independently from issues. An escalation has open/resolved/withdrawn status and may block workflow according to existing policy, but it is not a severity or fixability label.

## 6.5 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| New ProjectIssue schema breaks historical state | Medium | High | 50 | optional additive field, deterministic empty default, full historical fixture suite | 25 |
| CheckpointIssue and ProjectIssue create duplicate lifecycles | Medium | High | 50 | deterministic canonical key, no-dual-creation rule, explicit transition link | 25 |
| Output-only Issue DTO is confused with persisted ProjectIssue | Medium | High | 50 | distinct schema/type names and repository-grounded contract tests | 17 |
| Evidence binds to the wrong packet/root/code state | Medium | High | 50 | identity fields, mismatch states, freshness model, no enforcement in M22 | 33 |
| Provider findings control canonical severity or fixability | Medium | High | 50 | source fields treated as claims; centralized classification remains authoritative | 25 |
| Canonical state grows without bound | Medium | Medium | 33 | summaries/digests/references only, explicit state-growth limits | 17 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 6.6 Out of scope

- provider execution or network calls;
- automatic review;
- required evidence;
- automatic issue resolution;
- worktree metadata;
- provider-specific core fields;
- dynamic plugins;
- large binary/log payload persistence.

## 6.7 Entry conditions

- M21 merged at residual risk 10 or below;
- existing `CheckpointIssueSchema`, issue classification, override, and promotion-to-repair-work-unit behavior confirmed from repository code;
- proposed ProjectIssue storage location and additive compatibility model reviewed;
- three generic evidence examples reviewed;
- state-growth limits defined;
- implementation-entry risk recalculated at 25 or below.

## 6.8 Exit criteria

- evidence remains optional and advisory;
- existing projects and checkpoints behave identically without evidence or ProjectIssue state;
- new ProjectIssue state is optional, additive, and deterministic when absent;
- source findings normalize deterministically to exactly one initial canonical lifecycle;
- CheckpointIssue-to-ProjectIssue transition is explicit, linked, and idempotent;
- repair-work-unit promotion reuses the canonical issue key;
- F-06 routing rules have unit, integration, state-migration/default, and idempotency tests;
- Zod fixtures cover minimal/full valid ProjectIssue and evidence records, omitted optionals, unknown fields, invalid enums, duplicate keys, broken references, malformed JSON, and historical state fixtures;
- evidence mismatch/staleness can be represented;
- canonical JSON stores summaries, hashes, and references only;
- merge residual risk is 12 or below.

---

# 7. M23 — External Evidence Import and Normalization

```yaml
milestone:
  id: M23
  objective: import versioned external evidence safely through static data adapters without executing providers
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 33
    mergeResidualTarget: 15
```

## 7.1 Provider-neutral import model

Initial built-in input contracts:

- `generic-evidence-json@1`;
- `generic-ci-json@1`;
- `manual-evidence-json@1`.

Inputs are accepted from stdin or file, schema-validated, normalized into M22 evidence, hashed, deduplicated, and applied through candidate-state validation and atomic writes.

Trust levels:

```text
unverified | self_reported | repository_local | platform_verified
```

A trust label is provenance. It does not independently prove correctness.

## 7.2 Out of scope

- dynamic plugins;
- loading code from project paths;
- provider installation or execution;
- automatic API calls;
- shell adapters;
- automatic PR creation;
- required evidence gates.

## 7.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Untrusted payload is treated as authoritative | Medium | High | 50 | trust metadata, advisory-only use, canonical classification after normalization | 25 |
| Adapter drift changes interpretation | Medium | High | 50 | explicit contract version, deterministic fixtures, rejection of unknown major versions | 33 |
| Provider-specific fields leak into core semantics | Medium | High | 50 | strict M22 normalization boundary and extension namespace | 25 |
| Replay causes duplicate mutation | Medium | Medium | 33 | source digest, idempotency key, candidate-state deduplication | 17 |
| Invalid input partially mutates state | Medium | Medium | 33 | full candidate-state validation and atomic writes | 17 |
| Malformed references create orphan evidence/issues | Medium | High | 50 | reference validation before normalization and no partial writes | 25 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 7.4 Entry and exit

Entry requires M22 residual risk 12 or below, approved generic schemas, deterministic fixtures, no executable adapter design, and entry risk 33 or below.

Exit requires idempotent imports, no partial writes, no executable adapter surface, preserved source digest, deterministic trust representation, unchanged no-evidence workflows, and residual risk 15 or below.

Zod fixtures must cover every built-in contract: minimal/full valid payloads, optional omissions, unknown fields, invalid versions/enums, broken references, duplicate identity/digest, malformed JSON, replay, and backward-compatible state application.

---

# 8. M24 — Workspace Assignment and Parallel Eligibility Metadata

```yaml
milestone:
  id: M24
  objective: represent workspace assignment, leases, branch ownership, overlap, and parallel eligibility without performing Git or filesystem mutations
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 30
    mergeResidualTarget: 12
```

## 8.1 In scope

- provider-neutral workspace records;
- `workspaceId`, `providerId`, `implementationRootId`, `workUnitId`, `packetId`;
- branch and base commit metadata;
- lease states: available, leased, released, stale, invalid;
- declared affected areas;
- dependency-aware parallel eligibility;
- exclusive/global migration locks;
- overlap warnings;
- merge-order metadata;
- conservative concurrency limits;
- review/manage visibility.

## 8.2 Out of scope

- `git worktree add/remove`;
- branch creation/deletion;
- reset, clean, force checkout, or merge;
- filesystem workspace creation;
- provider process execution;
- proof of semantic isolation.

## 8.3 Safety rule

```text
workspace metadata may show that two tasks are physically separated;
it must never claim that their domain or architectural effects are semantically independent.
```

## 8.4 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Duplicate exclusive leases assign one workspace twice | Medium | High | 50 | deterministic lease identity, candidate-state uniqueness, explicit stale recovery | 25 |
| Dependency-blocked work is marked parallel-eligible | Medium | High | 50 | effective dependency reuse and conservative first-match eligibility rules | 25 |
| Affected-area overlap is missed | Medium | High | 50 | explicit declarations, unknown-area fallback, global/exclusive lock categories | 33 |
| Filesystem separation is mistaken for semantic safety | Medium | High | 50 | warnings only; no semantic-independence claim in state or output | 25 |
| Stale lease metadata blocks progress indefinitely | Medium | Medium | 33 | explicit stale/invalid states and human recovery workflow | 17 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 8.5 Entry and exit

Entry requires a demonstrated parallel-work use case, reliable effective dependencies, reviewed affected-area semantics, conservative default concurrency, and entry risk 30 or below.

Exit requires no destructive Git operation, deterministic lease recovery, prevention of duplicate exclusive leases, dependency-blocked work never becoming eligible, visible overlap risk, unchanged projects without workspace metadata, and residual risk 12 or below.

Zod fixtures must cover valid/invalid workspace records, omitted optional metadata, unknown states, duplicate leases, broken work-unit/packet/root references, malformed JSON, and historical state without workspace fields.

---

# 9. M25 — Managed Workspace Provider Adapters

```yaml
milestone:
  id: M25
  objective: define versioned request/response adapters for one reviewed external workspace manager after M24 metadata is proven
  optional: true
  risk:
    inherent: 75
    controlledDesignTarget: 50
    implementationEntryTarget: 30
    mergeResidualTarget: 15
```

## 9.1 Scope boundary

AIQT may generate a provider request and import a provider response. AIQT core does not directly execute Git operations or arbitrary provider commands in this milestone.

Supported abstract operations:

- request workspace acquisition;
- import acquired workspace identity/path/branch/base commit;
- request release;
- import released/stale/invalid state;
- validate provider response against the M24 lease and packet.

## 9.2 Prohibited behavior

- shell execution;
- direct Git worktree mutation;
- automatic reset/clean/delete;
- automatic merge;
- provider code loaded dynamically;
- silent lease takeover;
- claiming semantic safety.

## 9.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Provider response points to the wrong or unsafe workspace | High | High | 75 | reviewed versioned payload, canonical root/path validation, packet/lease binding | 33 |
| Provider contract is unstable or underspecified | High | High | 75 | no build until one concrete contract and fixture corpus exist | 50 |
| Adapter behavior expands into execution or Git mutation | High | High | 75 | data-only request/response boundary and prohibited-process tests | 33 |
| Replayed response takes over an active lease | Medium | High | 50 | idempotency key, expected lease version, no silent takeover | 25 |
| Provider-specific semantics leak into core workspace model | Medium | High | 50 | normalization layer and extension namespace | 25 |

Maximum controlled hazard before a concrete provider review: `50`, matching `controlledDesignTarget`. Gate E requires evidence sufficient to reduce implementation-entry risk to `30` or below.

## 9.4 Entry and exit

M25 begins only when a real external workspace manager exists, its request/response contract is stable and separately reviewed, M24 has been dogfooded, path/root trust rules are proven, and entry risk is 30 or below.

Exit requires versioned fixtures, idempotent response import, stale/invalid handling, no destructive operation inside AIQT, explicit human recovery, and residual risk 15 or below.

Zod fixtures must cover request/response success, missing/unknown provider versions, wrong packet/lease/root identity, duplicate/replayed responses, stale/released/invalid states, malformed JSON, and no-mutation failure paths.

---

# 10. M26 — Long-Running Execution Protocol

```yaml
milestone:
  id: M26
  objective: model external multi-iteration execution sessions without running them
  optional: true
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 30
    mergeResidualTarget: 12
```

## 10.1 In scope

- session identity bound to work unit, packet, workspace, and provider;
- session status: planned, running, paused, blocked, failed, completed, cancelled, stale;
- optional iteration/token/duration budgets;
- iteration records and commit references;
- evidence references;
- learning summaries;
- provider-reported rollback records;
- human-decision-required status;
- stale-session detection;
- review/manage visibility.

## 10.2 Invariants

- iteration completion never means work-unit completion;
- provider-reported rollback is historical metadata only;
- AIQT never performs rollback;
- session completion still requires checkpoint and evidence processing;
- learning summaries do not replace canonical decisions or requirements.

## 10.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Session completion is mistaken for work-unit completion | Medium | High | 50 | separate status namespaces and checkpoint-only completion authority | 25 |
| Provider-reported rollback is treated as an AIQT mutation | Medium | High | 50 | historical metadata only and explicit non-execution invariant | 33 |
| Long-running session records grow canonical state without bound | Medium | Medium | 33 | summaries, capped iteration metadata, external logs/artifacts | 17 |
| Stale session blocks future work | Medium | High | 50 | explicit stale state, expiry/recovery rules, no automatic cancellation | 25 |
| Learning summaries override canonical decisions | Medium | High | 50 | references only; decisions/requirements remain authoritative | 25 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 10.4 Entry and exit

Entry requires a real multi-context execution need, a reviewed metadata-only protocol, bounded state-growth rules, and entry risk 30 or below. The milestone may be skipped.

Exit requires metadata-only behavior, explicit budgets and stop conditions, no agent/shell execution, no automatic rollback, interruption on human-decision-required state, unchanged projects without sessions, and residual risk 12 or below.

Zod fixtures must cover all session states, valid/invalid transitions, omitted budgets, broken work-unit/packet/workspace/provider references, duplicate sessions/iterations, stale detection, malformed JSON, and legacy state without sessions.

---

# 11. M27 — Long-Running Execution Provider Adapter

```yaml
milestone:
  id: M27
  objective: normalize one stable external execution provider into the M26 protocol without embedding its runtime
  optional: true
  risk:
    inherent: 75
    controlledDesignTarget: 50
    implementationEntryTarget: 30
    mergeResidualTarget: 15
```

## 11.1 In scope

- one separately reviewed, versioned provider payload contract;
- stdin/file result import;
- request package generation where useful;
- session/iteration normalization;
- provider health and stale-state representation;
- source digest and idempotency;
- fixture-based compatibility tests.

## 11.2 Out of scope

- spawning the provider;
- remote terminal control;
- credential management;
- automatic cancellation or rollback;
- direct token billing;
- automatic implementation.

## 11.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Provider payload semantics are unstable or misinterpreted | High | High | 75 | no build until one stable versioned contract and fixture corpus exist | 50 |
| Adapter becomes a hidden execution surface | High | High | 75 | stdin/file data-only boundary, no process/network code, security regression tests | 33 |
| Provider reports false rollback/completion state | Medium | High | 50 | provenance-only normalization; checkpoint/evidence remain authoritative | 25 |
| Replayed iteration mutates session history twice | Medium | Medium | 33 | source digest, iteration identity, idempotent import | 17 |
| Provider outage blocks unrelated workflows | Medium | High | 50 | optional adapter and explicit unavailable/stale states | 25 |

Maximum controlled hazard before a concrete provider review: `50`, matching `controlledDesignTarget`. Gate G requires evidence sufficient to reduce implementation-entry risk to `30` or below.

## 11.4 Entry and exit

M27 begins only when M26 is proven, one stable producer exists, the payload contract is separately reviewed, and entry risk is 30 or below.

Exit requires no runtime coupling, deterministic compatibility fixtures, no provider-specific core semantics, recoverable stale sessions, and residual risk 15 or below.

Zod fixtures must cover all supported payload versions, unknown versions, missing identities, duplicate/replayed iterations, contradictory completion/rollback claims, stale/unavailable provider state, malformed JSON, and no-mutation failures.

---

# 12. M28 — Evidence Gate Simulation

```yaml
milestone:
  id: M28
  objective: compute what evidence policies would do without changing checkpoints, readiness, or workflow state
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 25
    mergeResidualTarget: 10
```

## 12.1 In scope

- evidence policy profile schema;
- modes represented as off/advisory/required for simulation only;
- gate targets: checkpoint, development review, release review;
- requirements for evidence type, trust, freshness, and provider constraints;
- read-only `wouldPass`, missing, stale, mismatched, unavailable, and exception-needed results;
- deterministic recovery guidance;
- simulation output through human and JSON modes;
- no state mutation.

Successful pure simulation does not append a runlog event because it is a deterministic derived read, performs no execution or external interaction, and does not mutate canonical state. This is an explicit exception aligned with existing read-only command behavior, not an omission.

## 12.2 Out of scope

- changing checkpoint outcomes;
- changing effective readiness;
- creating blocking findings solely from simulation;
- required-mode activation;
- provider execution;
- network calls.

## 12.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Simulation result diverges from later enforcement logic | Medium | High | 50 | one shared policy evaluator contract and parity fixtures reserved for M29/M30 | 33 |
| Simulation mutates state or runlog | Medium | High | 50 | pure service boundary, immutable inputs, before/after filesystem tests | 17 |
| Policy ambiguity produces inconsistent `wouldPass` results | Medium | High | 50 | exhaustive precedence table and deterministic sort/evaluation order | 25 |
| Missing evidence is confused with failed or unavailable evidence | Medium | Medium | 33 | explicit result enum and recovery guidance per state | 17 |
| No-runlog behavior is mistaken for missing observability | Medium | Medium | 33 | normative read-only justification and deterministic JSON output | 17 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 12.4 Entry and exit

Entry requires M22-M23 evidence behavior dogfooded, a shared evaluator design, and entry risk 25 or below.

Exit requires parity between repeated simulation runs, exhaustive policy-state tests, no mutation, no impact on existing commands, and residual risk 10 or below.

Zod fixtures must cover valid policy profiles, omitted optionals, unsupported modes/gates, invalid trust/freshness/provider constraints, contradictory policies, broken evidence references, malformed JSON, and historical state without policy fields.

---

# 13. M29 — Advisory Checkpoint Evidence Integration

```yaml
milestone:
  id: M29
  objective: integrate evidence evaluation into checkpoint, review, manage, and exports as advisory information without changing completion or readiness semantics
  risk:
    inherent: 50
    controlledDesignTarget: 33
    implementationEntryTarget: 30
    mergeResidualTarget: 12
```

## 13.1 In scope

- checkpoint evidence references;
- advisory evaluation summaries;
- warnings for failed, stale, unavailable, or below-trust evidence;
- centralized findings through CheckpointIssue or ProjectIssue services;
- review/manage/export consistency;
- M12 amendment support for attaching replacement evidence;
- M18 effective-readiness observation only;
- telemetry needed to measure false positives and workflow friction.

## 13.2 Non-negotiable behavior

```yaml
advisory_semantics:
  - a checkpoint that could become done before M29 can still become done
  - advisory evidence failures may create warnings/findings but do not block done
  - downstream readiness is unchanged
  - no policy is silently upgraded to required
  - no historical completed work is invalidated
```

## 13.3 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Advisory integration changes checkpoint completion semantics | Medium | High | 50 | transition-parity matrix and regression fixtures against pre-M29 behavior | 33 |
| Evidence findings are duplicated across CheckpointIssue and ProjectIssue | Medium | High | 50 | M22 canonical key and routing service reused without alternate path | 25 |
| Amendment replacement evidence bypasses canonical effective-result logic | Medium | High | 50 | attach-only amendment path and shared `computeEffectiveCheckpointResult` integration | 25 |
| Review/manage/export classify the same evidence differently | Medium | High | 50 | one centralized evaluation/classification service | 25 |
| Telemetry grows canonical state or captures large payloads | Medium | Medium | 33 | aggregate counters/summaries only; no raw logs/artifacts | 17 |

Maximum controlled hazard: `33`, matching `controlledDesignTarget`.

## 13.4 Entry and exit

Entry requires M28 simulation residual risk 10 or below, an approved transition-parity test plan, M12/M18 integration design, and entry risk 30 or below.

Exit requires zero checkpoint-semantic regressions, centralized findings, measured false-positive data, validated stale recovery, M12/M18 regression suites green, and residual risk 12 or below.

Zod fixtures must cover advisory evaluation summaries, evidence references, replacement evidence through amendments, invalid/stale/mismatched states, CheckpointIssue/ProjectIssue routing, malformed JSON, and legacy checkpoints without evidence.

---

# 14. M30 — Required Evidence Enforcement

```yaml
milestone:
  id: M30
  objective: allow explicit project policies to make selected evidence mandatory for checkpoint, development review, or release review
  risk:
    inherent: 100
    controlledDesignTarget: 50
    implementationEntryTarget: 35
    mergeResidualTarget: 15
    projectActivationResidualTarget: 5
```

M30 is the only milestone in this roadmap that changes load-bearing completion semantics. Its high inherent risk is expected. Its implementation is prohibited until entry risk is 35 or below.

## 14.1 Preconditions

- M21-M23 complete;
- M28 and M29 complete and dogfooded;
- M24-M27 complete only if their capabilities are used by required policies;
- at least three representative applications completed in advisory mode;
- M12 amendment and M18 effective-readiness composition tests green;
- no unresolved deadlock or state-corruption finding;
- stale/mismatch/unavailable recovery proven;
- provider trust model reviewed;
- required mode remains explicit opt-in;
- implementation-entry risk recalculated at 35 or below.

## 14.2 Required policy behavior

Policy may require:

- evidence type;
- minimum trust level;
- freshness;
- accepted providers;
- gate target;
- unavailable behavior;
- failure behavior;
- governed exception eligibility.

No provider execution or network call occurs during checkpoint evaluation.

## 14.3 Composition with M12 amendments

- evidence gates evaluate the effective checkpoint result derived through `computeEffectiveCheckpointResult` or its canonical successor;
- amendments may change `acceptanceCriteriaResult` and/or `validationResult` and may attach or replace evidence;
- an amendment may move `needs_review → done` only when the current required policy passes or a valid scoped exception applies;
- changing `acceptanceCriteriaResult` or `validationResult` alone cannot bypass evidence;
- generic amendment APIs cannot waive requirements;
- exceptions require identity, reason, scope, policy reference, timestamp, and runlog event;
- development exceptions do not automatically satisfy release gates.

## 14.4 Composition with M18 effective readiness

- new work under required mode is not effectively done until evidence policy passes or a valid exception applies;
- downstream blocking dependencies are satisfied only after effective done;
- work completed before activation is grandfathered;
- later evidence staleness creates findings, not silent status reversal;
- already released downstream readiness is not retroactively withdrawn;
- policy changes are prospective by default.

## 14.5 Transition matrix

| Mode | Evidence | Requested result | Outcome |
|---|---|---|---|
| off | any/none | done | existing behavior |
| advisory | passed | done | done |
| advisory | failed/stale/unavailable | done | done with warning |
| required | current and compliant | done | done |
| required | failed | done | needs_review |
| required | unavailable | done | policy-defined blocked or needs_review |
| required | missing | done | blocked without mutation |
| required | mismatched identity/root/code | done | invalid input without mutation |
| required | trust below threshold | done | policy-defined blocked or needs_review |
| required | valid scoped exception | done | done with visible exception finding |

No unspecified transition is allowed.

## 14.6 Primary hazards and controls

| Hazard | Probability | Impact | Inherent | Design control | Controlled |
|---|---|---|---:|---|---:|
| Required gate falsely marks incomplete work done | High | Critical | 100 | M28 shared simulation, M29 advisory telemetry, identity/trust/freshness checks | 50 |
| Required gate deadlocks legitimate workflow | High | Critical | 100 | exhaustive transition/recovery matrix, unavailable policy, governed exceptions | 50 |
| Checkpoint amendment bypasses evidence | High | Critical | 100 | effective-result integration and prohibition on result-only waiver | 33 |
| Effective readiness disagrees with checkpoint outcome | High | Critical | 100 | one effective-result/evidence evaluator and M18 parity suite | 50 |
| Required policy retroactively invalidates legacy work | High | Critical | 100 | off default, explicit activation, grandfathering, prospective policy changes | 33 |
| Provider outage blocks unrelated non-required work | Medium | High | 50 | per-policy unavailable behavior and no global provider dependency | 25 |

Maximum controlled hazard: `50`, matching `controlledDesignTarget`. M28/M29 dogfood and Gate J evidence are required to reduce implementation-entry risk to `35` or below.

## 14.7 Entry, merge, and activation gates

```yaml
m30_gates:
  build_entry:
    maximumRisk: 35
    required: true
  merge:
    maximumResidualRisk: 15
    required: true
  project_activation:
    maximumResidualRisk: 5
    interpretation: every known project-specific activation risk must be closed
    requires:
      - explicit human activation
      - project-specific advisory period
      - accepted false-positive rate
      - every required rule has a tested recovery path
      - no unresolved deadlock scenario
```

## 14.8 Exit criteria

- mode defaults to off;
- old projects remain unchanged;
- required mode is explicit per project;
- no shell/network/provider execution during gates;
- evidence identity, code-state, trust, and freshness are checked;
- every block has recovery guidance;
- generic amendments cannot bypass evidence;
- effective readiness and checkpoint use one effective-result service;
- grandfathering is deterministic;
- exceptions are visible and auditable;
- Zod fixtures cover policy profiles, required/off/advisory modes, all transition-matrix rows, exception records, invalid trust/freshness/provider constraints, malformed JSON, and historical state without policy fields;
- merge residual risk is 15 or below;
- no project is authorized to activate required mode until its activation residual risk is 5 or below.

---

## 15. Cross-Milestone Risk Register

| ID | Risk | Milestones | Inherent severity | Primary control |
|---|---|---|---|---|
| R-001 | AIQT becomes a generic shell runner | M23-M30 | Critical | execution remains external |
| R-002 | Provider semantics leak into canonical workflow | M22-M27 | High | normalized contracts and extension namespaces |
| R-003 | Evidence binds to wrong packet/root/code | M22-M30 | Critical | identity, provenance, and freshness binding |
| R-004 | CheckpointIssue and ProjectIssue lifecycles drift or duplicate | M22-M30 | High | canonical issue key, deterministic routing, explicit transition |
| R-005 | Output-only Issue DTO is mistaken for canonical ProjectIssue | M22 | High | distinct type/schema names and repository-grounded tests |
| R-006 | Reviewer independence is mistaken for proof | M22-M30 | High | provenance only plus deterministic evidence policy |
| R-007 | Human architectural understanding declines | M24-M27 | High | decision escalation and compact summaries |
| R-008 | Workspace isolation hides semantic conflicts | M24-M25 | Critical | overlap and merge-order governance |
| R-009 | Untrusted payload is treated as authoritative | M23-M30 | High | trust metadata and staged enforcement |
| R-010 | Required mode deadlocks workflow | M30 | Critical | M28 simulation, M29 advisory, recovery matrix |
| R-011 | Governance claims exceed real platform controls | M21-M30 | High | explicit branch-protection decision and truthful terminology |
| R-012 | Implementation root becomes unsafe execution boundary | M21-M30 | Critical future | trust contract and no core execution |
| R-013 | Canonical state grows without bound | M22-M27 | Medium | digests, summaries, caps, external artifacts |
| R-014 | Automated correction changes intent | M22-M30 | High | no auto-fix in roadmap |
| R-015 | Required mode changes legacy projects | M30 | Critical | off default and grandfathering |
| R-016 | Adapter drift corrupts normalization | M23/M25/M27 | High | versioned contracts and fixtures |
| R-017 | Amendments bypass required evidence | M30 | Critical | effective-result composition and no generic waiver |
| R-018 | Effective readiness disagrees with checkpoint | M30 | Critical | one effective-result/evidence service |
| R-019 | Provider outage blocks non-required work | M23-M30 | High | advisory defaults and policy-specific behavior |
| R-020 | New schema invalidates historical state | M22-M30 | High | additive optional fields and historical Zod fixtures |

---

## 16. Decision Gates

### Gate A — Before M21 build

- baseline commit, tag, package version, CI, runtime, package metadata, and repository settings verified;
- branch-protection decision category selected and compensating controls documented when unenforced;
- coverage provider choice reviewed;
- SECURITY.md scope and support language approved;
- M21 entry risk 25 or below.

### Gate B — Before M22 build

- M21 residual risk 10 or below;
- existing CheckpointIssue, classification, override, and promotion-to-repair-work-unit behavior verified;
- new ProjectIssue storage and additive-compatibility design approved;
- output-only Issue DTO separation confirmed;
- F-06 normalization and transition rules accepted;
- M22 entry risk 25 or below.

### Gate C — Before M23 build

- M22 residual risk 12 or below;
- three generic payload fixtures approved;
- ProjectIssue and CheckpointIssue routing fixtures green;
- no executable adapter design;
- M23 entry risk 33 or below.

### Gate D — Before M24 build

- real parallel-work requirement documented;
- effective dependencies and affected-area semantics reviewed;
- M24 entry risk 30 or below.

### Gate E — Before M25 build

- M24 residual risk 12 or below;
- one stable external workspace provider contract and fixture corpus exist;
- path/root trust model is proven;
- provider remains external and data-only;
- M25 entry risk 30 or below.

### Gate F — Before M26 build

- real long-running execution need documented;
- metadata-only protocol sufficient;
- state-growth cap reviewed;
- M26 entry risk 30 or below.

### Gate G — Before M27 build

- M26 residual risk 12 or below;
- one stable external producer contract and fixture corpus exist;
- provider remains external and data-only;
- M27 entry risk 30 or below.

### Gate H — Before M28 build

- M22-M23 evidence dogfood complete;
- one shared policy evaluator design approved;
- pure simulation and no-runlog rationale accepted;
- M28 entry risk 25 or below.

### Gate I — Before M29 build

- M28 residual risk 10 or below;
- checkpoint parity plan approved;
- M12/M18 regression strategy approved;
- CheckpointIssue/ProjectIssue advisory routing proven;
- M29 entry risk 30 or below.

### Gate J — Before M30 build

- M29 residual risk 12 or below;
- three representative advisory projects complete;
- false-positive and deadlock data reviewed;
- M12 effective-amendment and M18 effective-readiness composition proven;
- platform enforcement gap closed or explicitly accepted with compensating controls;
- M30 entry risk 35 or below.

### Gate K — Before required mode activation in a project

- M30 residual risk 15 or below;
- project advisory period complete;
- every project-specific activation risk closed;
- project activation residual risk 5 or below;
- explicit human activation recorded.


---

## 17. Global Non-Goals

```yaml
global_non_goals:
  - execute arbitrary validationCommands
  - build a generic agent or shell runner
  - dynamically load executable plugins
  - define core semantics around a named third-party tool
  - make markdown or HTML canonical state
  - automatically merge, reset, clean, or delete Git state
  - hide evidence failures through generic force flags
  - treat agent review as deterministic proof
  - assume filesystem isolation proves semantic isolation
  - enable high concurrency by default
  - activate required evidence before simulation and advisory dogfood
  - create a provider-specific, duplicate, or uncoordinated issue lifecycle
  - retroactively invalidate completed dependency chains
  - perform provider network calls during checkpoint
```

---

## 18. Overall Risk Interpretation

```yaml
overall_assessment:
  architectural_direction: viable
  reason:
    - control plane remains separate from execution providers
    - contracts precede adapters
    - adapters precede policy simulation
    - simulation precedes advisory integration
    - advisory integration precedes required enforcement
  highest_inherent_hazard:
    milestone: M30
    score: 100
    interpretation: a defective completion gate can deadlock or falsely complete work
  authoritative_go_no_go_measure: implementationEntryRisk
  rule: no milestone begins above 35
  merge_rule: no milestone merges above residual risk 15
  activation_rule: no project enables required mode above residual risk 5
```

The roadmap does not claim that inherent risk disappears. It reduces blast radius until each implementation step can enter build at an acceptable risk.

---

## 19. Reviewer Instructions

Review this document as a roadmap and architecture proposal, not a build specification. Ground the review in the actual repository when available.

Verify:

1. M20 baseline and M21-M30 numbering;
2. separation of inherent, controlled-design, entry, merge-residual, and activation risk;
3. every entry target is 35 or below;
4. M22 repository-grounded CheckpointIssue/ProjectIssue routing, new ProjectIssue persistence, and no dual creation;
5. no hidden shell, Git mutation, network, or dynamic-plugin surface;
6. M24/M25 split between metadata and provider adapters;
7. M26/M27 split between protocol and provider adapter;
8. M28/M29/M30 staging of simulation, advisory integration, and enforcement;
9. M30 composition with M12 amendments and M18 effective readiness;
10. backward compatibility, grandfathering, and recovery;
11. optional milestones do not block M28-M30 unless their features are used;
12. every milestone has a hazard/control table whose maximum controlled value matches its controlledDesignTarget;
13. M25 and M27 cannot enter build above risk 30;
14. Zod fixture requirements cover every new schema and external contract;
15. M21 includes a coverage provider, SECURITY.md, and an explicit branch-protection decision.

Required output:

```yaml
review_output:
  overall_score_0_to_100: required
  decision: approve | approve_with_changes | reject
  architecture_alignment_score_0_to_100: required
  risk_model_score_0_to_100: required
  milestone_boundary_score_0_to_100: required
  backwards_compatibility_score_0_to_100: required
  findings:
    - id
    - severity: critical | high | medium | low
    - section
    - finding
    - impact
    - required_change
  baseline_validation:
    package_version: value_or_unknown
    latest_milestone: value_or_unknown
    numbering_collision: true_or_false
  f_06_validation:
    resolved: true_or_false
    project_issue_schema_new_and_explicit: true_or_false
    comments: string
  hidden_execution_surfaces: array
  missing_requirements: array
  unnecessary_scope: array
  sequencing_changes: array
  schema_concerns: array
  workflow_state_concerns: array
  security_concerns: array
  test_gaps: array
  revised_risk_posture:
    M21: { inherent: number, entry: number, residual: number }
    M22: { inherent: number, entry: number, residual: number }
    M23: { inherent: number, entry: number, residual: number }
    M24: { inherent: number, entry: number, residual: number }
    M25: { inherent: number, entry: number, residual: number }
    M26: { inherent: number, entry: number, residual: number }
    M27: { inherent: number, entry: number, residual: number }
    M28: { inherent: number, entry: number, residual: number }
    M29: { inherent: number, entry: number, residual: number }
    M30: { inherent: number, entry: number, residual: number, activation: number }
  recommended_next_action: string
```

Approval threshold:

```text
Approve only when overall_score >= 95,
no critical or high finding remains unresolved,
M21-M30 numbering is collision-free,
F-06 is resolved against the real repository,
every controlled-design score is supported by explicit hazard controls,
and no milestone is authorized to start above its implementation-entry threshold.
```
