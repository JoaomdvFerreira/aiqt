# AIQT Milestone 29 Build Specification v0.2

## Advisory Checkpoint Evidence Integration

```yaml
document:
  product: AIQT CLI
  type: Delta Build Specification
  version: 0.2
  status: Revised review candidate
  milestone:
    id: M29
    title: Advisory Checkpoint Evidence Integration
    classification: medium
    work_units: 3
  baseline_claims:
    branch: main
    development_baseline_commit: a1c81f5
    product_version: 0.16.0
    source_release_commit: 1cd20db
    release_tag: v0.16.0
    milestone_tag: m28-evidence-gate-simulation
    tests: 2222
    schema_version: 0.5.0
    M28_merge_residual_risk: 8
    Gate_I: open
    M29_started: false
    M30_started: false
  risk:
    inherent: 50
    controlled_design_target: 33
    implementation_entry_maximum: 30
    merge_residual_maximum: 12
```

This specification is delta-only. Repository-wide development rules come from:

```text
docs/engineering/milestone-protocol.md
docs/engineering/repository-owner-map.json
docs/engineering/claude-code-prompt-template.md
```

The owner map is an index, not authority. Gate I must verify every relevant entry against live code.

### v0.2 corrections

v0.2:

- makes append-only runlog events the complete historical record for advisory observations while keeping checkpoint state as the current/latest-N mirror;
- defines explicit advisory event types and idempotency keys;
- requires telemetry/export completeness to be declared when a runlog gap exists;
- replaces the ambiguous automatic `asOf` fallback with one Gate-I-verified canonical checkpoint completion timestamp;
- defines exactly when `refreshCommand` appears.

---

## 1. Objective

Integrate the M28 evidence-policy evaluator into checkpoint, amendment, review, manage, status, and export workflows as **advisory information only**.

```text
checkpoint or effective checkpoint amendment
  → existing completion transition remains authoritative
  → M28 shared evaluator runs as a non-blocking advisory operation
  → bounded advisory observation and canonical issue links
  → review/manage/status/export visibility
  → optional human feedback for false-positive measurement
```

M29 must not alter whether a checkpoint can become done, whether downstream work becomes ready, or whether a Work Unit is complete.

### 1.1 Required outcome

After M29:

- a successful checkpoint remains successful regardless of evidence result;
- active evidence policy evaluation is attempted automatically after checkpoint success;
- evaluation produces `pass`, `fail`, `indeterminate`, `not_configured`, or `unavailable` advisory visibility;
- failed or indeterminate rules create/link deterministic advisory issues through existing M22 routing;
- checkpoint amendments that attach replacement evidence can refresh the advisory;
- review, manage, status, and exports use one shared advisory projection;
- humans can classify advisory issues for false-positive and friction measurement;
- no policy is upgraded to required;
- no historical completed checkpoint is invalidated;
- M30 remains unimplemented.

### 1.2 Non-goals

M29 does not:

- block checkpoint or amendment completion;
- change M18 effective readiness;
- change `next`, packet, workspace, execution-session, or release semantics;
- enforce evidence;
- execute, fetch, refresh, inspect, or verify evidence externally;
- change evidence trust;
- create another policy evaluator;
- create another issue lifecycle;
- automatically promote issues into repair Work Units;
- infer false positives;
- invalidate historical checkpoints;
- backfill all historical checkpoints automatically;
- implement required mode or project activation.

---

## 2. Gate I — Entry Audit

Gate I is read-only.

### 2.1 Verify baseline and governance

Treat the baseline block as claims. Confirm:

- branch, commits, tags, package/schema versions, tests, and M28 risk;
- M28 is formally closed;
- governance commit `a1c81f5` is present;
- all three engineering governance files exist and are tracked;
- `pnpm version:check` is available;
- M29/M30 code does not already exist.

### 2.2 Verify relevant owners

Using the owner map as the starting index, verify:

- checkpoint command and completion transition;
- checkpoint identity and persistence;
- `computeEffectiveCheckpointResult` or current M12 equivalent;
- checkpoint amendment and replacement-evidence attachment;
- M18 readiness calculation;
- M22 CheckpointIssue/ProjectIssue routing, issue keys, lifecycle overlays, and projections;
- M28 policy selection and simulation engine;
- evidence records, `ArtifactReference.kind`, trust, scope, and `recordedAt`;
- the single canonical timestamp written by successful checkpoint completion;
- append-only runlog event construction, event identity, replay, and gap detection;
- status, review, manage, and export projection owners;
- candidate-state, atomic write, preview, JSON, and exit-code owners.

Do not duplicate any verified owner.

Gate I must record the exact repository path and field name used as the automatic checkpoint-evaluation `asOf`. There is no fallback between multiple timestamps. Implementation stops if one stable completion timestamp cannot be identified.

### 2.3 Approve the checkpoint parity matrix

Before implementation, record expected pre-M29 and M29 behavior for at least:

| Scenario | Checkpoint result before M29 | Required result after M29 |
|---|---|---|
| No policy | Existing success/failure | Identical |
| Advisory policy passes | Existing success/failure | Identical |
| Advisory policy fails | Existing success/failure | Identical |
| Advisory policy indeterminate | Existing success/failure | Identical |
| Advisory evaluation unavailable | Existing success/failure | Identical |
| Historical completed checkpoint | Remains complete | Identical |
| Downstream readiness | Existing result | Identical |

Checkpoint completion and readiness fields must be byte-equivalent where practical.

### 2.4 Gate I decision

Proceed only when:

```text
implementationEntryRisk <= 30
```

Stop when:

- M28 evaluator cannot be reused directly;
- advisory work would need to occur before or inside the load-bearing completion decision;
- M12 amendments or M18 readiness lack a stable centralized owner;
- canonical issue routing cannot prevent duplicates;
- a new issue lifecycle appears necessary;
- High/Critical dependency alerts lack disposition;
- schema compatibility requires an unapproved breaking change.

---

## 3. Advisory Integration Contract

### 3.1 Ordering and audit authority

Automatic advisory evaluation occurs **after** the existing checkpoint transition succeeds.

```text
1. execute existing checkpoint operation unchanged
2. persist its existing state/runlog effects
3. evaluate advisory against the resulting canonical checkpoint
4. persist current/latest-N advisory state
5. append the idempotent advisory observation event
6. render combined output
```

Consequences:

- advisory failure cannot roll back or block a checkpoint;
- if advisory evaluation or persistence fails, checkpoint state remains authoritative;
- the command still returns the pre-M29 checkpoint success exit code;
- output reports advisory `unavailable` with a bounded recovery instruction;
- retry or explicit refresh may complete the advisory mutation later.

The same post-success ordering applies when a checkpoint amendment attaches replacement evidence.

Audit ownership is split deliberately:

```yaml
canonical_checkpoint_state:
  authority: current advisory status and latest-N convenience view

append_only_runlog:
  authority: complete advisory observation history
```

Every distinct advisory observation must append exactly one bounded runlog event, even when the state history later truncates that observation.

Required event types:

```text
evidence_gate.advisory_observation_recorded
evidence_gate.advisory_feedback_recorded
```

`evidence_gate.advisory_observation_recorded` covers:

- `evaluated`;
- `not_configured`;
- `unavailable`.

Its bounded payload contains only:

```yaml
observationId: deterministic_id
checkpointId: canonical_checkpoint_id
workUnitId: canonical_work_unit_id
trigger: checkpoint | amendment | manual_refresh
evaluationStatus: evaluated | not_configured | unavailable
overallResult: pass | fail | indeterminate | null
policyRef: optional_bounded_reference
asOf: timestamp
simulationDigest: optional_sha256
issueKeys: sorted_bounded_array
recordedAt: timestamp
```

No evidence body, artifact metadata, provider payload, validation output, or human rationale is allowed.

Event replay rules:

- `observationId` is deterministic from checkpoint ID, trigger identity, policy digest/status, `asOf`, and simulation digest/status;
- the same observation ID and payload is a no-op;
- the same observation ID with different payload is exit `3`;
- state succeeds but runlog append fails: state remains authoritative for current status, the gap is detectable, and retry appends the missing event without duplicating state;
- state history truncation never deletes runlog history.


### 3.2 Shared evaluator

M29 must call the M28 policy-selection and simulation services.

It must not copy:

- trust comparison;
- artifact-kind matching;
- scope matching;
- freshness;
- rule aggregation;
- snapshot canonicalization;
- simulation digest logic.

Automatic checkpoint evaluation uses:

```yaml
target:
  type: checkpoint
  id: persisted_checkpoint_id
asOf: canonical_checkpoint_completion_timestamp_verified_by_Gate_I
policy: active_policy_at_evaluation_time
```

The Gate I report must name the exact repository field bound to `canonical_checkpoint_completion_timestamp_verified_by_Gate_I`. No alternate or fallback timestamp is permitted.

Amendment-triggered evaluation uses the effective checkpoint result and the canonical amendment-recorded timestamp as `asOf`.

Explicit refresh uses caller-provided `--as-of`; otherwise it uses one command timestamp captured once at command start.

### 3.3 Advisory observation

Add an optional, bounded advisory projection to the existing checkpoint owner:

```yaml
CheckpointEvidenceAdvisory:
  protocolVersion: aiqt-checkpoint-evidence-advisory@1
  current:
    observationId: deterministic_id
    evaluationStatus:
      - evaluated
      - not_configured
      - unavailable
    overallResult:
      - pass
      - fail
      - indeterminate
      - null
    policyRef:
      policyId: optional
      version: optional
      digest: optional
    asOf: timestamp
    simulationDigest: optional_sha256
    issueKeys: sorted_bounded_array
    summary: bounded_string
    recordedAt: timestamp
  history: bounded_array
```

Rules:

- maximum 10 observations per checkpoint in canonical state;
- this array is a latest-N convenience mirror, not the complete audit record;
- every distinct observation is retained independently through `evidence_gate.advisory_observation_recorded`;
- observations are deduplicated by deterministic `observationId`;
- oldest state observation is removed only when the bounded limit is reached;
- pruning state history never removes or rewrites runlog history;
- no raw evidence, rule summaries, provider payloads, logs, or artifact content is stored;
- `not_configured` means no active policy;
- `unavailable` means the advisory operation could not complete after checkpoint success;
- `unavailable` never changes checkpoint state or readiness;
- historical checkpoints without this field remain valid.

### 3.4 Explicit refresh

```text
aiqt evidence gate advisory refresh --checkpoint <checkpoint-id>
aiqt evidence gate advisory refresh --checkpoint <checkpoint-id> --as-of <ISO_TIMESTAMP>
aiqt evidence gate advisory refresh ... --preview
aiqt evidence gate advisory refresh ... --json
```

Refresh:

- evaluates the current effective checkpoint;
- uses the currently active policy;
- records/link issues idempotently unless `--preview`;
- never changes checkpoint completion;
- returns `0` for pass, fail, indeterminate, or not configured;
- returns `2` when a valid checkpoint cannot currently be evaluated;
- returns `3` for malformed input or broken canonical references.

---

## 4. Advisory Issue Routing

Each applicable M28 rule result of `fail` or `indeterminate` becomes one normalized advisory finding.

Canonical key input:

```yaml
source: evidence_gate_advisory
checkpointId: canonical_checkpoint_id
policyDigest: sha256
ruleId: canonical_rule_id
```

Rules:

- reuse M22 canonical serialization, issue-key, routing, deduplication, and lifecycle owners;
- execution-local conditions route to CheckpointIssue;
- cross-checkpoint, cross-Work-Unit, policy-wide, or system-unavailable conditions route to ProjectIssue;
- initial routing is CheckpointIssue XOR ProjectIssue;
- repeated evaluation links to the existing issue;
- advisory issues are non-blocking and cannot auto-promote;
- pass results create no issue;
- later pass observations do not delete issue history;
- replacement evidence is linked through the existing amendment/evidence path;
- no separate advisory severity or lifecycle vocabulary is introduced.

Advisory issues must be classified separately in projections so they do not:

- make checkpoint completion fail;
- change M18 readiness;
- make review exit `1` by themselves;
- replace manage’s existing primary recommendation.

---

## 5. Human Feedback and Telemetry

M29 needs bounded evidence for Gate J without inferring user intent.

### 5.1 Feedback command

```text
aiqt evidence gate advisory feedback <issue-key>
  --classification <confirmed|false_positive|policy_gap|evidence_missing>
  --rationale <text>
  [--preview]
  [--json]
```

Feedback contract:

```yaml
EvidenceAdvisoryFeedback:
  issueKey: existing_advisory_issue_key
  classification:
    - confirmed
    - false_positive
    - policy_gap
    - evidence_missing
  rationale: bounded_non_empty_string
  recordedAt: timestamp
  updatedAt: timestamp
```

Rules:

- feedback is accepted only for an existing M29 advisory issue;
- one current feedback record exists per issue key;
- identical replay is a no-op;
- changing classification updates through the standard candidate-state path and runlog;
- feedback does not change issue lifecycle, severity, readiness, checkpoint state, or enforcement;
- maximum 500 feedback records per project;
- raw evidence is prohibited.

### 5.2 Derived telemetry

One shared projection derives:

```yaml
EvidenceAdvisoryTelemetry:
  evaluatedCheckpoints: integer
  pass: integer
  fail: integer
  indeterminate: integer
  unavailable: integer
  notConfigured: integer
  checkpointsCompletedDespiteFail: integer
  checkpointsCompletedDespiteIndeterminate: integer
  refreshedAfterAmendment: integer
  feedback:
    confirmed: integer
    falsePositive: integer
    policyGap: integer
    evidenceMissing: integer
    unclassified: integer
```

Telemetry ownership:

- current checkpoint status derives from canonical checkpoint state;
- lifetime and cross-refresh counts derive from `evidence_gate.advisory_observation_recorded`;
- feedback counts derive from `evidence_gate.advisory_feedback_recorded`;
- no raw logs or separate telemetry store exists.

Telemetry/export must include:

```yaml
historyComplete: boolean
runlogGapCount: non_negative_integer
```

When a state-authoritative/runlog gap is detected:

- current checkpoint status remains usable;
- lifetime telemetry must set `historyComplete: false`;
- affected counts must not be presented as complete;
- status/export must show a bounded recovery warning.

---

## 6. Visibility

Use one centralized advisory projection.

### Checkpoint output

Add:

```yaml
evidenceAdvisory:
  status: evaluated | not_configured | unavailable
  result: pass | fail | indeterminate | null
  issueCount: integer
  blocking: false
  refreshCommand: optional_string
  configurationCommand: optional_string
```

Command-presence rules:

- `refreshCommand` is present only for `unavailable`, `fail`, or `indeterminate`;
- `refreshCommand` is absent for `pass` and `not_configured`;
- `configurationCommand` is present only for `not_configured`;
- commands are bounded deterministic guidance strings, never executed automatically.

### Status

Show active policy and aggregate advisory counts. Do not simulate implicitly.

### Review

Show advisory warnings in a separate non-blocking section.

Advisory warnings alone:

- do not change review’s quality result;
- do not cause exit `1`;
- do not become required findings.

### Manage

Expose advisory counts and a secondary suggested action. Do not replace the existing primary next action or readiness classification.

### Export

Include:

- current checkpoint advisory summaries;
- advisory issue references;
- runlog-backed aggregate telemetry;
- `historyComplete` and `runlogGapCount`;
- explicit `blocking: false`.

Do not export raw evidence or feedback rationale unless existing export privacy rules explicitly permit bounded human rationale. Default is counts/classifications only.

---

## 7. Compatibility, Atomicity, and Exit Codes

### 7.1 Compatibility

Preserve:

- historical checkpoints without advisory fields;
- M12 amendment semantics;
- M18 effective readiness;
- M22 issue routing/lifecycle;
- M23 evidence identity/trust;
- M26 checkpoint completion authority;
- M27R execution behavior;
- M28 explicit simulation commands and digests.

No-policy projects retain legacy behavior and near-identical output except an optional bounded `not_configured` advisory section where approved.

### 7.2 Failure semantics

- checkpoint mutation succeeds, advisory mutation fails:
  - checkpoint remains complete;
  - checkpoint’s original exit code is preserved;
  - bounded unavailable warning is returned;
  - explicit refresh can recover;
- advisory observation/feedback state succeeds but runlog fails:
  - state remains authoritative for current status;
  - the missing event is detectable;
  - telemetry/export report incomplete history;
  - command returns exit `3` where the advisory operation is explicit;
  - retry appends the missing event idempotently;
- preview performs complete evaluation with zero mutation.

### 7.3 Consolidated exits

| Condition | Exit |
|---|---:|
| Checkpoint succeeds with any advisory outcome | Existing checkpoint success code |
| Checkpoint fails for pre-M29 reason | Existing checkpoint failure code |
| Refresh pass/fail/indeterminate/not configured | 0 |
| Feedback succeeds/no-op | 0 |
| Valid operation blocked by bounded state/lifecycle condition | 2 |
| Malformed input, broken reference, identity conflict | 3 |
| Advisory mutation state succeeds but runlog fails | 3 |
| Required input absent | 10 |

---

## 8. Work Units

### WU29-01 — Gate I and Checkpoint Advisory Core

- verify baseline and owner map;
- approve parity matrix;
- add bounded checkpoint advisory contract;
- integrate post-success checkpoint evaluation;
- implement explicit refresh;
- prove checkpoint/readiness parity.

Suggested tag:

```text
m29-wu01-checkpoint-advisory-core
```

### WU29-02 — Issue Routing, Amendments, Visibility, and Feedback

- route advisory findings through M22;
- refresh after replacement-evidence amendments;
- add feedback command and bounded telemetry;
- centralize status/review/manage/export projection;
- prove review/manage remain non-blocking.

Suggested tag:

```text
m29-wu02-advisory-visibility-feedback
```

### WU29-03 — Hardening and Closure

- historical compatibility;
- idempotency and runlog-failure recovery;
- privacy and boundary scans;
- focused/full validation according to the Lean Milestone Protocol;
- `pnpm version:check`;
- real CI;
- risk reconciliation and Gate J handoff.

Suggested tag:

```text
m29-wu03-final-validation
```

Preferred milestone tag:

```text
m29-advisory-checkpoint-evidence
```

---

## 9. Validation

At minimum, prove:

1. all Gate I baseline and owner-map claims;
2. checkpoint transition parity across no-policy/pass/fail/indeterminate/unavailable;
3. downstream readiness parity;
4. post-success ordering;
5. M28 evaluator reuse with no duplicate evaluator;
6. active-policy and no-policy behavior;
7. advisory observation bounds and deduplication;
8. deterministic issue keys and no dual routing;
9. advisory issues do not affect review exit, manage primary action, readiness, or completion;
10. amendment replacement evidence uses effective checkpoint state and refreshes advisory;
11. explicit refresh replay, preview, `--as-of`, and failure paths;
12. feedback validation, replay, update, caps, and non-semantic behavior;
13. telemetry counts without raw content;
14. one `evidence_gate.advisory_observation_recorded` event per distinct observation;
15. one `evidence_gate.advisory_feedback_recorded` event per distinct feedback state;
16. state latest-N pruning with complete runlog-backed history;
17. history-completeness and gap reporting;
18. checkpoint success with advisory mutation failure;
19. state-authoritative runlog-failure recovery and idempotent event repair;
20. legacy checkpoints/projects;
21. M12, M18, M22, M26, M28, and M27R regression fixtures;
22. zero enforcement, provider, network, shell, Git, validation-execution, dynamic-loading, and auto-promotion surfaces;
23. version classification and supported-node CI.

Use focused validation per WU and full validation once at closure.

---

## 10. Risk Register

| ID | Hazard | Inherent | Control | Entry target | Residual target |
|---|---:|---:|---|---:|---:|
| M29-R01 | Advisory changes checkpoint completion | 50 | post-success integration and parity matrix | 30 | 12 |
| M29-R02 | Advisory changes downstream readiness | 50 | M18 observation-only integration and parity fixtures | 30 | 10 |
| M29-R03 | M28 and M29 classify evidence differently | 50 | direct reuse of M28 evaluator | 25 | 8 |
| M29-R04 | Duplicate or dual-routed issues | 50 | M22 canonical key/routing only | 25 | 10 |
| M29-R05 | Amendment evidence bypasses effective checkpoint logic | 50 | M12 effective-result owner and refresh tests | 30 | 12 |
| M29-R06 | Review/manage turn advisory into enforcement | 50 | separate projection; exit/action parity | 30 | 10 |
| M29-R07 | Advisory failure rolls back successful checkpoint | 50 | separate post-success mutation | 25 | 8 |
| M29-R08 | Feedback changes lifecycle or is inferred | 33 | explicit bounded feedback-only contract | 17 | 8 |
| M29-R09 | Telemetry leaks data or grows unbounded | 33 | derived aggregates and strict caps | 17 | 8 |
| M29-R10 | M30 enforcement is implemented early | 50 | boundary scans and explicit non-goals | 17 | 5 |
| M29-R11 | Latest-N state pruning destroys audit history or undercounts telemetry | 50 | append-only observation events; state as mirror; completeness flag | 25 | 10 |

```text
implementationEntryRisk <= 30
mergeResidualRisk <= 12
```

Only exceptions, accepted risks, failed controls, or above-target residuals require narrative detail in the closure report.

---

## 11. Definition of Done

M29 closes only when:

- Gate I passes;
- checkpoint and readiness parity are proven;
- M28 evaluator is reused;
- checkpoint advisory evaluation occurs after completion success;
- advisory failure cannot block or roll back completion;
- bounded current/latest-N observations and complete append-only advisory history work;
- advisory event replay and runlog-gap recovery are proven;
- telemetry/export declare whether history is complete;
- amendment replacement evidence refreshes advisory through effective checkpoint logic;
- review, manage, status, and export use one projection;
- advisory warnings do not affect review exit or manage’s primary action;
- explicit false-positive feedback and bounded telemetry work;
- historical projects remain compatible;
- all three Work Units are committed, tagged, and risk-scored;
- version governance and real CI pass;
- merge residual risk is at most `12/100`;
- Gate J opens for M30 design;
- M30 implementation has not started.

## 12. Gate J Handoff

```yaml
gate_j_handoff:
  M29_status: closed
  advisory_checkpoint_integration: active
  evidence_enforcement: false
  checkpoint_completion_authority: unchanged
  readiness_semantics: unchanged
  required_before_M30:
    - three_representative_advisory_projects
    - false_positive_and_friction_data_review
    - amendment_and_readiness_composition_evidence
    - platform_enforcement_gap_disposition
    - M30_entry_risk_at_or_below_35
```
