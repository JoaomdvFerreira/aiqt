# AIQT Milestone 22 Build Specification v0.2

## Independent Review and Evidence Contracts

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Revised review candidate before build handoff
  milestone:
    id: M22
    title: Independent Review and Evidence Contracts
  baseline:
    expected_latest_completed_milestone:
      id: M21
      title: Runtime, Supply Chain, and Repository Governance Hardening
    expected_package_version: 0.8.3
    expected_main_commit: db16b23
    expected_release_tag: v0.8.3
    expected_m21_final_tag: m21-runtime-supply-chain-governance-hardening-final
    expected_test_count: 1216
    expected_open_critical_high_dependency_alerts: 0
    verification_required: true
  aligns_with:
    - AIQT Post-M20 Proposed Milestones Roadmap v0.4
    - AIQT Milestone 21 Build Specification v0.3 and final implementation reports
    - current repository schemas, issue classification, checkpoint amendment, and effective-readiness services
  primary_agent_target: Claude Code, Codex, or equivalent coding agent
  architecture_role: local workflow control plane
  risk:
    inherent: 50
    controlled_design_target: 33
    implementation_entry_target: 25
    merge_residual_target: 12
```

---

## 0. Document Position

M22 is the first evidence-model milestone after the M21 repository hardening baseline.

M22 defines canonical, provider-neutral contracts for:

- independent-review evidence;
- evidence provenance and trust;
- code-state and workflow identity binding;
- source findings;
- project-level issues;
- deterministic routing between checkpoint-scoped and project-scoped issue lifecycles;
- human decision escalations;
- auditable lifecycle transitions.

M22 does **not** import external provider payloads, execute validation, call networks, spawn agents, alter checkpoint completion, or enforce evidence requirements.

The governing architecture remains:

```text
AIQT defines and persists contracts.
External systems perform implementation and validation.
Future milestones import and normalize external results.
Evidence remains advisory until later simulation and checkpoint-integration milestones.
```

AIQT is the product being built. Development of M22 must use repository specifications, Git, CI, tests, commits, tags, and structured implementation reports. It must not use `.aiqt/` self-management state or AIQT workflow commands to govern its own implementation.

### 0.1 v0.2 Change Summary

v0.2 resolves the two findings from the v0.1 technical review:

1. `ProjectIssue` no longer persists a second mutable lifecycle status, acknowledgment, or resolution model. The existing issue-state override and promotion vocabulary remains the sole authoritative lifecycle owner.
2. The risk register now includes an explicit Controlled score for every hazard, proving that the milestone-level `controlled_design_target: 33` is derived from the maximum controlled hazard rather than asserted independently.

No milestone scope, Gate B threshold, execution boundary, or required-evidence semantics changed.

---

## 1. Source Alignment

M22 is derived from the approved post-M20 roadmap v0.4 and its Gate B requirements.

Repository-grounded concepts that must remain distinct:

```yaml
issue_concepts:
  CheckpointIssue:
    status: existing
    persistence: checkpoint-scoped
    purpose: issue produced by one execution/checkpoint cycle
  IssueOverride_and_IssuePromotion:
    status: existing
    persistence: existing issue-state overlay
    purpose:
      - override normalized checkpoint-issue classification
      - promote an issue into a repair work unit
  CommandResult_Issue_DTO:
    status: existing
    persistence: none
    purpose: ephemeral command output
    canonical: false
  ProjectIssue:
    status: new_in_M22
    persistence: project workflow state
    purpose: cross-execution or project-level issue lifecycle
```

M22 must not rename, reinterpret, or persist the output-only `Issue` DTO as `ProjectIssue`.

M22 must preserve:

- existing `CheckpointIssueSchema`;
- existing checkpoint issue classification;
- existing issue overrides;
- existing issue promotion to repair work units;
- existing stable `issueKey` behavior;
- existing checkpoint amendments and effective-result computation;
- existing effective-readiness behavior;
- all workflows that contain no M22 evidence or ProjectIssue state.

---

## 2. Objective

M22 must prove that AIQT can:

1. represent independent-review and validation evidence as compact canonical records;
2. bind evidence to the correct work unit, packet, implementation root, and code state;
3. distinguish provider/source claims from canonical classification;
4. persist a new project-level issue lifecycle without invalidating historical state;
5. route each normalized finding initially to exactly one canonical issue lifecycle;
6. transition a checkpoint-scoped issue into a linked ProjectIssue when its scope expands;
7. preserve promotion-to-repair-work-unit deduplication through the canonical issue key;
8. represent human decisions separately from issue severity and fixability;
9. represent stale, mismatched, unavailable, and unknown evidence states;
10. keep all behavior advisory and non-executable;
11. preserve deterministic state, runlog, output, atomic-write, and exit-code conventions;
12. remain compatible with all pre-M22 project/state fixtures.

---

## 3. Gate B — Mandatory Pre-Build Verification

No implementation begins until the agent produces a read-only Gate B report.

```yaml
gate_b_report:
  git:
    current_branch: required
    working_tree_clean: required
    head_commit: required
    origin_sync_status: required
    relevant_tags: required
  product_baseline:
    package_version: required
    latest_completed_milestone: required
    release_tag: required
    test_count: required
    open_critical_high_dependency_alerts: required
    self_management_state_required: false
  checkpoint_issue_model:
    schema_path_and_shape: required
    checkpoint_linkage: required
    severity_and_status_values: required
    issue_key_generation: required
  issue_state_model:
    overrides_storage_and_behavior: required
    promotions_storage_and_behavior: required
    promotion_to_repair_work_unit_path: required
    deduplication_behavior: required
  output_issue_dto:
    path_and_shape: required
    persistence_status: required
    proof_it_is_not_canonical_ProjectIssue: required
  checkpoint_composition:
    amendment_schema_fields: required
    effective_checkpoint_result_service: required
    effective_readiness_service: required
  proposed_m22_storage:
    project_issue_location: required
    evidence_location: required
    decision_escalation_location: required
    transition_location: required
    additive_compatibility_proof: required
  state_growth:
    per_record_limits: required
    collection_limits_or_review_thresholds: required
  security_boundary:
    arbitrary_command_execution_added: false
    provider_network_calls_added: false
    dynamic_plugin_loading_added: false
  recalculated_entry_risk: required
```

### 3.1 Required current baseline

Expected current baseline:

```yaml
expected_current_baseline:
  package_version: 0.8.3
  release_tag: v0.8.3
  main_commit: db16b23
  tests: 1216
  critical_high_dependency_alerts: 0
```

If the live repository differs, the agent must report the real state and determine whether the discrepancy blocks M22. It must not rewrite history, move tags, or fabricate reconciliation.

### 3.2 Gate B storage decision

The preferred additive storage design is:

```yaml
state_extensions:
  issues:
    existing_owner: IssueStateSchema
    add:
      projectIssues: optional_array
      projectIssueTransitions: optional_array
  evidence:
    status: new_optional_state_section
    add:
      records: optional_array
      decisionEscalations: optional_array
```

Compatibility rules:

- `state.issues` continues to own overrides and promotions.
- `state.issues.projectIssues` is optional.
- `state.issues.projectIssueTransitions` is optional.
- `state.evidence` is optional.
- missing arrays behave as `[]` through repository helper functions;
- read-only parsing must not write or materialize missing fields;
- old state fixtures remain valid;
- no migration runs during a read-only command;
- successful M22 mutations persist only required non-empty sections;
- no `AIQT_SCHEMA_VERSION` bump is expected unless repository evidence proves additive compatibility impossible.

The build implementation may refine field names only if it documents why the preferred design conflicts with established schema ownership.

### 3.3 Risk aggregation

```text
implementationEntryRisk =
  max(current score of every open M22 hazard after Gate B controls)

mergeResidualRisk =
  max(residual score of every open or accepted M22 hazard)
```

M22 must not begin implementation until `implementationEntryRisk <= 25`.

Average, median, or manually selected milestone scores are not authoritative.

---

## 4. Public Command and User-Visible Behavior

M22 adds **no required new public CLI command**.

M22 provides internal schemas and services that M23 can use for external evidence import.

Existing commands must:

- continue to read historical state;
- continue to read valid M22 state;
- preserve current output, exit code, `projectStatus`, current pointers, and `nextRecommendedCommand` unless explicitly required for schema-invalid state;
- not treat missing evidence as a warning, failure, or blocker;
- not treat ProjectIssues as required-evidence failures;
- not execute referenced validation commands;
- not fetch artifact references;
- not call providers.

Optional additive read-only diagnostics may be included only when they reuse an existing report owner and do not change workflow navigation or exit codes. Full review/manage/export integration is deferred to M29.

---

## 5. Canonical Data Contracts

### 5.1 Trust-level ordering

M22 establishes the canonical ordinal trust model used by future evidence policy evaluation.

```yaml
trust_levels:
  unverified: 0
  self_reported: 1
  repository_local: 2
  platform_verified: 3
```

Rules:

- order is normative;
- comparison is `actual >= minimum`;
- trust is provenance, not proof of correctness;
- a provider may claim a trust level, but canonical trust assignment is controlled by AIQT normalization rules;
- M22 does not use trust to block workflow;
- unknown values are invalid input, not silently downgraded.

### 5.2 EvidenceRecord

Conceptual minimum:

```yaml
EvidenceRecord:
  evidenceId: stable_canonical_id
  contractVersion: supported_major_minor_version
  provider:
    providerId: non_empty_string
    providerType:
      - human
      - agent
      - repository
      - ci
      - platform
      - manual
      - unknown
    trustLevel:
      - unverified
      - self_reported
      - repository_local
      - platform_verified
  workflowBinding:
    workUnitId: required
    packetId: required
    checkpointId: optional
    implementationRootId: required
  codeBinding:
    branch: optional
    commitSha: optional
    repositoryFingerprint: optional
    workingTreeFingerprint: optional
    capturedAt: required_timestamp
  reviewer:
    reviewerId: optional
    reviewerType:
      - human
      - agent
      - system
      - unknown
    independentContext:
      - declared_independent
      - declared_not_independent
      - unknown
  results:
    reviewResult:
      - passed
      - failed
      - partial
      - not_run
      - unknown
    validationResult:
      - passed
      - failed
      - partial
      - not_run
      - unknown
    acceptanceCriteriaResult:
      - passed
      - failed
      - partial
      - not_checked
      - unknown
    summary: bounded_non_empty_string
  sourceFindings: bounded_array
  decisionEscalationIds: bounded_array
  artifactReferences: bounded_array
  recordedAt: required_timestamp
```

Rules:

- evidence stores summaries, hashes, identifiers, and references only;
- no inline logs, screenshots, archives, binary data, or full transcripts;
- `packetId`, `workUnitId`, and root identity must resolve when the record is applied;
- absent optional code-state fields produce `unknown`, not implied success;
- independent-context declaration is provenance only;
- result claims do not change checkpoint results in M22;
- result claims do not authoritatively define issue severity or fixability.

### 5.3 ArtifactReference

```yaml
ArtifactReference:
  artifactId: stable_within_evidence_record
  kind:
    - log
    - report
    - screenshot
    - test_result
    - ci_run
    - diff
    - other
  locator: bounded_reference_string
  digest:
    algorithm:
      - sha256
    value: optional_hex_digest
  mediaType: optional
  description: optional_bounded_string
```

M22 does not fetch, open, validate, copy, or persist the referenced artifact body.

### 5.4 SourceFinding

```yaml
SourceFinding:
  sourceFindingId: stable_within_evidence_record
  sourceFingerprint: deterministic_digest
  title: bounded_non_empty_string
  summary: bounded_non_empty_string
  sourceSeverityClaim:
    - critical
    - high
    - medium
    - low
    - info
    - unknown
  sourceFixabilityClaim:
    - agent_fixable
    - human_action
    - external_verification
    - unknown
  scopeClaim:
    - execution_local
    - work_unit
    - cross_work_unit
    - milestone
    - project
    - release
    - architecture
    - security
    - legal_compliance
    - governance
    - external_setup
    - unknown
  relatedIds: bounded_array
  evidenceTextDigest: optional_sha256
```

The following source fields are claims only:

- source severity;
- source fixability;
- scope;
- reviewer independence;
- result status.

They do not directly set canonical `ProjectIssue` severity, effective lifecycle status, acceptance/deferment/resolution state, release classification, or repair eligibility.

### 5.5 ProjectIssue

`ProjectIssue` is the durable identity, scope, provenance, and relationship record for one project-level canonical condition. It is **not** a second mutable issue-lifecycle store.

Preferred conceptual contract:

```yaml
ProjectIssue:
  projectIssueId: stable_canonical_id
  issueKey: deterministic_canonical_condition_key
  title: bounded_non_empty_string
  description: bounded_non_empty_string
  severity:
    - critical
    - high
    - medium
    - low
  sourceType:
    - evidence
    - checkpoint
    - review
    - workspace
    - provider
    - manual
    - system
  sourceRefs: bounded_array
  affectedWorkUnitIds: bounded_array
  affectedMilestoneIds: bounded_array
  evidenceIds: bounded_array
  checkpointRefs: bounded_array
  ownerRef: optional
  promotionRefs: bounded_array
  createdAt: required_timestamp
  updatedAt: required_timestamp
```

#### 5.5.1 Lifecycle ownership

`ProjectIssue` must not persist its own mutable `status`, acknowledgment state, deferment state, resolution state, post-MVP state, or promotion state.

The existing issue-state owner remains authoritative for effective lifecycle state, keyed by the canonical `issueKey`.

```yaml
effective_project_issue_lifecycle:
  default_when_no_overlay_exists: active
  authoritative_status_vocabulary:
    - active
    - accepted
    - deferred
    - resolved
    - post_mvp
    - promoted
  authority:
    lifecycle_override: existing IssueOverride service
    repair_promotion: existing IssuePromotion service
  derived_not_persisted_on_ProjectIssue: true
```

Rules:

- `active` is the implicit effective status when no override or promotion applies;
- `accepted`, `deferred`, `resolved`, and `post_mvp` are represented only through the established override lifecycle;
- `promoted` is derived through the established promotion lifecycle;
- no `open | acknowledged | resolved` parallel vocabulary is introduced;
- effective lifecycle rendering must use one centralized resolver shared by ProjectIssue consumers;
- a lifecycle overlay may change without rewriting the immutable identity of the `ProjectIssue`;
- existing CheckpointIssue override/promotion semantics must be reused or extended centrally, never copied into a ProjectIssue-specific service.

#### 5.5.2 Remaining ProjectIssue rules

- canonical severity is assigned through the existing centralized classification owner or its reviewed M22 extension;
- `ProjectIssue` does not persist provider-authored `agentCanFix` as authoritative core semantics;
- promotion to repair work does not automatically imply resolution unless the existing centralized lifecycle owner explicitly defines that result;
- resolving or promoting an issue does not delete its base record, evidence links, or transition history;
- issue keys are stable across repeated evidence imports and lifecycle transitions;
- project issue IDs use the repository’s established deterministic ID allocation service with a distinct prefix approved during Gate B;
- duplicate `issueKey` creation is invalid; repeated application links evidence to the existing record;
- `updatedAt` tracks changes to the base ProjectIssue record and references, not a duplicated lifecycle status.

### 5.6 ProjectIssueTransition

```yaml
ProjectIssueTransition:
  transitionId: stable_canonical_id
  issueKey: required
  from:
    lifecycle: checkpoint_issue
    checkpointId: required
    checkpointIssueRef: required
  to:
    lifecycle: project_issue
    projectIssueId: required
  reason:
    - scope_expanded
    - cross_execution_recurrence
    - project_tracking_required
    - release_tracking_required
    - governance_or_compliance
    - manual_escalation
  evidenceIds: bounded_array
  createdAt: required_timestamp
```

Rules:

- transition is explicit and append-only;
- original CheckpointIssue remains intact;
- only one transition to the same ProjectIssue exists for the same canonical condition;
- repeated transition requests are idempotent;
- transition does not create duplicate repair work;
- canonical `issueKey` remains unchanged.

### 5.7 DecisionEscalation

```yaml
DecisionEscalation:
  escalationId: stable_canonical_id
  escalationKey: deterministic_key
  category:
    - product
    - architecture
    - security
    - legal_compliance
    - governance
    - external_setup
    - other
  status:
    - open
    - resolved
    - withdrawn
  question: bounded_non_empty_string
  rationale: bounded_non_empty_string
  relatedWorkUnitIds: bounded_array
  relatedMilestoneIds: bounded_array
  evidenceIds: bounded_array
  resolution:
    answer: optional_bounded_string
    resolvedAt: optional_timestamp
    resolvedBy: optional_reference
  createdAt: required_timestamp
  updatedAt: required_timestamp
```

Rules:

- decision escalation is not an issue severity;
- decision escalation is not `agentCanFix`;
- M22 does not automatically block workflow based on an escalation;
- repeated `escalationKey` application links to the existing record;
- future policy may treat open escalations as blocking only through a separately reviewed milestone.

### 5.8 Evidence binding status

M22 must provide a deterministic derived evaluator:

```text
current
stale
mismatched
unavailable
unknown
```

Minimum rules:

- wrong work unit, packet, or implementation-root identity → `mismatched`;
- missing referenced work unit or packet → invalid canonical state or invalid candidate input;
- changed known commit/fingerprint after capture → `stale`;
- required local repository state cannot be inspected → `unavailable`;
- insufficient binding data → `unknown`;
- all available binding values match → `current`.

M22 stores binding facts. It must not silently rewrite evidence from one state to another.

---

## 6. Finding Normalization and Lifecycle Routing

### 6.1 Canonical identity

For every source finding:

1. normalize bounded text and related IDs using deterministic rules;
2. compute `sourceFingerprint`;
3. compute or resolve canonical `issueKey`;
4. search existing CheckpointIssues, ProjectIssues, transitions, overrides, and promotions by canonical key;
5. apply exactly one initial lifecycle route.

The fingerprint algorithm and canonical serialization must be documented and fixture-tested. It must not depend on array iteration order where order is semantically irrelevant.

### 6.2 CheckpointIssue route

Create or link a CheckpointIssue only when **all** are true:

- evidence references a valid checkpoint;
- scope is execution-local;
- related records are limited to that checkpoint, packet, and one work unit;
- remediation can be validated by:
  - a replacement execution;
  - checkpoint amendment;
  - replacement evidence for the same work unit;
- no project-level trigger applies.

M22 must reuse the existing CheckpointIssue creation/classification owner. It must not implement a parallel checkpoint issue type.

### 6.3 ProjectIssue route

Create or link a ProjectIssue when **any** is true:

- no valid checkpoint exists;
- the finding affects multiple checkpoints;
- the finding affects multiple work units or milestones;
- the finding concerns architecture, security policy, release readiness, legal/compliance, repository governance, or persistent external setup;
- the condition remains relevant independently of one execution;
- project-level acknowledgment, ownership, resolution, release tracking, or repair promotion is required.

### 6.4 No-dual-creation rule

For one canonical condition:

```text
initial normalization creates or links:
CheckpointIssue XOR ProjectIssue
```

It must not create both.

If a checkpoint issue later crosses a ProjectIssue trigger:

1. create or link one ProjectIssue;
2. create or reuse one ProjectIssueTransition;
3. preserve the CheckpointIssue;
4. preserve evidence linkage;
5. preserve the canonical issue key;
6. preserve existing override/promotion history;
7. prevent duplicate repair Work Units.

### 6.5 Centralized classification authority

- Provider/source severity is a claim.
- Provider/source fixability is a claim.
- Canonical ProjectIssue severity comes from the existing classification owner or an explicit M22 extension of it.
- Effective ProjectIssue lifecycle status is derived from the existing issue-state override and promotion owners.
- ProjectIssue must not add a parallel mutable status vocabulary.
- Issue override behavior remains centralized.
- Promotion-to-repair-work-unit remains centralized.
- M22 must not scatter severity, lifecycle, or fixability rules across evidence, routing, review, and output services.

---

## 7. Mutation, Atomicity, and Runlog Contract

### 7.1 Candidate-state mutation

Any M22 service that records evidence or changes issue state must:

1. read and validate canonical state;
2. construct a complete candidate state in memory;
3. validate all new and existing references;
4. evaluate deduplication and idempotency;
5. compute required runlog events;
6. atomically write state;
7. append runlog events using the repository’s established safe sequence;
8. return deterministic result data.

No partial state or runlog mutation is allowed.

### 7.2 Idempotency

Reapplying the same logical evidence must:

- not create a second EvidenceRecord;
- not create a second CheckpointIssue;
- not create a second ProjectIssue;
- not create a second transition;
- not create a second decision escalation;
- not create duplicate repair work;
- return success with an explicit no-op/link result;
- append no duplicate mutation events when nothing changed.

### 7.3 Runlog events

M22 may add versioned event types such as:

```text
evidence.recorded
evidence.linked
project_issue.created
project_issue.updated
project_issue.transitioned
decision_escalation.created
decision_escalation.resolved
```

Rules:

- event payloads contain IDs, counts, status, and digests only;
- no large source finding text, logs, artifact bodies, or absolute secret-bearing paths;
- no runlog event for a rejected candidate or idempotent no-op;
- ordering is deterministic;
- event naming must follow existing repository conventions.

### 7.4 State-growth limits

Minimum contract:

```yaml
state_growth_limits:
  EvidenceRecord:
    max_serialized_bytes: 65536
    max_source_findings: 100
    max_artifact_references: 50
    max_decision_escalation_refs: 50
  ProjectIssue:
    max_serialized_bytes: 16384
    max_source_refs: 100
    max_evidence_refs: 100
    max_checkpoint_refs: 100
  DecisionEscalation:
    max_serialized_bytes: 16384
    max_related_ids_per_collection: 100
    max_evidence_refs: 100
  collections:
    evidence_records_hard_cap: 10000
    project_issues_hard_cap: 5000
    decision_escalations_hard_cap: 5000
    project_issue_transitions_hard_cap: 5000
```

The implementation may propose lower limits with evidence. It must not increase these limits without review.

Exceeding a hard cap is invalid input and causes no mutation.

---

## 8. Error and Exit-Code Contract

M22 adds no mandatory public command, but all services and affected existing commands must use the established taxonomy:

```yaml
exit_codes:
  0: success_or_non_blocking_advisory_result
  1: validation_or_review_failure_under_existing_command_semantics
  2: workflow_blocked_under_existing_command_semantics
  3: invalid_input_invalid_state_or_broken_reference
  10: human_input_required_when_an_existing_command_explicitly_needs_a_decision
```

| Condition | Status | Exit code | Mutation |
|---|---|---:|---|
| Valid new evidence/project issue candidate | passed | 0 | atomic |
| Exact duplicate evidence or issue link | passed | 0 | none |
| Evidence is stale, unavailable, or unknown but structurally valid | warning/advisory | 0 | permitted only when recording is requested |
| Mismatched work unit, packet, checkpoint, or root identity | failed | 3 | none |
| Broken canonical reference | failed | 3 | none |
| Unsupported evidence contract major version | failed | 3 | none |
| Unknown trust level, enum, or transition reason | failed | 3 | none |
| Duplicate canonical issue key in existing state | failed | 3 | none |
| Record or collection size limit exceeded | failed | 3 | none |
| Malformed canonical JSON or unsupported schema version | failed | 3 | none |
| Open decision escalation exists | advisory in M22 | 0 | no automatic workflow mutation |
| M22 evidence is absent | normal | 0 | none |

M22 must not introduce an exit-code failure solely because required evidence is absent. Required evidence does not exist until M30.

---

## 9. Repository Implementation Areas

Exact paths must be confirmed during Gate B.

Expected areas:

```text
src/schema/
  evidence.schema.ts
  project-issue.schema.ts
  decision-escalation.schema.ts
  issue-state.schema.ts
  state.schema.ts
  runlog-event.schema.ts

src/workflow/ or src/services/
  evidence-service.ts
  evidence-binding-service.ts
  finding-fingerprint.ts
  finding-normalization-service.ts
  project-issue-service.ts
  decision-escalation-service.ts
  issue-classification.ts
  repair-work-graph.ts

src/core/state/ or current state owner
src/core/output/ only when additive internal result data is needed

tests/unit/
tests/integration/
tests/fixtures/
```

Do not create duplicate state stores, issue classifiers, ID allocators, atomic writers, or repair-work-unit promotion services.

---

## 10. Testing Contract

### 10.1 Full regression

All pre-M22 tests must remain green.

Expected baseline: at least `1216` tests, subject to live Gate B verification.

### 10.2 Historical state compatibility

Fixtures must prove:

- state without `issues`;
- state with existing overrides/promotions only;
- state without `evidence`;
- historical checkpoints with CheckpointIssues;
- historical checkpoint amendments;
- historical effective-readiness states;
- read-only commands do not materialize optional M22 state;
- parsing old state does not require a schema-version bump.

### 10.3 Zod schema fixtures

For every new persisted contract:

- minimal valid;
- full valid;
- omitted optionals;
- unknown fields according to repository strictness;
- invalid enums;
- empty required strings;
- invalid timestamps;
- duplicate IDs;
- duplicate issue keys;
- malformed JSON;
- broken work-unit, milestone, packet, checkpoint, evidence, and root references;
- oversized record;
- collection cap exceeded.

### 10.4 Evidence identity and binding

Test:

- correct binding;
- wrong work unit;
- wrong packet;
- wrong checkpoint;
- wrong implementation root;
- matching commit/fingerprint;
- changed commit/fingerprint;
- missing code-state data;
- unavailable repository state;
- deterministic repeated evaluation.

### 10.5 Finding normalization

Test every F-06 branch:

- execution-local CheckpointIssue route;
- no-checkpoint ProjectIssue route;
- cross-checkpoint route;
- cross-work-unit route;
- architecture/security/release/legal/governance/external-setup route;
- no dual creation;
- existing CheckpointIssue link;
- existing ProjectIssue link;
- repeated source finding;
- CheckpointIssue-to-ProjectIssue transition;
- repeated transition;
- canonical issue-key preservation;
- no duplicate repair work after promotion.

### 10.6 Classification and lifecycle authority

Test that source claims do not directly control:

- canonical severity;
- effective issue lifecycle;
- acceptance, deferment, resolution, post-MVP, or promotion state;
- repair eligibility;
- release classification;
- future blocking behavior.

Also test:

- ProjectIssue persists no mutable lifecycle `status`;
- no `open | acknowledged | resolved` parallel vocabulary exists;
- no overlay means effective status `active`;
- each existing override status resolves identically for CheckpointIssue and ProjectIssue identities;
- promotion remains owned by the existing promotion service;
- lifecycle changes do not duplicate or delete the ProjectIssue base record.

### 10.7 Candidate-state atomicity

Test:

- state write failure;
- runlog append failure under existing transaction/recovery conventions;
- invalid candidate;
- duplicate candidate;
- collection limit failure;
- reference failure;
- no partial writes;
- deterministic changed-file and runlog ordering.

### 10.8 State-growth and payload safety

Test:

- large inline log rejected;
- binary/base64 payload rejected where not a locator;
- bounded summary accepted;
- digest/reference accepted;
- caps enforced;
- no artifact fetching;
- no network;
- no shell/process execution.

### 10.9 Read-only command compatibility

At minimum, run the existing status/manage/review/export/navigation regression suites against:

- historical state;
- state with evidence;
- state with ProjectIssues;
- state with transitions and decision escalations.

M22 additions must not alter existing workflow navigation or exit codes merely because M22 state exists.

### 10.10 Clean-environment validation

From a disposable clean clone:

1. install exact pnpm version;
2. use frozen lockfile;
3. run typecheck;
4. run lint;
5. run full tests;
6. run build;
7. run coverage;
8. run local and base-comparison version checks;
9. inspect generated canonical fixtures;
10. verify no network/provider execution was added.

---

## 11. Work Units

### WU22-01 — Gate B Repository Audit

Objective: verify the current v0.8.3 baseline, issue/checkpoint models, storage owners, classification, promotion, amendment, readiness, and M22 entry risk.

Acceptance:

- complete Gate B report;
- ProjectIssue storage design approved;
- trust order approved;
- state-growth limits approved;
- entry risk `<=25`;
- no implementation before approval.

### WU22-02 — Additive State and Compatibility Foundation

Objective: extend existing state ownership with optional evidence, ProjectIssue, transition, and decision-escalation collections.

Acceptance:

- historical state fixtures remain valid;
- no read-time materialization;
- no schema bump unless separately justified;
- deterministic helper defaults.

### WU22-03 — ProjectIssue and Transition Schemas

Objective: implement canonical ProjectIssue and CheckpointIssue-to-ProjectIssue transition contracts.

Acceptance:

- stable IDs and issue keys;
- ProjectIssue contains no parallel mutable lifecycle status;
- existing override/promotion vocabulary is the authoritative effective lifecycle;
- transition idempotency;
- output-only Issue DTO remains separate.

### WU22-04 — Evidence, Artifact, Trust, and Binding Schemas

Objective: implement compact evidence contracts, artifact references, ordinal trust levels, and binding-status representation.

Acceptance:

- summaries/references only;
- trust order deterministic;
- mismatch/stale/unavailable/unknown representable;
- no artifact fetching.

### WU22-05 — Decision Escalation Contract

Objective: implement project/architecture/security/legal/governance/external-setup decision escalations separately from issues.

Acceptance:

- deterministic key;
- open/resolved/withdrawn lifecycle;
- no automatic workflow blocking in M22;
- no conflation with severity/fixability.

### WU22-06 — Finding Fingerprint and Canonical Issue Key

Objective: implement deterministic source-finding normalization, fingerprinting, and canonical-key resolution.

Acceptance:

- stable across repeated runs;
- order normalization documented;
- duplicates resolve consistently;
- historical issue keys preserved.

### WU22-07 — Finding Routing and Lifecycle Transition Service

Objective: implement the exact F-06 route, no-dual-creation rule, and explicit CheckpointIssue-to-ProjectIssue transition.

Acceptance:

- every route fixture green;
- transition idempotent;
- original CheckpointIssue preserved;
- no duplicate repair work.

### WU22-08 — Evidence Candidate-State and Runlog Service

Objective: implement atomic evidence recording/linking and compact runlog events without public provider import.

Acceptance:

- candidate-state validation;
- no partial writes;
- idempotent replay;
- state-growth limits;
- deterministic events.

### WU22-09 — Classification, Promotion, and Compatibility Integration

Objective: extend existing centralized classification and promotion owners to understand ProjectIssue without duplicating semantics.

Acceptance:

- source claims remain non-authoritative;
- one shared effective-lifecycle resolver covers checkpoint-scoped and project-scoped issue identities;
- override/promotion behavior remains centralized;
- existing commands and navigation unchanged;
- no required-evidence semantics.

### WU22-10 — Full Regression, Dogfood Fixtures, and Milestone Closure

Objective: validate M22 end to end through internal services and repository fixtures, calculate residual risk, version/tag the milestone, and prepare Gate C evidence.

Acceptance:

- all tests and CI green;
- no hidden execution/network/plugin surface;
- package/version/tag records consistent;
- merge residual risk `<=12`;
- Gate C report identifies three generic evidence payload examples for M23 without implementing their adapters.

---

## 12. Source-Control and Implementation Evidence Discipline

- Default branch remains `main`.
- The AIQT repository is not governed through `.aiqt/` self-management state.
- AIQT commands may be run only as product tests or smoke tests.
- Each completed Work Unit receives:
  - one detailed commit;
  - one unique tag;
  - objective, files, behavior, validation, decisions, and `Risk: N/100` in the commit body;
  - one structured implementation report.
- Do not combine unrelated Work Units.
- Do not move or rewrite historical tags.
- Do not force-push.
- Use the repository’s version-governance tooling.
- The expected feature-level version is likely a minor increment from `0.8.3`, but the exact version must be determined by the real version policy and `version:check`.
- Final milestone and release tags are created only after real CI passes.

Suggested tag pattern:

```text
m22-wu01-gate-b-audit
m22-wu02-additive-state-foundation
m22-wu03-project-issue-schema
m22-wu04-evidence-trust-binding
m22-wu05-decision-escalation
m22-wu06-finding-fingerprint
m22-wu07-finding-routing
m22-wu08-evidence-state-service
m22-wu09-classification-integration
m22-wu10-final-validation
```

---

## 13. Risk Register

The Controlled score is the risk after the specification's mandatory design controls are applied but before Gate B repository evidence and implementation-specific mitigations reduce the risk to the Entry target.

| ID | Hazard | Probability | Impact | Inherent | Required design controls | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M22-R01 | New ProjectIssue state breaks historical files | Medium | High | 50 | optional additive storage, no read-time write, full historical fixtures | 33 | 25 | 10 |
| M22-R02 | CheckpointIssue and ProjectIssue duplicate one condition | Medium | High | 50 | canonical issue key, XOR initial route, explicit transition | 33 | 25 | 12 |
| M22-R03 | Output-only Issue DTO becomes confused with canonical state | Medium | High | 50 | distinct names, imports, schema ownership, repository tests | 17 | 17 | 8 |
| M22-R04 | Evidence binds to wrong packet/root/code state | Medium | High | 50 | strict identity validation, binding evaluator, no enforcement | 33 | 25 | 12 |
| M22-R05 | Provider/source claims control canonical classification | Medium | High | 50 | centralized classification, claims-only schema, negative tests | 33 | 25 | 10 |
| M22-R06 | Evidence or issue state grows without bound | Medium | Medium | 33 | per-record byte caps, collection caps, references only | 17 | 17 | 10 |
| M22-R07 | Transition creates duplicate repair work | Medium | High | 50 | preserved issueKey, promotion dedup, idempotency tests | 33 | 25 | 12 |
| M22-R08 | Decision escalation becomes accidental workflow blocker | Low | High | 25 | separate schema, advisory-only M22 semantics | 8 | 8 | 8 |
| M22-R09 | Evidence persistence partially mutates state/runlog | Medium | High | 50 | candidate-state validation, atomic writes, failure fixtures | 33 | 25 | 12 |
| M22-R10 | Trust ordering is ambiguous or provider-controlled | Medium | Medium | 33 | explicit ordinal mapping, canonical assignment owner | 17 | 17 | 8 |
| M22-R11 | M22 silently introduces execution or network behavior | Low | Critical | 33 | static schemas/services, process/network scan, negative tests | 8 | 8 | 5 |
| M22-R12 | ProjectIssue introduces a parallel mutable issue lifecycle | Medium | High | 50 | no persisted ProjectIssue status; existing overrides/promotions remain authoritative | 17 | 17 | 8 |

Risk aggregation:

```text
controlledDesignRisk = max(Controlled score of every M22 hazard)
implementationEntryRisk = max(current score of all open M22 hazards after Gate B)
mergeResidualRisk = max(residual score of all open or accepted M22 hazards)
```

Derived milestone values:

```yaml
risk_derivation:
  controlledDesignRisk: 33
  implementationEntryRiskMaximum: 25
  mergeResidualRiskMaximum: 12
```

M22 must not start above `25` and must not merge above `12`.

---

## 14. Out of Scope

M22 must not add:

- external evidence import commands;
- stdin/file provider adapters;
- provider network calls;
- provider execution;
- validation command execution;
- shell execution;
- coding-agent spawning;
- dynamic plugin loading;
- worktree or workspace metadata;
- branch/worktree creation, reset, merge, or deletion;
- automatic review;
- automatic issue resolution;
- automatic repair implementation;
- checkpoint completion changes;
- checkpoint amendment waiver behavior;
- effective-readiness changes;
- required evidence;
- evidence-policy profiles;
- workflow blocking based on evidence;
- large log, screenshot, archive, or binary persistence;
- named third-party semantics in canonical schemas;
- full review/manage/export evidence integration.

---

## 15. Definition of Done

```yaml
definition_of_done:
  gate_b:
    - current repository baseline verified
    - issue/checkpoint/output models verified
    - entry risk <= 25
  compatibility:
    - pre-M22 state fixtures valid
    - no read-only materialization
    - no schema-version bump unless separately approved
  project_issues:
    - new additive ProjectIssue identity and relationship record implemented
    - existing issue-state overrides/promotions remain the sole mutable lifecycle owner
    - output-only Issue DTO remains non-canonical
    - stable issue keys and IDs
  evidence:
    - compact provider-neutral contract
    - trust levels explicitly ordered
    - workflow/root/code binding represented
    - mismatch/stale/unavailable/unknown represented
  routing:
    - exact F-06 rules implemented
    - no initial dual creation
    - explicit idempotent transition
    - no duplicate repair work
  decisions:
    - decision escalations separate from issues
    - no automatic blocking
  persistence:
    - candidate-state atomicity
    - idempotency
    - compact runlog events
    - state-growth limits enforced
  execution_boundary:
    - no shell
    - no network
    - no dynamic plugin
    - no provider execution
  regression:
    - full suite green
    - clean-clone validation green
    - real CI green
  governance:
    - each Work Unit committed, tagged, and reported
    - package version and tags consistent
    - residual risk <= 12
  gate_c:
    - three generic M23 payload examples identified
    - no adapters implemented
```

---

## 16. Required Agent Output

For every Work Unit:

```yaml
work_unit_result:
  work_unit_id: required
  baseline_verified: required
  summary: required
  schemas_or_services_changed: required
  files_changed: required
  behavior_changed: required
  compatibility_evidence: required
  tests_added_or_updated: required
  validation_commands_and_results: required
  acceptance_criteria_evidence: required
  execution_boundary_scan: required
  commit: required
  tag: required
  risk_score_0_to_100: required
  residual_findings: required
  next_action: required
```

Final M22 report must include:

1. Gate B report;
2. exact state storage design;
3. AIQT schema-version decision;
4. ProjectIssue contract;
5. EvidenceRecord and trust contract;
6. DecisionEscalation contract;
7. F-06 routing matrix;
8. transition and promotion deduplication evidence;
9. state-growth evidence;
10. historical fixture results;
11. full validation and real-CI results;
12. commits, tags, and package version;
13. hazard-by-hazard residual risk;
14. final merge residual risk;
15. Gate C readiness;
16. confirmation that M23 was not started.

---

## 17. Review Questions

1. Does the specification accurately distinguish CheckpointIssue, issue overlays/promotions, output-only Issue DTO, and new ProjectIssue state?
2. Does ProjectIssue avoid persisting a parallel mutable lifecycle status and instead use the existing override/promotion owner?
3. Is the preferred storage additive and owned by existing state modules?
4. Are old state files valid without materializing new fields?
5. Is the trust ordering explicit and computable?
6. Does evidence bind to workflow, root, and code state without pretending missing data is proof?
7. Are source severity/fixability fields claims rather than canonical authority?
8. Does F-06 create exactly one initial lifecycle?
9. Is CheckpointIssue-to-ProjectIssue transition explicit, linked, and idempotent?
10. Can promotion-to-repair-work-unit remain deduplicated by issue key?
11. Are decision escalations separate from issue severity and workflow blocking?
12. Are payload and collection limits sufficient to keep canonical state lean?
13. Are all mutations candidate-state validated and atomic?
14. Does M22 avoid provider import, network, shell, plugins, checkpoint changes, and enforcement?
15. Is implementation-entry risk `<=25` and merge residual risk `<=12` based on evidence?
16. Is Gate C prepared without implementing M23?

Approval threshold:

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  implementation_entry_risk_maximum: 25
  hidden_execution_surfaces: 0
  historical_fixture_regressions: 0
```
