# AIQT Milestone 28 Build Specification v0.2

## Evidence Gate Simulation

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Revised review candidate before implementation
  milestone:
    id: M28
    title: Evidence Gate Simulation
  baseline:
    product_version: 0.15.0
    development_baseline_commit: 4c6a849
    release_tag: v0.15.0
    milestone_tag: m27r-agent-agnostic-execution-contract
    test_count: 2145
    schema_version: 0.5.0
    M27R_core_merge_residual_risk: 10
    M27R_milestone_merge_residual_risk: 15
    gate_h_status: open
    CI:
      node_22: green
      node_24: green
  risk:
    inherent_maximum: 100
    controlled_design_target: 25
    implementation_entry_maximum: 25
    merge_residual_maximum: 10
```

---

## 0. Position in the Roadmap

M22 established independent review and evidence contracts.

M23 added external evidence import and normalization.

M24–M27R added logical execution metadata, managed workspaces, execution sessions, and agent-agnostic external execution.

M28 introduces:

```text
declared evidence policy
  + current canonical evidence records
  + explicit evaluation target
  + deterministic evaluation time
  → read-only evidence-gate simulation
```

M28 answers:

> If this evidence policy were enforced now, would this project, Work Unit, or checkpoint satisfy it?

M28 does not enforce the answer.

### 0.1 v0.2 review corrections

v0.2 resolves two build-readiness gaps:

1. replaces the assumed evidence-record `kind` selector with the established `ArtifactReference.kind` taxonomy, subject to direct Gate H verification;
2. defines exact snapshot and simulation canonicalization by reusing the M23 canonical-JSON and SHA-256 owners.

No enforcement, checkpoint advisory integration, workflow mutation, or provider coupling is added.

```yaml
M28:
  role: simulate
  workflow_blocking: false
  checkpoint_integration: none

M29:
  role: surface_advisory_checkpoint_evidence_results
  workflow_blocking: false

M30:
  role: optionally_enforce_required_evidence
  workflow_blocking: explicit_per_project_activation_only
```

### 0.2 Product outcome

After M28, a user can:

1. import and activate a bounded evidence policy;
2. simulate it against a project, Work Unit, or checkpoint;
3. see which rules pass, fail, are indeterminate, or do not apply;
4. inspect matched evidence references and missing requirements;
5. reproduce a result with the same state, policy, target, and `--as-of`;
6. export a bounded machine-readable report;
7. continue normal AIQT workflow regardless of the outcome.

### 0.3 Non-goals

M28 does not:

- block checkpoint, `next`, workspace release, packet cancellation, review, or manage;
- change project, milestone, Work Unit, checkpoint, issue, or execution-session state;
- create findings or issues automatically;
- execute validation commands;
- inspect Git, filesystem contents, external systems, agents, CI, or providers;
- fetch or refresh evidence;
- elevate evidence trust;
- convert M27R validation claims into evidence records;
- introduce scripts, expressions, templates, regex, or plugins;
- implement M29 or M30.

---

## 1. Gate H — Simulation Entry Audit

Gate H is read-only and creates no commit, tag, policy, report, or `.aiqt/` development state.

### 1.1 Verify the baseline

Verify directly:

```yaml
branch: main
product_version: 0.15.0
development_baseline_commit: 4c6a849
release_tag: v0.15.0
milestone_tag: m27r-agent-agnostic-execution-contract
tests: 2145
schema_version: 0.5.0
M27R_coreMergeResidualRisk: 10
M27R_milestoneMergeResidualRisk: 15
Gate_H: open
CI:
  node_22: green
  node_24: green
```

Also verify:

- the three WU27R-06 commits and disclosed governance variance;
- dependency alerts remain resolved;
- `generic-json@1` remains canonical;
- the Claude adapter remains optional and synthetic-fixture-only;
- M28 has not already been implemented.

### 1.2 Repository-owner audit

Identify the actual owners for:

- evidence records, `ArtifactReference.kind`, trust levels, scope references, timestamps, and digests;
- M22 review findings and evidence-reference validation;
- M23 import normalization, replay protection, and trust preservation;
- project, Work Unit, packet, and checkpoint identity;
- project configuration and canonical state persistence;
- candidate-state validation and atomic writes;
- runlog ordering;
- file/stdin parsing, JSON-depth limits, prohibited keys, preview, JSON output, and exit codes;
- status, review, manage, and export behavior;
- M22–M27R historical fixtures.

Confirm that policy configuration can be added to an existing canonical owner without a new canonical file.

### 1.3 Evidence-semantics audit

Document the actual M22/M23 semantics for:

- trust:
  - `unverified: 0`
  - `self_reported: 1`
  - `repository_local: 2`
  - `platform_verified: 3`;
- evidence-record identity;
- `ArtifactReference.kind` and its exact canonical values;
- the relationship between one evidence record and its artifact references;
- scope references;
- creation or observation time;
- imported versus local evidence;
- duplicate identity;
- invalid references;
- bounded summaries and metadata;
- M23 canonical-JSON serialization and SHA-256 digest ownership.

The expected artifact taxonomy, subject to direct repository verification, is:

```yaml
ArtifactReference.kind:
  - log
  - report
  - screenshot
  - test_result
  - ci_run
  - diff
  - other
```

Gate H must explicitly conclude one of:

```yaml
artifact_kind_resolution:
  status: confirmed
  field: ArtifactReference.kind
  values: exact_repository_values
```

or:

```yaml
artifact_kind_resolution:
  status: blocked
  reason: no_stable_canonical_artifact_kind_owner
```

Implementation must stop under the blocked branch. M28 must not invent a top-level evidence-record kind or a second taxonomy.


### 1.4 Gate H decision

Implementation may start only when:

```text
implementationEntryRisk <= 25
```

Stop when:

- the baseline differs materially;
- M22/M23 semantics cannot be reused;
- simulation requires executing or fetching evidence;
- evaluation cannot remain deterministic and read-only;
- a new canonical file appears necessary;
- schema `0.5.0` cannot remain additive without approval;
- High or Critical dependency alerts lack an approved disposition.

---

## 2. Objective and Boundaries

M28 must prove that AIQT can:

1. store bounded, versioned evidence policies;
2. retain policy history and identify one active policy;
3. evaluate evidence deterministically;
4. evaluate project, Work Unit, and checkpoint targets;
5. distinguish `pass`, `fail`, `indeterminate`, and `not_applicable`;
6. preserve evidence trust and scope semantics;
7. expose matched references without raw evidence payloads;
8. produce replayable simulation digests;
9. export reports without persisting simulation outcomes;
10. preserve M22–M27R behavior when no policy exists.

Policies must remain provider- and agent-agnostic and may classify evidence only through canonical artifact-reference kinds.

---

## 3. Canonical Policy Contract

M28 adds optional policy configuration to the existing project/configuration owner found during Gate H.

```yaml
EvidenceGateConfiguration:
  policies: bounded_array
  activePolicyRef: optional
```

Historical projects remain valid. Read-only commands do not materialize defaults.

### 3.1 Policy identity and versioning

```yaml
EvidenceGatePolicy:
  protocolVersion: aiqt-evidence-gate-policy@1
  policyId: bounded_namespaced_string
  version: positive_integer
  name: bounded_string
  description: optional_bounded_string
  targetScopes:
    - project
    - work_unit
    - checkpoint
  rules: bounded_array
  policyDigest: sha256
  createdAt: timestamp
  supersedesVersion: optional_positive_integer
```

Rules:

- `(policyId, version)` is immutable;
- same identity and digest is a no-op;
- same identity and different digest is exit `3`;
- a new version must exceed all prior versions for that policy;
- old versions are retained;
- activation changes only `activePolicyRef`;
- activation does not evaluate or enforce;
- removal is outside M28.

`policyId` syntax:

```text
^[a-z0-9][a-z0-9._/-]{0,127}$
```

### 3.2 Policy rule

```yaml
EvidenceGateRule:
  ruleId: bounded_stable_key
  title: bounded_string
  description: optional_bounded_string
  appliesTo:
    - project
    - work_unit
    - checkpoint
  evidenceSelector:
    artifactKinds: bounded_non_empty_array
    minimumTrust:
      - unverified
      - self_reported
      - repository_local
      - platform_verified
    scopeMatch:
      - exact_target
      - target_or_project
    maxAgeSeconds: optional_positive_integer
  requirement:
    minimumCount: integer_1_to_100
  missingDisposition:
    - fail
    - indeterminate
```

Constraints:

- rule IDs are unique within a policy version;
- no script, expression, path query, regex, template, or plugin exists;
- trust is compared using the existing ordering;
- `artifactKinds` must use the exact canonical `ArtifactReference.kind` values confirmed during Gate H;
- an evidence record is a candidate when at least one valid artifact reference has a selected kind;
- an evidence record with multiple matching artifacts counts once within one rule;
- invalid or broken artifact references never make the parent evidence record match;
- `exact_target` counts only evidence bound to the evaluated target;
- `target_or_project` may also count project evidence;
- checkpoint inheritance uses only existing explicit relationships;
- freshness uses explicit `asOf`;
- invalid timestamps do not satisfy freshness;
- the same evidence record may satisfy multiple rules;
- one evidence record counts at most once per rule.

M28 does not define or infer a top-level evidence-record kind.


### 3.3 Limits

```yaml
policy_limits:
  max_policies: 50
  max_versions_per_policy: 20
  max_rules_per_policy: 100
  max_policy_bytes: 262144
  max_artifact_kinds_per_rule: 20
  max_title_chars: 200
  max_description_chars: 2000
  max_age_seconds: 31536000
```

Reaching a canonical limit returns exit `2`.

---

## 4. Policy Management

### 4.1 Commands

```text
aiqt evidence gate policy import --from-file <path>
aiqt evidence gate policy import --stdin
aiqt evidence gate policy import ... --preview
aiqt evidence gate policy import ... --json

aiqt evidence gate policy list
aiqt evidence gate policy list --json

aiqt evidence gate policy show <policy-id>
aiqt evidence gate policy show <policy-id> --version <n>
aiqt evidence gate policy show ... --json

aiqt evidence gate policy activate <policy-id> --version <n>
aiqt evidence gate policy activate ... --preview
aiqt evidence gate policy activate ... --json
```

Exactly one import transport is allowed.

### 4.2 Import behavior

Policy import must:

1. enforce size, depth, prohibited-key, and unknown-field limits;
2. validate artifact-reference kinds and trust values against canonical owners;
3. compute canonical digest;
4. validate version history;
5. apply through one candidate state;
6. atomically write canonical state;
7. append bounded runlog events after state success.

Replay:

- same identity and digest → no-op;
- same identity and different digest → exit `3`;
- invalid rule → reject the complete policy;
- preview performs complete validation with zero mutation;
- import does not activate automatically;
- raw input is not persisted.

### 4.3 Activation

Activation:

- requires an existing valid policy version;
- changes only the active reference;
- supports preview;
- appends a bounded runlog event after state success;
- does not simulate;
- does not create findings;
- does not alter workflow state.

Activating the current version is a no-op.

---

## 5. Simulation Contract

### 5.1 Commands

```text
aiqt evidence gate simulate --project
aiqt evidence gate simulate --work-unit <work-unit-id>
aiqt evidence gate simulate --checkpoint <checkpoint-id>

aiqt evidence gate simulate ... --policy <policy-id>
aiqt evidence gate simulate ... --policy <policy-id> --version <n>
aiqt evidence gate simulate ... --as-of <ISO_TIMESTAMP>
aiqt evidence gate simulate ... --output <path>
aiqt evidence gate simulate ... --json
```

Exactly one target is required.

Policy selection:

- explicit policy/version takes precedence;
- explicit policy without version selects its highest version;
- otherwise use the active policy;
- no active or explicit policy returns exit `2`.

`--as-of` defaults to the command’s captured current timestamp. Tests must use explicit `--as-of`.

Simulation is always read-only and has no `--apply`.

### 5.2 Result model

```yaml
EvidenceGateSimulation:
  protocolVersion: aiqt-evidence-gate-simulation@1
  policy:
    policyId: string
    version: integer
    digest: sha256
  target:
    type: project | work_unit | checkpoint
    id: canonical_id
    relatedProjectId: canonical_project_id
    relatedWorkUnitId: optional_canonical_work_unit_id
  asOf: timestamp
  overallResult:
    - pass
    - fail
    - indeterminate
  ruleResults: bounded_array
  evidenceSnapshotDigest: sha256
  simulationDigest: sha256
  generatedAt: timestamp
```

```yaml
EvidenceGateRuleResult:
  ruleId: bounded_stable_key
  result:
    - pass
    - fail
    - indeterminate
    - not_applicable
  requiredCount: positive_integer
  matchedCount: non_negative_integer
  matchedEvidenceRefs: bounded_array
  rejectedCandidateCounts:
    wrongArtifactKind: non_negative_integer
    insufficientTrust: non_negative_integer
    wrongScope: non_negative_integer
    stale: non_negative_integer
    invalidReference: non_negative_integer
  reasonCode: bounded_enum
  summary: bounded_non_raw_string
```

No raw evidence body, attachment, transcript, command output, provider payload, or secret appears.

### 5.3 Outcomes

For an applicable rule:

```text
matchedCount >= minimumCount
→ pass
```

Otherwise:

```text
missingDisposition = fail
→ fail

missingDisposition = indeterminate
→ indeterminate
```

A rule is `not_applicable` when the target type is not in `appliesTo`.

Overall:

```text
any applicable rule = fail
→ fail

no fail and any applicable rule = indeterminate
→ indeterminate

all applicable rules = pass
→ pass

zero applicable rules
→ indeterminate
```

### 5.4 Trust

Use only:

```yaml
unverified: 0
self_reported: 1
repository_local: 2
platform_verified: 3
```

Rules:

- evidence trust is never recalculated;
- M27R validation claims are not evidence records;
- commit refs, rollback claims, and review findings are not evidence;
- broken evidence references never satisfy a rule;
- trust must be explicit and valid.

### 5.5 Scope

Project:

- project evidence counts under both modes.

Work Unit:

- `exact_target`: Work Unit evidence only;
- `target_or_project`: Work Unit plus project evidence.

Checkpoint:

- `exact_target`: checkpoint evidence only;
- `target_or_project`: checkpoint plus explicitly related Work Unit/project evidence;
- no heuristic association by title, timestamp, path, or summary.

### 5.6 Freshness

```text
ageSeconds = asOf - evidenceReferenceTime
```

Freshness passes only when:

```text
0 <= ageSeconds <= maxAgeSeconds
```

Future-dated evidence does not satisfy freshness.

Gate H selects the existing canonical timestamp used.

### 5.7 Canonicalization and digests

M28 must reuse the M23 canonical-JSON serializer and SHA-256 helper. It must not add a second canonicalization implementation.

Canonical JSON requirements inherited from M23:

- UTF-8 encoding;
- lexicographically sorted object keys;
- arrays preserved only where order is semantically meaningful;
- set-like arrays normalized, deduplicated, and lexicographically sorted;
- no insignificant whitespace;
- SHA-256 over the exact canonical UTF-8 bytes.

#### 5.7.1 Evidence snapshot entry

Each relevant evidence record becomes:

```yaml
NormalizedEvidenceSnapshotEntry:
  evidenceId: canonical_evidence_id
  trust: canonical_trust_value
  scopeRefs: sorted_unique_array_of_type_colon_id
  artifactKinds: sorted_unique_array
  freshnessTimestamp: canonical_UTC_timestamp_or_null
  referenceValidity: valid | invalid
```

Normalization rules:

- entries are sorted lexicographically by `evidenceId`;
- duplicate evidence IDs are invalid canonical state and cannot be silently collapsed;
- `scopeRefs` are normalized as `<scope-type>:<canonical-id>`;
- `artifactKinds` contain only valid canonical kinds from valid artifact references;
- timestamp formatting must reuse the existing canonical timestamp owner;
- raw artifact metadata and evidence payloads are excluded.

```yaml
evidenceSnapshotDigest:
  algorithm: sha256
  canonicalInput:
    protocolVersion: aiqt-evidence-snapshot@1
    target:
      type: project | work_unit | checkpoint
      id: canonical_id
    entries: sorted_NormalizedEvidenceSnapshotEntry_array
```

#### 5.7.2 Simulation digest

Rule results are normalized before hashing:

- sort rule results lexicographically by `ruleId`;
- sort and deduplicate `matchedEvidenceRefs`;
- use fixed enum values and integer counts;
- exclude human-readable `summary`;
- exclude `generatedAt`.

```yaml
simulationDigest:
  algorithm: sha256
  canonicalInput:
    protocolVersion: aiqt-evidence-gate-simulation-digest@1
    policyDigest: sha256
    target:
      type: project | work_unit | checkpoint
      id: canonical_id
    asOf: canonical_UTC_timestamp
    evidenceSnapshotDigest: sha256
    ruleResults: sorted_normalized_rule_results
```

Same policy, target, relevant canonical evidence state, and `asOf` must produce byte-identical canonical input and the same digest across supported platforms.


### 5.8 Export

`--output` writes a non-canonical report after successful evaluation.

Simulation:

- never writes canonical state;
- never appends runlog events;
- never creates issues;
- uses the same model for JSON and file output.

Export failure does not mutate canonical state or runlog.

---

## 6. Read-Only Visibility

Status may add this summary only when policy configuration exists:

```yaml
evidenceGate:
  activePolicy:
    policyId: string
    version: integer
  simulationEnforced: false
  checkpointAdvisoryIntegrated: false
```

Rules:

- status does not simulate implicitly;
- review creates no evidence-gate finding in M28;
- manage recommendations do not change;
- checkpoint output does not include simulation;
- `next` remains unchanged;
- no policy preserves legacy output.

---

## 7. Compatibility and Security

Preserve:

- M22 evidence trust and review;
- M23 import identity and normalization;
- M24 work graph;
- M25 workspace lifecycle;
- corrected M26 safeguards;
- M27R generic execution and self-reported validation;
- historical projects without policies;
- schema `0.5.0` unless explicitly approved otherwise.

M28 adds zero:

- process, shell, terminal, or PTY execution;
- Git or validation execution;
- network or provider SDK;
- agent/provider coupling;
- dynamic policy/plugin loading;
- filesystem evidence inspection;
- background scheduling;
- automatic issues;
- workflow blocking.

All strings are data only. Unknown fields are rejected.

---

## 8. Exit-Code Contract

| Condition | Exit | Mutation |
|---|---:|---|
| Policy import or activation succeeds | 0 | Yes |
| Preview succeeds | 0 | No |
| Identical import or already-active activation | 0 | No |
| List/show succeeds | 0 | No |
| Simulation result is pass/fail/indeterminate | 0 | No |
| Existing review findings outside simulation | 1 | No |
| No active/selected policy | 2 | No |
| Configuration limit reached | 2 | No |
| Valid target currently unavailable under existing lifecycle | 2 | No |
| Malformed policy, invalid version, digest conflict, unknown kind, invalid trust | 3 | No |
| Missing/broken target reference | 3 | No |
| Both or neither import transports | 3 | No |
| More than one simulation target | 3 | No |
| Invalid `--as-of` | 3 | No |
| Policy state succeeds but runlog append fails | 3 | State remains authoritative |
| Required input absent | 10 | No |

Simulation outcome is data. `fail` and `indeterminate` return `0`.

---

## 9. Work Units

### WU28-01 — Gate H and Evidence-Semantics Audit

- verify baseline and owners;
- document actual evidence kinds, trust, scope, timestamps, and references;
- confirm additive configuration owner;
- calculate entry risk.

Tag:

```text
m28-wu01-gate-evidence-audit
```

### WU28-02 — Policy Contracts and Management

- policy/rule schemas;
- identity, versioning, digest, limits, and configuration;
- import/list/show/activate;
- preview, replay, runlog ordering, compatibility.

Tag:

```text
m28-wu02-policy-management
```

### WU28-03 — Deterministic Simulation Engine

- target resolution;
- evidence selection;
- trust, scope, count, freshness, applicability;
- outcomes;
- snapshot/simulation digests.

Tag:

```text
m28-wu03-simulation-engine
```

### WU28-04 — Simulation CLI and Export

- project/Work Unit/checkpoint commands;
- policy selection;
- `--as-of`;
- JSON/file export;
- no-policy and invalid-target handling.

Tag:

```text
m28-wu04-simulation-cli
```

### WU28-05 — Compatibility, Security, and Failure Hardening

- M22–M27R regressions;
- trust non-elevation;
- validation-claim exclusion;
- malformed policies and broken references;
- caps, failure injection, determinism;
- no-execution/no-enforcement scans.

Tag:

```text
m28-wu05-simulation-hardening
```

### WU28-06 — Full Validation and Closure

- clean clone and frozen install;
- policy import/activation;
- project, Work Unit, checkpoint simulations;
- all outcomes;
- deterministic repeat/export;
- real CI, versioning, risk reconciliation, Gate I.

Tag:

```text
m28-wu06-final-validation
```

Each Work Unit requires:

- bounded implementation;
- focused tests;
- relevant validation;
- one detailed commit;
- one annotated tag;
- `Risk: N/100` in the commit body;
- structured report.

Continue automatically. Do not combine Work Units without approval.

Preferred milestone tag:

```text
m28-evidence-gate-simulation
```

---

## 10. Validation Requirements

Cover:

1. policy schema, identity, versioning, digest, replay, activation, limits;
2. canonical `ArtifactReference.kind` and trust-owner reuse;
3. all target types;
4. exact and inherited scope;
5. trust/count/freshness;
6. all outcomes and zero-applicable behavior;
7. deterministic M23-canonicalized snapshot/simulation digests across insertion orders and supported platforms;
8. invalid/broken references;
9. exclusion of M27R validation claims, commit refs, rollback claims, review findings;
10. exit `0` for all simulation outcomes;
11. zero simulation state/runlog mutation;
12. policy state/runlog failure injection and replay;
13. export failure isolation;
14. raw-evidence non-persistence;
15. no implicit simulation in status/review/manage/checkpoint/next;
16. M22–M27R compatibility and no-policy behavior;
17. zero process, shell, Git, validation, network, provider, agent, dynamic-policy, scheduler, issue-creation, and workflow-blocking surfaces;
18. clean clone, typecheck, lint, full tests, build, coverage, version checks, disposable lifecycle, and real CI.

Assert every exit code.

---

## 11. Risk Register

M28 uses:

```text
inherent =
  round((probability_weight × impact_weight / 12) × 100)
```

```yaml
probability:
  low: 1
  medium: 2
  high: 3

impact:
  low: 1
  medium: 2
  high: 3
  critical: 4
```

| ID | Hazard | Probability | Impact | Inherent | Control | Controlled | Entry | Residual |
|---|---|---|---|---:|---|---:|---:|---:|
| M28-R01 | Simulation mutates or blocks workflow | High | Critical | 100 | read-only engine; no owner integration | 25 | 25 | 8 |
| M28-R02 | Trust threshold is wrong or elevated | High | Critical | 100 | canonical trust owner; ordinal tests | 25 | 25 | 10 |
| M28-R03 | Wrong target/project evidence satisfies a rule | High | High | 75 | canonical scope resolution | 25 | 25 | 10 |
| M28-R04 | Freshness is nondeterministic | Medium | High | 50 | explicit `--as-of`; canonical timestamp | 17 | 17 | 8 |
| M28-R05 | Policy language becomes executable | Medium | Critical | 67 | fixed declarative schema | 17 | 17 | 5 |
| M28-R06 | Validation claims or commit refs count as evidence | High | High | 75 | evidence-record owner only | 25 | 25 | 8 |
| M28-R07 | Broken evidence references satisfy a rule | High | High | 75 | reference validation | 25 | 25 | 10 |
| M28-R08 | Policy replay/version collision corrupts state | Medium | High | 50 | immutable identity and digest | 17 | 17 | 8 |
| M28-R09 | Activation evaluates or enforces | Medium | Critical | 67 | pointer-only activation | 17 | 17 | 5 |
| M28-R10 | Output leaks raw evidence/secrets | Medium | Critical | 67 | references/counts only | 17 | 17 | 8 |
| M28-R11 | Overall aggregation is ambiguous | High | High | 75 | exact outcome table | 25 | 25 | 10 |
| M28-R12 | Same logical inputs produce different digests across insertion order or platform | Medium | High | 50 | M23 canonical JSON; exact normalized snapshot entries; explicit sort keys and `asOf` | 17 | 17 | 8 |
| M28-R13 | Policy/result state grows unbounded | Medium | High | 50 | bounded history; results non-canonical | 17 | 17 | 8 |
| M28-R14 | M22/M23 evidence semantics regress | Medium | High | 50 | owner reuse and regressions | 25 | 25 | 10 |
| M28-R15 | M25–M27R behavior regresses | Medium | High | 50 | no workflow-owner integration | 17 | 17 | 8 |
| M28-R16 | Runlog failure breaks policy replay | Medium | High | 50 | state authority; failure injection | 25 | 25 | 10 |
| M28-R17 | Heuristic target association is used | Medium | High | 50 | canonical relationships only | 17 | 17 | 8 |
| M28-R18 | M28 implements M29/M30 behavior | Medium | Critical | 67 | scans; no checkpoint changes | 17 | 17 | 5 |
| M28-R19 | Artifact-reference kinds are mistaken for a nonexistent evidence-record taxonomy | High | High | 75 | Gate H owner verification; `artifactKinds` only; no top-level kind inference | 25 | 25 | 10 |
| M28-R20 | Fail/indeterminate is treated as CLI failure | Medium | Medium | 33 | exit contract | 17 | 17 | 5 |

```text
inherentRiskMaximum = 100
controlledDesignRisk = 25
implementationEntryRisk <= 25
mergeResidualRisk <= 10
```

Work Unit scores do not replace hazard reconciliation.

---

## 12. Definition of Done

M28 is complete only when:

- Gate H passes;
- M22/M23 evidence semantics, including canonical `ArtifactReference.kind`, are documented and reused;
- policies are versioned, bounded, replay-safe, and activatable;
- all target types simulate correctly;
- all outcomes are deterministic;
- trust, scope, count, and freshness follow the contract;
- identical logical inputs produce identical M23-canonicalized digests across insertion orders and supported platforms;
- simulations never enter canonical state or runlog;
- all simulation outcomes exit `0`;
- no result blocks or changes workflow;
- M27R validation claims and non-evidence refs never count;
- no raw evidence content is persisted/exported;
- policy language cannot execute;
- status does not simulate implicitly;
- review, manage, checkpoint, next, workspace, packet, and execution remain unchanged;
- historical projects remain compatible;
- schema stays `0.5.0` unless approved otherwise;
- all six Work Units are committed, tagged, validated, and risk-scored;
- clean clone and real CI pass;
- final residual risk is at most `10`;
- Gate I opens;
- M29 and M30 were not started.

---

## 13. Review Questions and Approval Threshold

1. Is M28 simulation-only?
2. Does activation change only an active reference?
3. Are policy versions immutable and replay-safe?
4. Does the rule schema use only confirmed `ArtifactReference.kind` values and canonical trust?
5. Are executable policy surfaces absent?
6. Are all target types explicit?
7. Does scope use canonical relationships only?
8. Is trust compared through the canonical order?
9. Are validation claims and commit refs excluded?
10. Is freshness deterministic?
11. Are future-dated records excluded?
12. Are all outcomes unambiguous?
13. Does zero applicable rules produce indeterminate?
14. Do fail/indeterminate return exit `0`?
15. Are matched refs bounded and raw-content-free?
16. Are digests produced through the M23 canonical-JSON owner with explicit entry and rule-result sorting?
17. Are simulation results never canonical?
18. Does simulation append zero runlog events?
19. Does status avoid implicit simulation?
20. Are workflow owners unchanged?
21. Are limits explicit?
22. Is policy runlog failure tested?
23. Are historical fixtures green?
24. Is schema `0.5.0` preserved?
25. Is residual risk at most `10`?
26. Does Gate I open without M29/M30?

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  controlled_design_risk_maximum: 25
  implementation_entry_risk_maximum: 25
  merge_residual_risk_maximum: 10
  simulation_workflow_mutation_paths: 0
  simulation_runlog_append_paths: 0
  policy_activation_evaluation_paths: 0
  automatic_issue_creation_paths: 0
  checkpoint_advisory_integration_paths: 0
  evidence_enforcement_paths: 0
  executable_policy_surfaces: 0
  dynamic_policy_loading_surfaces: 0
  top_level_evidence_kind_assumptions: 0
  alternate_canonical_JSON_implementations: 0
  raw_evidence_payload_export_paths: 0
  validation_claim_to_evidence_paths: 0
  heuristic_scope_matching_paths: 0
  simulation_nonzero_outcome_exit_codes: 0
  historical_M22_M27R_regressions: 0
  M29_implementation_surfaces: 0
  M30_implementation_surfaces: 0
```

---

## 14. Gate I Handoff

```yaml
gate_i_handoff:
  evidence_policy_protocol: aiqt-evidence-gate-policy@1
  simulation_protocol: aiqt-evidence-gate-simulation@1
  simulation_enforced: false
  active_policy_supported: true
  checkpoint_advisory_integration: false
  required_evidence_enforcement: false
  workflow_completion_authority: checkpoint
  next_milestone:
    id: M29
    title: Advisory Checkpoint Evidence Integration
```

M28 must not implement M29 or M30.
