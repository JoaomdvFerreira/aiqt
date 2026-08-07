# AIQT Milestone 30 Build Specification v0.2

## Required Evidence Enforcement

```yaml
document:
  product: AIQT CLI
  type: Delta Build Specification
  version: 0.2
  status: Revised review candidate
  milestone:
    id: M30
    title: Required Evidence Enforcement
    classification: high_risk
    work_units: 7
  baseline_claims:
    branch: main
    development_baseline_commit: be5c165
    package_version: 0.17.1
    release_tag: v0.17.1
    M29_milestone_tag: m29-advisory-checkpoint-evidence
    M29_correction_tag: m29-correction-advisory-unclassified-telemetry
    tests: 2255
    schema_version: 0.5.0
    M29_merge_residual_risk: 10
    Gate_J: open
    Gate_J_representative_projects: 3
    Gate_J_false_positive_rate: 0.33
    Gate_J_amendment_composition: pass
    Gate_J_readiness_parity: pass
    Gate_J_completion_parity: pass
    Gate_J_runlog_history_complete: true
    Gate_J_platform_enforcement_gap: accepted_gap
    M30_implementation_entry_risk: 25
    M30_started: false
  risk:
    inherent: 100
    controlled_design_target: 50
    implementation_entry_maximum: 35
    merge_residual_maximum: 15
    project_activation_residual_maximum: 5
```

This is a high-risk delta specification. Repository-wide development governance comes from:

```text
docs/engineering/milestone-protocol.md
docs/engineering/repository-owner-map.json
docs/engineering/claude-code-prompt-template.md
```

The owner map is an index, not authority. Gate J must verify every relevant entry against live code.

### v0.2 corrections

v0.2:

- restores the full-ceremony `Controlled` risk column and makes `controlledDesignRisk` independently derivable;
- defines the exact deterministic `projectActivationResidualRisk` formula and fixed per-condition weights;
- clarifies that the 250-word Work Unit report limit remains the default for high-risk milestones, with exceptions only for blockers, deviations, failed controls, or accepted risks.

---

## 1. Objective

Allow an explicit, project-specific, human-authorized enforcement profile to make selected evidence mandatory for:

- checkpoint completion;
- checkpoint-amendment completion;
- development review;
- release review.

M30 is the only M21–M30 milestone that changes load-bearing workflow semantics.

```text
M28 policy simulation
  + M29 advisory evidence
  + explicit immutable enforcement profile
  + Gate K project activation
  → required evidence decision
  → allow, needs_review, blocked, or invalid
```

### 1.1 Required outcome

After M30:

- required mode remains absent by default;
- projects without an active required-mode activation behave as before;
- advisory mode remains available and unchanged;
- required mode can be activated only through a valid Gate K activation plan;
- a checkpoint that would otherwise become `done` is gated by one shared required-evidence decision service;
- an amendment cannot move `needs_review → done` without satisfying the same gate;
- development and release review can require current evidence without rewriting workflow state;
- completed work predating activation remains grandfathered;
- later policy changes are prospective;
- later evidence staleness creates current findings/review failures but does not silently reverse completed work or downstream readiness;
- every blocking result includes deterministic recovery guidance;
- exact, governed exceptions are possible only where the enforcement profile allows them;
- no generic force flag exists;
- no provider execution, network call, shell, Git mutation, or validation execution occurs inside a gate.

### 1.2 Non-goals

M30 does not:

- execute validation commands;
- fetch evidence or contact providers;
- spawn agents;
- introduce provider-specific policy semantics;
- dynamically load policy or exception code;
- mutate Git or workspaces;
- automatically create replacement evidence;
- automatically amend checkpoints;
- automatically create repair Work Units;
- use an unscoped `--force`, `--skip`, or `--ignore-evidence` bypass;
- retroactively invalidate completed dependency chains;
- reverse already-released readiness;
- treat self-reported evidence as higher trust;
- authorize any real project to use required mode merely because M30 ships;
- replace M28 simulation or M29 advisory telemetry;
- add a second issue lifecycle.

---

## 2. Effective Evidence Mode

No historical project receives a new persisted default.

The effective mode is derived:

```yaml
effective_mode:
  required:
    condition: valid active required-mode activation exists
  advisory:
    condition: no active required activation and an M28 active policy exists
  off:
    condition: neither condition above is true
```

Consequences:

- adding M30 does not disable existing M29 advisory behavior;
- importing an enforcement profile does not activate it;
- preparing an activation plan does not activate it;
- required mode exists only after explicit activation;
- deactivation returns the project to advisory when an active M28 policy exists, otherwise off.

---

## 3. Gate J — Build Entry Audit

Gate J is read-only and creates no M30 state.

### 3.1 Verify baseline and evidence campaign

Treat the baseline block as claims. Verify:

- branch, commits, package/schema versions, tags, test count, and CI;
- M29 closure addendum and telemetry correction;
- M29 residual risk `10/100`;
- the three representative advisory projects;
- amendment, readiness, and completion parity;
- runlog history completeness;
- explicit platform-enforcement-gap disposition;
- M30 entry risk `25/100`;
- no M30 implementation already exists.

### 3.2 Verify repository owners

Using the owner map as the starting point, verify:

- checkpoint command and candidate-state construction;
- checkpoint identity and `Checkpoint.createdAt`;
- checkpoint immutability;
- existing `applyCheckpoint`;
- amendment schema, evidence attachment, and `computeEffectiveCheckpointResult`;
- M18 dependency readiness;
- M22/M23 workflow binding, code binding, provider/provenance, trust, evidence identity, and invalid-reference semantics;
- M28 policy selection, snapshot builder, simulator, rule outcomes, and digests;
- M29 advisory projection, issues, feedback, telemetry, and runlog-gap recovery;
- development/release review classification and exits;
- status, manage, export, and recommendation owners;
- candidate-state validation, atomic state write, runlog append, replay repair, preview, bounded input, and exit codes;
- versioning and CI.

### 3.3 Required architecture decisions

Before WU30-02, Gate J must approve:

1. the exact candidate checkpoint state against which required evidence is evaluated;
2. the exact point at which the existing checkpoint result is known;
3. the exact M12 amendment candidate state and effective-result owner;
4. the exact M18 recalculation call following an allowed completion;
5. the canonical evidence fields used for provider and binding eligibility;
6. the exact state owners for profiles, recovery proofs, activation plans, active activation, and exceptions;
7. the state/runlog repair strategy for every M30 mutation;
8. the checkpoint/review transition matrix in §9.

### 3.4 Entry decision

Proceed only when:

```text
implementationEntryRisk <= 35
```

Stop when:

- a candidate checkpoint cannot be evaluated before persistence;
- M28 cannot be reused without copying its logic;
- M12 or M18 requires a second effective-result/readiness implementation;
- evidence provider/binding identity lacks canonical owners;
- required mode would need a network/provider call;
- historical done work cannot be deterministically grandfathered;
- generic amendment APIs cannot be protected from bypass;
- a safe deactivation path cannot be defined;
- a new issue lifecycle appears necessary;
- High/Critical dependency alerts lack disposition;
- a breaking state migration is required without approval.

---

## 4. Persisted Contracts

All new fields are optional and additive. Historical fixtures remain valid without them.

Gate J selects the existing project/configuration and workflow-state owners. M30 must not create a new canonical file.

### 4.1 Immutable enforcement profile

```yaml
EvidenceEnforcementProfile:
  protocolVersion: aiqt-evidence-enforcement-profile@1
  profileId: bounded_namespaced_string
  version: positive_integer
  name: bounded_string
  description: optional_bounded_string
  gates:
    checkpoint: optional_CheckpointGateProfile
    developmentReview: optional_ReviewGateProfile
    releaseReview: optional_ReviewGateProfile
  activationRequirements: ActivationRequirementProfile
  profileDigest: sha256
  createdAt: timestamp
  supersedesVersion: optional_positive_integer
```

Identity and replay:

- `(profileId, version)` is immutable;
- identical identity and digest is a no-op;
- identity collision with a different digest is exit `3`;
- new versions strictly increase;
- old versions remain available;
- profiles are never edited in place;
- import never activates a profile.

Limits:

```yaml
profile_limits:
  max_profiles: 25
  max_versions_per_profile: 10
  max_profile_bytes: 262144
```

### 4.2 Checkpoint gate profile

```yaml
CheckpointGateProfile:
  policyRef:
    policyId: string
    version: positive_integer
    digest: sha256
  acceptedProviders: optional_sorted_bounded_namespaced_array
  bindingRequirements:
    workUnit: required
    packet: optional | required
    implementationRoot: optional | required
    codeState: optional | required
  onFail: needs_review
  onIndeterminate: needs_review | block
  onUnavailable: needs_review | block
  exceptionEligibleRuleIds: sorted_bounded_array
```

Fixed behavior:

- missing required evidence blocks without canonical mutation;
- malformed or broken canonical references return exit `3` without mutation;
- wrong work-unit, packet, implementation-root, or code-state binding returns exit `3` without mutation;
- a gate pass never overrides an existing non-evidence reason for `needs_review`;
- accepted providers are bounded canonical provider IDs, never executable adapters;
- provider acceptance does not imply trust.

### 4.3 Review gate profile

```yaml
ReviewGateProfile:
  policyRef:
    policyId: string
    version: positive_integer
    digest: sha256
  targetSet:
    - project
    - effective_done_work_units
    - effective_checkpoints
  acceptedProviders: optional_sorted_bounded_namespaced_array
  bindingRequirements:
    workUnit: optional | required
    packet: optional | required
    implementationRoot: optional | required
    codeState: optional | required
  onIndeterminate: fail_review | warn
  onUnavailable: fail_review | warn
  exceptionEligibleRuleIds: sorted_bounded_array
```

Rules:

- target sets are deterministic, deduplicated, and sorted;
- grandfathered Work Units are excluded from required target sets;
- each target is evaluated through M28;
- any required target failure fails the gate;
- development exceptions do not satisfy release review;
- review remains read-only.

### 4.4 Activation requirements

```yaml
ActivationRequirementProfile:
  minimumAdvisoryObservations: integer_3_to_100
  minimumClassifiedFindings: integer_0_to_100
  maximumAcceptedFalsePositiveRate: decimal_0_to_1
  requireCompleteAdvisoryHistory: true
  requireEveryRuleObserved: true
  requireEveryRuleRecoveryProof: true
  requireNoUnavailableObservation: true
  requireNoOpenDeadlockFinding: true
```

### 4.5 Recovery proof

```yaml
RequiredRuleRecoveryProof:
  protocolVersion: aiqt-required-rule-recovery-proof@1
  proofId: deterministic_id
  profileRef: immutable_profile_reference
  gate: checkpoint | development_review | release_review
  policyDigest: sha256
  ruleId: canonical_rule_id
  targetRef: canonical_target_reference
  recoveryKind:
    - evidence_import
    - checkpoint_amendment
    - evidence_replacement
    - scoped_exception
  beforeSimulationDigest: sha256
  afterSimulationDigest: sha256
  beforeResult: fail | indeterminate
  afterResult: pass
  verifiedAt: timestamp
  proofDigest: sha256
```

Import requires complete M28 simulation reports for before and after.

AIQT verifies:

- protocols and canonical digests;
- same policy, rule, target, and deterministic `asOf` contract;
- before rule result is fail/indeterminate;
- after rule result is pass;
- no raw simulation report is persisted;
- only bounded proof metadata and digests are stored.

### 4.6 Activation plan

```yaml
RequiredModeActivationPlan:
  protocolVersion: aiqt-required-mode-activation-plan@1
  planId: deterministic_id
  profileRef: immutable_profile_reference
  generatedAt: timestamp
  expiresAt: timestamp
  activationSnapshotDigest: sha256
  grandfatheredWorkUnitIds: sorted_bounded_array
  metrics:
    advisoryObservations: integer
    classifiedFindings: integer
    falsePositiveRate: decimal_or_null
    runlogHistoryComplete: boolean
    unavailableObservations: integer
    rulesObserved: integer
    rulesRequired: integer
    recoveryProofsValid: integer
    recoveryProofsRequired: integer
  blockers: sorted_bounded_array
  projectActivationResidualRisk: integer_0_to_100
```

Rules:

- activation plans are canonical, bounded, and expire after 24 hours;
- maximum five plans are retained;
- activation snapshot includes profile/policy digests, advisory telemetry, relevant issue state, recovery-proof digests, Work Unit statuses, effective checkpoint references, and grandfathering set;
- any relevant change invalidates the plan;
- `projectActivationResidualRisk` is computed exactly by §4.6.1;
- activation residual risk is `0` only when every Gate K condition is closed;
- every open condition scores at least `8`, therefore blocks the `<=5` threshold;
- no profile field, CLI argument, imported plan field, or user-supplied number can override the computed result.

### 4.6.1 Project activation residual-risk formula

The calculation is deterministic and uses a fixed maximum-of-open-conditions model:

```text
conditionRisk(condition) =
  0, when the condition is satisfied
  fixedWeight(condition), when the condition is open, invalid, missing, stale, or unverifiable

projectActivationResidualRisk =
  max(conditionRisk for every Gate K condition)
```

When all conditions are satisfied:

```text
projectActivationResidualRisk = 0
```

Fixed, non-configurable weights:

| Gate K condition | Open-condition weight |
|---|---:|
| Active profile and policy digests verified | 15 |
| Explicit human activation inputs complete | 12 |
| Required advisory period complete | 10 |
| Accepted false-positive-rate threshold satisfied | 8 |
| Every required rule observed | 10 |
| Every required rule has a valid recovery proof | 15 |
| Amendment composition proven | 15 |
| Readiness composition proven | 15 |
| Advisory runlog history complete | 12 |
| Unavailable observations equal zero | 10 |
| Unresolved deadlock findings equal zero | 15 |
| Activation snapshot current and unexpired | 15 |

Evaluation rules:

- `falsePositiveRate = null` fails when `minimumClassifiedFindings > 0`;
- insufficient observation/classification counts fail their corresponding conditions;
- missing, expired, conflicting, or digest-invalid recovery proofs fail the recovery-proof condition;
- a runlog gap fails history completeness even when current state is usable;
- one or more unavailable observations fail the availability condition;
- any open required issue classified as deadlock fails the deadlock condition;
- a changed profile, policy, evidence, feedback, issue, Work Unit, checkpoint, proof, or grandfathering input fails snapshot currency;
- the weights are protocol constants in `aiqt-required-mode-activation-plan@1`;
- profile authors may define thresholds, but cannot change risk weights or the aggregation method.

Because the smallest non-zero weight is `8`, the activation threshold:

```text
projectActivationResidualRisk <= 5
```

is equivalent to requiring every Gate K condition to be satisfied.

### 4.7 Active activation

```yaml
RequiredModeActivation:
  protocolVersion: aiqt-required-mode-activation@1
  activationId: deterministic_id
  planId: string
  profileRef: immutable_profile_reference
  activationSnapshotDigest: sha256
  activatedAt: timestamp
  activatedBy: bounded_human_identifier
  reason: bounded_non_empty_string
  grandfatheredWorkUnitIds: sorted_bounded_array
  status: active | deactivated
  deactivatedAt: optional_timestamp
  deactivatedBy: optional_bounded_human_identifier
  deactivationReason: optional_bounded_string
```

Activation is explicit, human-authored, and audited.

### 4.8 Scoped exception

```yaml
RequiredEvidenceException:
  protocolVersion: aiqt-required-evidence-exception@1
  exceptionId: deterministic_id
  activationId: string
  gate: checkpoint | development_review | release_review
  scope:
    projectId: canonical_project_id
    workUnitId: optional_canonical_work_unit_id
  policyDigest: sha256
  ruleIds: sorted_non_empty_bounded_array
  authorizedBy: bounded_human_identifier
  reason: bounded_non_empty_string
  createdAt: timestamp
  expiresAt: timestamp
  usage:
    mode: single_use | until_expiry
    consumedAt: optional_timestamp
    consumedByDecisionId: optional_string
  status: active | consumed | revoked | expired
```

Constraints:

- exact activation, gate, policy digest, target scope, and rule IDs;
- maximum expiry 30 days;
- checkpoint exceptions are single-use and target one Work Unit;
- development exceptions cannot satisfy release;
- a profile must explicitly mark every waived rule as exception-eligible;
- malformed references, identity mismatch, broken evidence, or code-state mismatch are never exception-eligible;
- exception create/revoke/consume is append-only audited;
- no wildcard gate or policy exception exists.

---

## 5. Commands

### 5.1 Profile management

```text
aiqt evidence gate enforcement profile import --from-file <path>
aiqt evidence gate enforcement profile import --stdin
aiqt evidence gate enforcement profile import ... --preview
aiqt evidence gate enforcement profile import ... --json

aiqt evidence gate enforcement profile list [--json]
aiqt evidence gate enforcement profile show <profile-id> [--version <n>] [--json]
```

### 5.2 Recovery proofs

```text
aiqt evidence gate enforcement recovery import
  --profile <profile-id>
  --version <n>
  --gate <checkpoint|development-review|release-review>
  --rule <rule-id>
  --before <simulation-report.json>
  --after <simulation-report.json>
  --recovery-kind <kind>
  [--preview]
  [--json]
```

### 5.3 Activation lifecycle

```text
aiqt evidence gate enforcement activation prepare
  --profile <profile-id>
  --version <n>
  [--preview]
  [--json]

aiqt evidence gate enforcement activation activate
  --plan <plan-id>
  --activated-by <human-id>
  --reason <text>
  --confirm-required <project-id>
  [--json]

aiqt evidence gate enforcement activation deactivate
  --activation <activation-id>
  --deactivated-by <human-id>
  --reason <text>
  --confirm-deactivate <project-id>
  [--json]

aiqt evidence gate enforcement status [--json]
```

Activation requires:

- non-expired plan;
- matching current activation snapshot digest;
- zero blockers;
- computed project activation residual risk `<=5`;
- exact project confirmation;
- no current active activation.

Deactivation:

- does not complete or amend any Work Unit;
- does not delete decisions, issues, exceptions, or history;
- returns the project to advisory/off;
- requires explicit human identity, reason, activation ID, and project confirmation.

### 5.4 Exceptions

```text
aiqt evidence gate exception create
  --activation <activation-id>
  --gate <checkpoint|development-review|release-review>
  [--work-unit <work-unit-id>]
  --rules <comma-separated-rule-ids>
  --authorized-by <human-id>
  --reason <text>
  --expires-at <timestamp>
  --confirm-exception <project-id>
  [--preview]
  [--json]

aiqt evidence gate exception revoke
  <exception-id>
  --revoked-by <human-id>
  --reason <text>
  [--preview]
  [--json]

aiqt evidence gate exception list [--json]
```

No exception command accepts `--force`, unbounded scope, arbitrary policy code, or a provider token.

---

## 6. Shared Required-Evidence Decision Service

Introduce one shared service:

```text
evaluateRequiredEvidenceGate
```

It is the only M30 owner for enforcement classification.

Inputs:

```yaml
gate:
  checkpoint | development_review | release_review
candidateState: canonical_candidate_state
targetSet: deterministic_targets
profile: immutable_profile
activation: active_activation
asOf: one_captured_timestamp
candidateCheckpoint: optional
candidateAmendment: optional
```

Processing:

1. confirm active activation and immutable profile/policy references;
2. apply grandfathering;
3. validate required workflow/code/provider bindings through M22/M23 owners;
4. select evidence through canonical evidence owners;
5. call the M28 snapshot builder and simulator;
6. aggregate deterministic target/rule results;
7. resolve eligible exact exceptions;
8. classify one decision;
9. produce bounded recovery guidance.

It must not copy:

- trust ordering;
- artifact-kind selection;
- scope matching;
- freshness;
- M28 rule aggregation;
- snapshot canonicalization;
- simulation digests;
- M12 effective-result logic;
- M18 readiness logic;
- M22 issue lifecycle.

### 6.1 Decision contract

```yaml
RequiredEvidenceDecision:
  protocolVersion: aiqt-required-evidence-decision@1
  decisionId: deterministic_id
  activationId: string
  profileRef: immutable_profile_reference
  gate: checkpoint | development_review | release_review
  targetRefs: sorted_bounded_array
  asOf: timestamp
  outcome:
    - allow
    - needs_review
    - blocked
    - invalid
  deficiency:
    - none
    - failed
    - indeterminate
    - unavailable
    - missing
    - insufficient_trust
    - stale
    - provider_not_accepted
    - binding_mismatch
    - invalid_reference
  simulationDigests: sorted_bounded_array
  exceptionRefs: sorted_bounded_array
  blockingRuleRefs: sorted_bounded_array
  summary: bounded_string
  recovery:
    commands: sorted_bounded_guidance_array
  recordedAt: timestamp
```

No raw evidence, simulation report, provider payload, token, log, command output, or source content is persisted.

### 6.2 Deficiency precedence

```text
invalid_reference or binding_mismatch
→ invalid

missing with no eligible exception
→ blocked

provider_not_accepted, insufficient_trust, stale, failed
→ profile fail behavior

indeterminate
→ profile indeterminate behavior

unavailable
→ profile unavailable behavior

all required targets pass
→ allow

all remaining failed rules covered by valid scoped exception
→ allow with exception
```

An exception cannot convert `invalid` into `allow`.

---

## 7. Checkpoint and Amendment Enforcement

### 7.1 Existing-result precedence

Required evidence only gates a transition that would otherwise become `done`.

```text
existing checkpoint result is not done
→ preserve existing result
→ required evidence cannot improve it
```

A passing gate never converts an acceptance/validation failure into success.

### 7.2 Candidate checkpoint evaluation

For a candidate that would become done:

```text
1. capture one timestamp
2. build candidate checkpoint ID and record
3. build candidate state containing the checkpoint and attached evidence refs
4. evaluate required gate against candidate state
5. map decision through transition matrix
6. atomically persist the final candidate state
7. append ordered checkpoint, required-decision, exception-consumption, and advisory events
8. recalculate readiness only when final status is done
```

M29 advisory visibility must be derived from the same M28 simulation result. Do not rerun or reclassify the evidence.

### 7.3 Amendment evaluation

An amendment may change only existing supported fields, including:

- `acceptanceCriteriaResult`;
- `validationResult`;
- replacement evidence references.

Rules:

- build one candidate amendment state;
- call `computeEffectiveCheckpointResult` or its verified successor;
- if the effective result would remain `needs_review`, preserve it;
- if it would become `done`, run the same required gate against the candidate state;
- changing result fields alone cannot waive evidence;
- generic amendment APIs have no waiver flag;
- pass/exception may permit `needs_review → done`;
- fail may retain `needs_review`;
- block/invalid rejects the amendment without canonical mutation;
- readiness recalculates only after an allowed done transition.

### 7.4 Persistence and audit

When a checkpoint/amendment decision is persisted, append:

```text
evidence_gate.required_decision_recorded
```

If an exception is consumed, also append:

```text
evidence_gate.exception_consumed
```

State is authoritative when runlog append fails. Retry must:

- detect the existing checkpoint/amendment/decision;
- append missing events;
- avoid duplicate state or readiness changes;
- return a repaired/no-op result.

A blocked or invalid attempt performs no canonical state or runlog mutation.

---

## 8. Review, Readiness, and Prospective Policy

### 8.1 Development and release review

Review explicitly evaluates its configured required gate.

```yaml
off_or_advisory:
  behavior: existing review semantics

required_allow_or_exception:
  behavior: existing review semantics

required_fail_or_configured_indeterminate_unavailable:
  exit: 1
  behavior: required evidence blocker is shown

required_invalid:
  exit: 3
```

Required evidence cannot hide stronger existing review blockers.

Review remains read-only and appends no runlog event.

### 8.2 Readiness

M30 adds no second readiness engine.

- a new Work Unit becomes done only after an allowed checkpoint/amendment decision;
- M18 recalculation runs only after the final allowed status is persisted;
- `needs_review` and blocked in-progress work do not satisfy blocking dependencies;
- grandfathered done Work Units continue satisfying dependencies;
- later policy changes or staleness never silently withdraw readiness.

### 8.3 Grandfathering

At activation, snapshot every currently effective-done Work Unit into `grandfatheredWorkUnitIds`.

Grandfathered work:

- remains done;
- remains dependency-satisfying;
- is excluded from required checkpoint/development/release target sets;
- may still appear in advisory/release warnings where existing behavior allows;
- is not silently re-evaluated into failure.

### 8.4 Policy/profile changes

Profiles and policies are immutable.

To change required behavior:

1. prepare a new activation plan for a newer profile version;
2. explicitly deactivate the old activation;
3. explicitly activate the new plan.

The new activation snapshots all then-effective-done Work Units as grandfathered. Policy changes are prospective by default.

---

## 9. Transition Matrix

No unspecified transition is allowed.

### 9.1 Checkpoint or amendment requesting done

| Mode | Required decision | Existing result | Outcome | Exit | Mutation |
|---|---|---|---|---:|---|
| off | n/a | done | done | existing | existing |
| advisory | any | done | done with advisory | existing | existing + advisory |
| required | allow | done | done | 0 | checkpoint/amendment + decision |
| required | allow with valid exception | done | done with visible exception | 0 | checkpoint/amendment + decision + consume |
| required | failed | done | needs_review | 0 | checkpoint/amendment + decision |
| required | indeterminate + `needs_review` | done | needs_review | 0 | checkpoint/amendment + decision |
| required | indeterminate + `block` | done | unchanged | 2 | none |
| required | unavailable + `needs_review` | done | needs_review | 0 | checkpoint/amendment + decision |
| required | unavailable + `block` | done | unchanged | 2 | none |
| required | missing | done | unchanged | 2 | none |
| required | provider not accepted | done | profile fail behavior | 0 or 2 | per behavior |
| required | insufficient trust | done | profile fail behavior | 0 or 2 | per behavior |
| required | stale | done | profile fail behavior | 0 or 2 | per behavior |
| required | binding mismatch | done | unchanged | 3 | none |
| required | invalid reference | done | unchanged | 3 | none |
| any | any | existing needs_review | needs_review | existing | existing |

### 9.2 Review

| Mode | Gate result | Outcome |
|---|---|---|
| off | n/a | existing review |
| advisory | any | existing review plus warnings |
| required | allow/exception | existing review |
| required | fail | exit 1 |
| required | configured indeterminate/unavailable failure | exit 1 |
| required | configured warning | existing exit plus warning |
| required | invalid | exit 3 |

---

## 10. Issue, Visibility, and Recovery

### 10.1 Issues

Required deficiencies reuse ProjectIssue because post-hoc checkpoint issues are immutable under the accepted M29 architecture correction.

Key input:

```yaml
source: evidence_gate_required
activationId: string
gate: string
targetRef: canonical_reference
policyDigest: sha256
ruleId: canonical_rule_id
deficiency: bounded_enum
```

Rules:

- deterministic and idempotent;
- separate from advisory issue keys;
- no second lifecycle;
- blocking classification derives from required mode and gate;
- pass never deletes issue history;
- later recovery updates through existing lifecycle owners;
- no automatic promotion into repair work.

### 10.2 Recovery guidance

Every block/needs-review decision returns bounded commands selected from existing capabilities, such as:

- import replacement evidence;
- run explicit simulation;
- amend the checkpoint with replacement evidence;
- create an eligible scoped exception;
- deactivate required mode through governed rollback;
- rerun checkpoint/review.

Guidance is data only and is never executed.

### 10.3 Status, manage, and export

Use one centralized required-evidence projection.

Show:

```yaml
requiredEvidence:
  effectiveMode: off | advisory | required
  activation: optional_bounded_reference
  profile: optional_bounded_reference
  grandfatheredWorkUnits: integer
  activeExceptions: integer
  blockedTargets: integer
  needsReviewTargets: integer
  currentRecoveryCommand: optional_string
  projectActivationResidualRisk: optional_integer
  blocking: boolean
```

Manage may recommend an evidence recovery command when it is the primary workflow blocker. It must not hide stronger pre-existing blockers.

Exports include bounded profile/activation/decision/exception summaries and never include raw evidence or human rationale by default.

---

## 11. Runlog Events

Required event types:

```text
evidence_gate.enforcement_profile_imported
evidence_gate.recovery_proof_imported
evidence_gate.activation_plan_prepared
evidence_gate.required_mode_activated
evidence_gate.required_mode_deactivated
evidence_gate.required_decision_recorded
evidence_gate.exception_created
evidence_gate.exception_consumed
evidence_gate.exception_revoked
```

All mutation events require:

- deterministic identity;
- bounded payload;
- state-first ordering;
- same-identity/same-payload no-op;
- same-identity/different-payload conflict exit `3`;
- missing-event detection and idempotent repair.

Append-only runlog is historical authority. Bounded state is current operational authority.

---

## 12. Exit Codes

| Condition | Exit |
|---|---:|
| Profile/recovery/plan/activation/deactivation/exception mutation succeeds | 0 |
| Preview/no-op/repaired replay succeeds | 0 |
| Required checkpoint passes or becomes needs_review | 0 |
| Required checkpoint blocked by missing/configured block | 2 |
| Development/release review blocked by required evidence | 1 |
| Invalid binding/reference/profile/plan/digest/input | 3 |
| Activation plan has blockers or risk >5 | 2 |
| Activation snapshot changed/plan expired | 2 |
| Exception not eligible/expired/wrong scope | 2 |
| State succeeds but required mutation runlog append fails | 3 |
| Required input absent | 10 |

Existing checkpoint/review errors retain their existing codes.

---

## 13. Work Units

### WU30-01 — Gate J and Load-Bearing Contract Audit

- verify baseline and Gate J campaign;
- verify owner map;
- approve candidate-state, amendment, readiness, binding, grandfathering, and runlog decisions;
- freeze transition matrix;
- recalculate entry risk.

Tag:

```text
m30-wu01-gate-j-enforcement-audit
```

### WU30-02 — Enforcement Profiles, Recovery Proofs, and Activation Plans

- schemas and limits;
- profile import/list/show;
- recovery-proof import;
- deterministic activation readiness and residual risk;
- prepare/status commands;
- historical compatibility.

Tag:

```text
m30-wu02-profiles-activation-plans
```

### WU30-03 — Shared Required-Evidence Decision Engine

- provider/binding eligibility;
- M28 reuse;
- deterministic target aggregation;
- deficiencies, exceptions, recovery guidance;
- decision digests and tests.

Tag:

```text
m30-wu03-required-decision-engine
```

### WU30-04 — Checkpoint and Amendment Enforcement

- candidate checkpoint evaluation;
- transition matrix;
- M12 composition;
- M18 recalculation ordering;
- state/runlog repair;
- M29 projection reuse.

Tag:

```text
m30-wu04-checkpoint-amendment-enforcement
```

### WU30-05 — Review Gates, Grandfathering, and Prospective Profiles

- development/release review gates;
- target sets;
- readiness parity;
- activation/deactivation;
- grandfathering;
- profile replacement epochs.

Tag:

```text
m30-wu05-review-grandfathering
```

### WU30-06 — Scoped Exceptions, Issues, Visibility, and Recovery

- create/revoke/consume exception lifecycle;
- required ProjectIssue routing;
- status/manage/export;
- recovery guidance;
- privacy and bounds.

Tag:

```text
m30-wu06-exceptions-visibility-recovery
```

### WU30-07 — Gate K Dogfood, Hardening, and Closure

- all transition rows;
- three disposable project profiles;
- activation pass/fail fixtures;
- deadlock and recovery matrix;
- runlog-gap repair;
- historical compatibility;
- full validation, audit, version governance, clean clone, and real CI;
- residual-risk reconciliation;
- Gate K handoff.

Tag:

```text
m30-wu07-final-validation
```

Preferred milestone tag:

```text
m30-required-evidence-enforcement
```

Each Work Unit requires one detailed commit, one annotated tag, `Risk: N/100`, focused validation, and a report under 250 words. The 250-word limit remains the default under full ceremony; a report may exceed it only to document a blocker, accepted deviation, failed control, or above-target residual risk, and must state why.

---

## 14. Validation Requirements

At minimum, prove:

1. Gate J evidence and baseline;
2. all additive Zod fixtures and historical state;
3. profile identity/version/digest/replay/limits;
4. provider IDs are data only;
5. recovery-proof report/digest/rule validation;
6. activation metrics, blockers, expiry, snapshot invalidation, exact fixed condition weights, maximum aggregation, and computed risk;
7. explicit activation and deactivation;
8. no silent required activation;
9. all checkpoint transition rows;
10. existing-result precedence;
11. no state/runlog mutation for blocked/invalid attempts;
12. candidate checkpoint simulation through M28;
13. no duplicate M28 logic;
14. M12 effective amendment composition;
15. result-field-only amendment cannot bypass;
16. M18 readiness only after allowed done;
17. grandfathered dependencies remain satisfied;
18. profile changes are prospective;
19. later staleness never reverses done/readiness;
20. development and release review target sets and exits;
21. exact exception eligibility, expiry, consumption, revocation, and cross-gate isolation;
22. malformed/binding/code/provider/trust/freshness deficiencies;
23. ProjectIssue reuse and no dual lifecycle;
24. M29 advisory projection derived from the same simulation;
25. state/runlog failure injection and repair for every mutation family;
26. runlog historical completeness;
27. bounded state, outputs, and privacy;
28. no force/bypass aliases;
29. zero network/provider execution, process, shell, Git mutation, validation execution, dynamic loading, agent execution, and auto-repair;
30. no-policy/off/advisory historical parity;
31. disposable Gate K projects:
    - eligible activation succeeds;
    - incomplete advisory period blocks;
    - false-positive threshold breach blocks;
    - missing rule recovery proof blocks;
    - unavailable/runlog gap blocks;
    - activation snapshot drift blocks;
    - explicit deactivation recovers;
32. full M12, M18, M22, M23, M26, M28, M29, and historical fixture regressions;
33. typecheck, lint, full tests, build, audit, version checks, clean clone, and real CI on supported Node versions.

Because M30 changes completion semantics, a manual clean-clone validation is required in addition to real CI.

---

## 15. Risk Register

Roadmap formula:

```text
inherent = round((probability × impact / 12) × 100)
```

`Controlled` is the post-design, pre-repository-evidence score. `Entry target` is the maximum permitted score after Gate J verifies the controls against the live repository.

| ID | Hazard | Probability | Impact | Inherent | Design control | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M30-R01 | Gate falsely marks incomplete work done | High | Critical | 100 | existing-result precedence; M28 evaluator; full transition fixtures | 50 | 35 | 15 |
| M30-R02 | Required mode deadlocks legitimate work | High | Critical | 100 | advisory dogfood; recovery matrix; deactivation; exact exceptions | 50 | 35 | 15 |
| M30-R03 | Required mode activates silently | High | Critical | 100 | separate profile/plan/activation; exact confirmation; Gate K | 33 | 25 | 8 |
| M30-R04 | Legacy projects change behavior | High | Critical | 100 | absent fields; derived mode; historical parity | 33 | 25 | 10 |
| M30-R05 | Amendments bypass required evidence | High | Critical | 100 | candidate amendment plus canonical effective-result service | 50 | 35 | 15 |
| M30-R06 | Readiness disagrees with checkpoint | High | Critical | 100 | status transition before single M18 recalculation | 50 | 35 | 15 |
| M30-R07 | Policy change retroactively invalidates done work | High | Critical | 100 | activation epochs and grandfather snapshot | 33 | 25 | 10 |
| M30-R08 | Later staleness withdraws released readiness | High | Critical | 100 | no silent reversal; review findings only | 33 | 25 | 10 |
| M30-R09 | Wrong work-unit/packet/root/code evidence passes | High | Critical | 100 | canonical binding validation before simulation | 50 | 35 | 15 |
| M30-R10 | Low-trust/unaccepted-provider evidence passes | High | High | 75 | canonical trust plus provider eligibility | 42 | 30 | 12 |
| M30-R11 | Provider outage/network dependency blocks workflow | Medium | Critical | 67 | zero network calls; configured unavailable behavior | 33 | 25 | 10 |
| M30-R12 | Exception becomes generic bypass | High | Critical | 100 | exact gate/policy/rules/scope; expiry; no invalid waiver | 50 | 35 | 15 |
| M30-R13 | Development exception satisfies release | Medium | Critical | 67 | gate-specific exception identity | 33 | 25 | 8 |
| M30-R14 | Activation risk is user-spoofed | High | Critical | 100 | deterministic formula; fixed weights; snapshot digest; no override | 33 | 25 | 8 |
| M30-R15 | Untested recovery path reaches production | High | Critical | 100 | before/after M28 recovery proof required per rule | 50 | 35 | 15 |
| M30-R16 | State succeeds but runlog audit is incomplete | Medium | High | 50 | deterministic event repair and completeness checks | 42 | 30 | 12 |
| M30-R17 | Review and checkpoint classify differently | High | High | 75 | one shared required-decision service | 42 | 30 | 12 |
| M30-R18 | Required issues create parallel lifecycle | Medium | High | 50 | M22 ProjectIssue reuse | 33 | 25 | 10 |
| M30-R19 | Canonical state grows without bound | Medium | High | 50 | strict profile/plan/proof/exception/history caps | 33 | 25 | 10 |
| M30-R20 | Enforcement leaks evidence or rationale | Medium | Critical | 67 | bounded metadata-only decisions/events/exports | 33 | 25 | 10 |
| M30-R21 | Blocked attempt partially mutates state | High | Critical | 100 | candidate state; no write before decision | 50 | 35 | 15 |
| M30-R22 | Required gate executes code or provider calls | Medium | Critical | 67 | static boundary scans; data-only contracts | 25 | 17 | 5 |
| M30-R23 | M29 advisory and M30 required results diverge | Medium | High | 50 | derive advisory projection from same simulation | 33 | 25 | 8 |
| M30-R24 | Activation snapshot becomes stale before activation | Medium | Critical | 67 | 24-hour expiry plus relevant snapshot digest | 33 | 25 | 8 |

```yaml
risk_rollup:
  inherentRiskMaximum:
    formula: max(Inherent)
    value: 100
  controlledDesignRisk:
    formula: max(Controlled)
    value: 50
  implementationEntryRisk:
    formula: max(current score after Gate J verification)
    maximum: 35
  mergeResidualRisk:
    formula: max(final residual for every hazard)
    maximum: 15
  projectActivationResidualRisk:
    formula: max(fixed weight for every open Gate K condition)
    maximum_for_activation: 5
    practical_effect: all Gate K conditions must be closed because the minimum open weight is 8
```

Full-ceremony closure must reconcile every hazard’s final residual against its target. Narrative detail is required only for failed controls, accepted risks, deviations, or residuals above target.

---

## 16. Definition of Done

M30 closes only when:

- Gate J passes with entry risk at most `35`;
- effective off/advisory/required mode derivation is compatible;
- profiles, recovery proofs, activation plans, activation, and exceptions are bounded and replay-safe;
- project activation risk uses the fixed §4.6.1 maximum-of-open-conditions formula and cannot be user-overridden;
- no activation occurs above `5/100`;
- every checkpoint transition row is implemented and tested;
- existing checkpoint failure precedence is preserved;
- M12 amendment bypass is impossible;
- M18 readiness changes only after allowed done;
- grandfathering and prospective profile changes are deterministic;
- later staleness never silently reverses done/readiness;
- development/release review enforcement works through the shared service;
- every block has bounded recovery guidance;
- scoped exceptions are exact, visible, expiring, and audited;
- no generic bypass exists;
- no external execution/network/provider dependency exists;
- runlog gaps are detectable and repairable;
- all seven Work Units are committed, tagged, and risk-scored;
- manual clean clone and real CI pass;
- package/version governance passes;
- merge residual risk is at most `15/100`;
- M30 implementation is formally closed;
- no real project is represented as authorized for required mode without separately passing Gate K.

---

## 17. Gate K — Per-Project Activation Contract

M30 release does not activate required mode for any project.

A project may activate only when:

```yaml
gate_k:
  active_profile_and_policy_digests: verified
  explicit_human_activation: recorded
  project_advisory_period: complete
  accepted_false_positive_rate: satisfied
  every_required_rule_observed: true
  every_required_rule_recovery_proof: valid
  amendment_composition: proven
  readiness_composition: proven
  advisory_runlog_history_complete: true
  unavailable_observations: 0
  unresolved_deadlock_findings: 0
  activation_snapshot_current: true
  projectActivationResidualRisk: 0
```

The authorization threshold remains `<=5`; the deterministic model produces `0` only when all known activation risks are closed.

Gate K is evaluated independently for every project and every new profile activation epoch.
