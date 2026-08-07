# AIQT Milestone 23 Build Specification v0.2

## External Evidence Import and Normalization

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Revised review candidate before build handoff
  milestone:
    id: M23
    title: External Evidence Import and Normalization
  baseline:
    product_version: 0.9.0
    product_release_tag: v0.9.0
    technical_closure_commit: 309a039
    development_baseline_commit: 376fcf8
    milestone_tag: m22-independent-review-evidence-contracts
    test_count: 1353
    schema_version: 0.5.0
    open_critical_high_dependency_alerts: 0
    gate_c_status: open
    verification_required: true
  aligns_with:
    - AIQT Post-M20 Proposed Milestones Roadmap v0.4
    - AIQT Milestone 22 Build Specification v0.2
    - M22 technical and governance closure reports
    - current repository schemas, evidence services, issue routing, lifecycle overlays, atomic-write services, and output conventions
  primary_agent_target: Claude Code, Codex, or equivalent coding agent
  architecture_role: local workflow control plane
  risk:
    inherent: 50
    controlled_design_target: 33
    implementation_entry_target: 33
    merge_residual_target: 15
```

---

## 0. Document Position

M22 established the canonical internal contracts for:

- `EvidenceRecord`;
- evidence provenance and trust;
- workflow/root/code-state binding;
- `SourceFinding`;
- `ProjectIssue`;
- CheckpointIssue-to-ProjectIssue transitions;
- decision escalations;
- deterministic issue routing;
- candidate-state validation and atomic persistence.

M23 adds the first controlled ingress boundary for external evidence.

Its responsibility is:

```text
external JSON payload
→ strict format adapter
→ normalized evidence candidate
→ M22 binding/routing/classification services
→ preview or atomic canonical mutation
```

M23 is not an execution milestone.

It must not:

- run validation commands;
- call CI systems;
- fetch provider APIs;
- spawn coding agents;
- inspect remote platforms;
- download artifacts;
- load dynamic plugins;
- infer platform verification from user-supplied JSON;
- enforce required evidence;
- alter checkpoint readiness.

The canonical architecture remains:

```text
M22 owns canonical evidence and issue semantics.
M23 owns bounded external JSON ingestion and normalization.
Future milestones may add provider-specific acquisition or enforcement.
```

AIQT is the product being developed. M23 must be managed through repository specifications, Git, tests, CI, commits, tags, and implementation reports. The AIQT CLI must not initialize or manage `.aiqt/` state for its own implementation.

### 0.1 Gate and Work Unit governance

Gate C is a read-only pre-build gate, not an implementation Work Unit.

Therefore:

- Gate C must produce a structured report;
- Gate C must not create an empty commit;
- Gate C must not receive a Work Unit tag;
- all numbered M23 Work Units are expected to create repository changes, commits, and tags;
- if a numbered Work Unit becomes read-only after repository inspection, it must be merged into the nearest related mutating Work Unit or receive an explicit waiver before closure.

This rule prevents the governance ambiguity encountered during M22 closure.

### 0.2 v0.2 Change Summary

v0.2 resolves the two findings from the v0.1 technical review:

1. `generic-ci-json@1` now defines one deterministic, conservative status-reconciliation algorithm for top-level run status and check-level status. Contradictory claims do not pass silently.
2. M23 now explicitly owns external import identity and conflict semantics. M22 remains the owner of canonical evidence persistence, issue identity, routing, lifecycle, promotion, and atomic mutation, but it is not assumed to own `externalId` uniqueness.

No milestone scope, trust ceiling, execution boundary, risk threshold, or required-evidence semantics changed.

---

## 1. Objective

M23 must prove that AIQT can:

1. accept one bounded external JSON payload from an explicit file or standard input;
2. identify its declared adapter format deterministically;
3. validate it without accepting arbitrary provider-specific structures;
4. normalize it into M22-owned canonical evidence candidates;
5. assign canonical provenance and trust without trusting source-authored authority claims;
6. evaluate workflow, implementation-root, and code-state binding;
7. route normalized findings through the existing M22 F-06 service;
8. preview the complete proposed mutation without changing state or runlog;
9. atomically record valid evidence and resulting issue relationships;
10. replay the same logical payload idempotently;
11. reject malformed, oversized, unsupported, mismatched, or unsafe payloads without partial mutation;
12. preserve all historical project/state compatibility;
13. remain local, provider-neutral, static, and non-executable.

---

## 2. Supported Import Formats

M23 supports exactly three compile-time adapters:

```yaml
supported_formats:
  - generic-evidence-json@1
  - generic-ci-json@1
  - manual-evidence-json@1
```

Rules:

- the payload declares its format through a required top-level `format` field;
- the adapter registry is a static compile-time map;
- unknown formats are invalid input;
- adapter discovery through filesystem scanning, package loading, dynamic imports, environment variables, or executable plugins is prohibited;
- M23 supports exact `@1` contracts only;
- future major versions require a later reviewed milestone;
- raw external payloads are never stored in canonical state or runlog.

The names are generic interchange formats. They must not encode GitHub Actions, GitLab, Azure DevOps, CircleCI, Jenkins, Claude, Codex, or any other named provider into canonical state semantics.

---

## 3. Gate C — Mandatory Pre-Build Verification

No implementation begins until a read-only Gate C report verifies the real repository.

```yaml
gate_c_report:
  repository:
    branch: required
    clean_status: required
    origin_sync: required
    head_commit: required
    package_version: required
    release_tag: required
    m22_tag: required
    test_count: required
    dependency_alerts: required
  m22_contracts:
    EvidenceRecord_schema: required
    ArtifactReference_schema: required
    SourceFinding_schema: required
    ProjectIssue_schema: required
    ProjectIssueTransition_schema: required
    DecisionEscalation_schema: required
    trust_ordering_owner: required
    binding_evaluator: required
    finding_fingerprint_owner: required
    issue_key_owner: required
    canonical_evidence_identity_owner: required
    F06_routing_owner: required
    candidate_state_services: required
    evidence_lookup_and_linking_capabilities: required
    effective_lifecycle_owner: required
    promotion_deduplication_owner: required
  persistence:
    state_owner: required
    runlog_owner: required
    atomic_write_owner: required
    id_allocator: required
    state_growth_limits: required
  cli:
    command_registration_owner: required
    file_and_stdin_input_conventions: required
    json_output_owner: required
    exit_code_owner: required
    error_envelope_owner: required
  compatibility:
    historical_fixture_matrix: required
    schema_version: required
    read_only_non_materialization: required
  security:
    process_execution_surface_added: false
    network_surface_added: false
    plugin_surface_added: false
    raw_payload_persistence_added: false
  risk:
    recalculated_entry_risk: required
```

Expected baseline:

```yaml
expected_gate_c_baseline:
  branch: main
  package_version: 0.9.0
  product_release_tag: v0.9.0
  development_commit: 376fcf8
  tests: 1353
  schema_version: 0.5.0
  critical_high_dependency_alerts: 0
```

If repository reality differs, report the actual state and determine whether it blocks M23. Do not move tags, rewrite history, or adjust the specification silently.

### 3.1 Gate C approval

```text
implementationEntryRisk =
  max(current score of every open M23 hazard after Gate C controls)
```

Implementation may begin only when:

```text
implementationEntryRisk <= 33
```

Any unresolved contradiction in M22 ownership, adapter boundaries, state atomicity, or lifecycle routing blocks implementation.

---

## 4. Public CLI Contract

M23 adds one public command:

```text
aiqt evidence import
```

### 4.1 Input modes

Exactly one input mode is required:

```text
aiqt evidence import --from-file <path>
aiqt evidence import --stdin
```

Optional flags:

```text
--preview
--json
```

Rules:

- `--from-file` and `--stdin` are mutually exclusive;
- neither input mode → exit `10`;
- both input modes → exit `3`;
- the payload's top-level `format` selects the adapter;
- the command must not infer a format from filename or provider name;
- `--preview` performs the full parse, normalization, binding, routing, deduplication, limit, and candidate-state validation pipeline without writing state or runlog;
- `--json` uses the repository's established structured output conventions;
- no interactive questionnaire is added;
- no URL input is accepted;
- no directory or glob import is accepted;
- no batch-directory scanning is added.

### 4.2 File input

`--from-file` must:

- resolve the explicit path;
- require an existing regular file;
- reject directories;
- reject socket/device/pipe inputs;
- enforce the input byte cap before parsing;
- read once;
- not persist the source file path;
- not copy the source payload into `.aiqt/`;
- not follow artifact locators found in the payload.

A symlink may be accepted only when its resolved target is a regular file. The command must report that a symlink was resolved without persisting the absolute target path.

### 4.3 Standard input

`--stdin` must:

- read at most the same byte cap as file input;
- terminate deterministically at EOF;
- reject empty or whitespace-only content;
- avoid echoing the payload on error;
- never place the raw payload in logs or runlog events.

### 4.4 Input size

```yaml
external_input_limits:
  max_payload_bytes: 1048576
  max_json_nesting_depth: 20
  max_top_level_keys: 32
```

Oversized or excessively nested input is invalid input with no mutation.

---

## 5. Import Envelope and Internal Normalization DTO

Every supported payload contains:

```yaml
ExternalEvidenceEnvelope:
  format: supported_format
  externalId: optional_bounded_string
  source: format_specific_source
  binding: format_specific_binding
  results: format_specific_results
  findings: optional_bounded_array
  artifacts: optional_bounded_array
  decisionEscalations: optional_bounded_array
```

Adapters must output one internal DTO:

```yaml
NormalizedEvidenceCandidate:
  adapterId: supported_format
  sourcePayloadDigest: sha256_of_canonical_parsed_payload
  externalEvidenceId: optional_bounded_string
  provider:
    providerId: required
    providerType: M22_provider_type
    trustLevel: M22_canonical_trust_level
  workflowBinding: M22_workflow_binding
  codeBinding: M22_code_binding
  reviewer: M22_reviewer
  results: M22_results
  summary: bounded_non_empty_string
  sourceFindings: bounded_array_of_M22_SourceFinding
  artifactReferences: bounded_array_of_M22_ArtifactReference
  decisionEscalationCandidates: bounded_array
  capturedAt: required_timestamp
```

`NormalizedEvidenceCandidate` is an internal transport object. It is not a second canonical evidence schema.

M23 may add an optional additive provenance object to `EvidenceRecord` only if Gate C proves M22 lacks a safe place for import provenance:

```yaml
ImportProvenance:
  adapterId: supported_format
  sourcePayloadDigest: sha256
  externalEvidenceId: optional
  importIdentityKey: deterministic_sha256
  importedAt: timestamp
```

Rules:

- the provenance addition must be optional;
- `importIdentityKey` is defined by M23 §6.1 and is not an M22 issue key;
- no schema-version bump is expected;
- the raw payload, filename, stdin contents, absolute path, or provider response body must not be persisted;
- if M22 already represents these facts safely, reuse the existing fields and do not add duplicate state;
- M22 remains the owner of canonical `EvidenceRecord` persistence and IDs;
- M23 owns the derivation and uniqueness rules for external import identity.

---

## 6. Canonical Payload Digest

M23 must calculate a deterministic SHA-256 digest over the parsed logical payload.

Canonicalization rules:

1. parse one JSON document;
2. reject non-object top-level values;
3. recursively sort object keys lexicographically;
4. preserve array order;
5. preserve JSON string values exactly after JSON decoding;
6. serialize with no insignificant whitespace;
7. hash UTF-8 bytes;
8. exclude no fields unless the adapter contract explicitly defines a non-semantic field;
9. apply the same algorithm in preview and mutation modes.

Consequences:

- whitespace and object-key ordering do not change the digest;
- array reordering changes the digest;
- source filenames do not affect the digest;
- the same logical payload imported from file and stdin has the same digest;
- digest collisions are treated as security defects, not normal deduplication conflicts.

The repository must use one shared canonical-JSON helper. Adapter-specific hashing is prohibited.

### 6.1 External import identity and conflict ownership

M23 is the first milestone in which `externalId` becomes operationally meaningful. Therefore, M23 owns the external import identity policy.

M22 continues to own:

- canonical `EvidenceRecord` persistence and validation;
- canonical evidence IDs through the established ID owner;
- finding fingerprints and issue keys;
- F-06 routing;
- lifecycle overlays;
- promotion deduplication;
- candidate-state atomicity.

M23 defines one `importIdentityKey`:

```yaml
import_identity:
  when_externalId_present:
    canonical_input:
      - adapterId
      - providerId
      - externalId
    meaning: one immutable externally identified evidence occurrence
  when_externalId_absent:
    canonical_input:
      - adapterId
      - providerId
      - sourcePayloadDigest
    meaning: one content-addressed evidence occurrence
  digest_algorithm: sha256
```

Canonical concatenation must use an unambiguous length-prefixed or canonical-JSON tuple representation. String concatenation with separators is insufficient unless escaping is formally defined and tested.

Rules:

1. `externalId` is scoped by both `adapterId` and normalized `providerId`.
2. Same `importIdentityKey` + same `sourcePayloadDigest` → `link_existing` or `no_op`.
3. Same `importIdentityKey` + different `sourcePayloadDigest` → deterministic conflict, exit `3`, no mutation.
4. Different non-empty external IDs + same payload digest → distinct EvidenceRecords because they represent distinct externally identified occurrences.
5. No external ID + same logical payload from file or stdin → the same content-addressed EvidenceRecord.
6. No external ID + changed logical payload → a distinct EvidenceRecord.
7. An existing EvidenceRecord is never overwritten to resolve an identity conflict.
8. M23 must use the M22 canonical evidence-ID and candidate-state owners after resolving the M23 import identity.
9. Import identity keys must never be reused as issue keys, transition keys, escalation keys, or repair-work keys.

The conflict rule is therefore defined by M23, not delegated to a presumed M22 `externalId` owner.

---

## 7. Adapter Contracts

### 7.1 `generic-evidence-json@1`

Purpose: import a generic machine- or human-produced evidence summary already shaped around the M22 concepts.

Conceptual payload:

```yaml
format: generic-evidence-json@1
externalId: optional
source:
  providerId: required
  providerType:
    - agent
    - repository
    - system
    - unknown
binding:
  workUnitId: required
  packetId: required
  checkpointId: optional
  implementationRootId: required
  branch: optional
  commitSha: optional
  repositoryFingerprint: optional
  workingTreeFingerprint: optional
  capturedAt: required
reviewer:
  reviewerId: optional
  reviewerType:
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
  summary: required
findings: optional
artifacts: optional
decisionEscalations: optional
```

Canonical trust assignment:

```yaml
generic-evidence-json@1:
  trustLevel: unverified
```

The payload cannot set or elevate canonical trust.

### 7.2 `generic-ci-json@1`

Purpose: import a generic CI/build/test result without naming or contacting a CI provider.

Conceptual payload:

```yaml
format: generic-ci-json@1
externalId: optional
source:
  providerId: required
  workflowName: optional
  jobName: optional
binding:
  workUnitId: required
  packetId: required
  checkpointId: optional
  implementationRootId: required
  branch: optional
  commitSha: required
  repositoryFingerprint: optional
run:
  status:
    - passed
    - failed
    - partial
    - cancelled
    - not_run
    - unknown
  startedAt: optional
  completedAt: required
  summary: required
checks:
  - checkId: required
    name: required
    status:
      - passed
      - failed
      - partial
      - cancelled
      - not_run
      - unknown
    summary: required
    durationMs: optional_non_negative_integer
    findings: optional
    artifacts: optional
```

Normalization rules:

- provider type becomes `ci`;
- reviewer type becomes `system`;
- independent context becomes `unknown`;
- `reviewResult` becomes `not_run`;
- `acceptanceCriteriaResult` becomes `not_checked`;
- adapter-generated findings use canonical source-severity claim `unknown` unless the source finding explicitly supplies a claim;
- check names and summaries remain bounded.

#### 7.2.1 Check-level aggregate

The adapter computes `checksAggregate` deterministically:

```yaml
checks_aggregate:
  failed:
    when: any check.status == failed
  partial:
    when: no failed check and any check.status in [partial, cancelled]
  passed:
    when: checks is non-empty and every check.status == passed
  not_run:
    when: checks is non-empty and every check.status == not_run
  unknown:
    when:
      - checks is empty
      - or no rule above applies
```

Any failed check produces one normalized finding when the payload did not already include a finding for that check.

#### 7.2.2 Run-level mapping

The declared `run.status` maps to an M22 validation result:

```yaml
run_status_mapping:
  passed: passed
  failed: failed
  partial: partial
  cancelled: partial
  not_run: not_run
  unknown: unknown
```

#### 7.2.3 Canonical reconciliation

Neither the top-level declaration nor the check array is trusted alone. The final `validationResult` is the conservative reconciliation of `mappedRunStatus` and `checksAggregate`:

```yaml
reconciliation:
  if_either_failed: failed
  else_if_either_partial: partial
  else_if_both_passed: passed
  else_if_both_not_run: not_run
  else: unknown
```

Examples:

| `run.status` | Checks | Final result |
|---|---|---|
| `passed` | all passed, non-empty | `passed` |
| `passed` | any failed | `failed` |
| `failed` | all passed | `failed` |
| `passed` | empty | `unknown` |
| `not_run` | all not-run | `not_run` |
| `cancelled` | all passed | `partial` |
| `unknown` | all passed | `unknown` |

When `mappedRunStatus != checksAggregate`, the adapter must:

- add one bounded normalization warning;
- create or reuse one adapter-generated SourceFinding with:
  - deterministic source finding ID;
  - title indicating CI aggregate inconsistency;
  - severity claim `unknown`;
  - fixability claim `external_verification`;
  - scope claim `execution_local`;
- continue import using the conservative final result;
- never normalize the contradiction to `passed`.

Internal inconsistency is advisory evidence, not an importer parse failure, unless the payload is structurally invalid.

Canonical trust assignment:

```yaml
generic-ci-json@1:
  trustLevel: self_reported
```

A JSON claim that a run occurred on a platform is not platform verification.

### 7.3 `manual-evidence-json@1`

Purpose: import a human-authored review or validation summary.

Conceptual payload:

```yaml
format: manual-evidence-json@1
externalId: optional
source:
  providerId: required
binding:
  workUnitId: required
  packetId: required
  checkpointId: optional
  implementationRootId: required
  branch: optional
  commitSha: optional
  capturedAt: required
reviewer:
  reviewerId: optional
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
  summary: required
findings: optional
artifacts: optional
decisionEscalations: optional
```

Normalization rules:

- provider type becomes `manual`;
- reviewer type becomes `human`;
- canonical trust becomes `self_reported`;
- reviewer independence is a declaration, not verified identity;
- no personal display name, email address, or free-form contact field is required or persisted;
- manual input cannot directly set canonical severity, lifecycle, repair eligibility, or workflow blocking.

---

## 8. Strict Parsing and Unknown Fields

All adapter schemas must follow the repository's established strictness policy.

Minimum requirements:

- unknown top-level fields are rejected;
- unknown nested fields are rejected unless the adapter contract explicitly defines an `extensions` field;
- M23 v0.1 defines no persisted extension bag;
- prohibited object keys are rejected recursively:

```text
__proto__
prototype
constructor
```

- empty required strings are invalid;
- timestamps must follow the repository's canonical timestamp rules;
- numbers must be finite and within declared ranges;
- duplicate logical IDs inside one payload are invalid;
- malformed JSON is invalid input;
- adapter validation errors must identify a bounded JSON path without echoing sensitive payload values.

M23 does not need to preserve unknown provider fields.

---

## 9. Trust and Authority Rules

Canonical trust is assigned by the adapter, not by the payload.

```yaml
adapter_trust:
  generic-evidence-json@1: unverified
  generic-ci-json@1: self_reported
  manual-evidence-json@1: self_reported
```

M23 cannot assign:

```text
repository_local
platform_verified
```

Those levels require future acquisition or verification mechanisms not present in this milestone.

Source-authored values remain claims only. An imported payload must not directly control:

- canonical issue severity;
- effective issue lifecycle;
- acceptance;
- deferment;
- resolution;
- post-MVP classification;
- promotion;
- repair eligibility;
- release classification;
- evidence requirement satisfaction;
- workflow blocking.

M23 must invoke the M22 centralized classification, lifecycle, routing, and promotion owners.

---

## 10. Binding Evaluation

The importer must invoke the M22 binding evaluator after normalization.

Possible results:

```text
current
stale
mismatched
unavailable
unknown
```

Behavior:

| Binding result | Import behavior | Exit | Mutation |
|---|---|---:|---|
| `current` | accept | 0 | preview or atomic mutation |
| `stale` | accept with warning | 0 | preview or atomic mutation |
| `unavailable` | accept with warning | 0 | preview or atomic mutation |
| `unknown` | accept with warning | 0 | preview or atomic mutation |
| `mismatched` | reject | 3 | none |

Rules:

- wrong work unit, packet, checkpoint, or implementation root is mismatched;
- missing canonical references are invalid input/state;
- a changed known commit or fingerprint is stale;
- absent binding data is unknown, not current;
- local inability to inspect repository facts is unavailable;
- M23 does not rewrite binding values to make them match;
- warning output must not imply that stale or unknown evidence is trusted.

---

## 11. Finding Normalization and F-06 Routing

Adapters normalize external findings into M22 `SourceFinding`.

For each finding, M23 must invoke the M22 services for:

1. source fingerprint;
2. canonical issue key;
3. canonical classification;
4. F-06 initial route;
5. existing issue lookup;
6. transition lookup;
7. promotion deduplication.

M23 must not reimplement these algorithms inside adapters or command handlers.

The invariant remains:

```text
one canonical condition
→ CheckpointIssue XOR ProjectIssue on initial route
```

Repeated import may:

- link new evidence to an existing CheckpointIssue;
- link new evidence to an existing ProjectIssue;
- cause one explicit CheckpointIssue-to-ProjectIssue transition when scope expands;
- reuse an existing transition;
- reuse an existing repair Work Unit.

It must not create duplicate issue identities, transitions, promotions, or repair Work Units.

---

## 12. Artifact Reference Normalization

M23 imports metadata references only.

Permitted locator forms:

```yaml
artifact_locator:
  repository_relative_path: allowed
  opaque_provider_reference: allowed
  https_url_without_userinfo_query_or_fragment: allowed
```

Rejected:

- inline base64 or binary content;
- `data:` URLs;
- URL user information;
- signed/tokenized query strings;
- URL fragments containing credentials or tokens;
- absolute local paths outside the implementation root;
- device paths;
- executable locator schemes;
- artifact bodies.

Absolute paths inside the implementation root must be normalized to repository-relative paths before persistence.

M23 does not:

- open artifact locators;
- verify artifact existence;
- hash artifact contents;
- download URLs;
- authenticate to providers.

A supplied digest is a source claim unless later verified by another milestone.

---

## 13. Decision Escalation Import

`generic-evidence-json@1` and `manual-evidence-json@1` may include decision escalation candidates.

Rules:

- candidates normalize into the M22 `DecisionEscalation` contract;
- deterministic escalation keys are computed through the M22 owner;
- repeated keys link to existing records;
- imported escalations remain advisory;
- importing an escalation does not block workflow;
- adapter source text cannot mark an escalation resolved;
- external payloads may propose an answer, but canonical resolution requires the existing trusted mutation path;
- `generic-ci-json@1` cannot create decision escalations in M23.

---

## 14. Preview Contract

`--preview` performs the full pipeline:

```text
read
→ parse
→ adapter validate
→ normalize
→ canonical digest
→ binding evaluate
→ findings fingerprint/classify/route
→ deduplicate
→ build candidate state
→ validate limits/references
→ render proposed result
```

It must not:

- write state;
- append runlog;
- create files;
- alter timestamps in canonical state;
- reserve IDs permanently;
- invoke providers;
- execute commands.

Preview output must include:

```yaml
evidence_import_preview:
  status: passed_or_failed
  adapterId: required
  sourcePayloadDigest: required_on_valid_payload
  importIdentityKey: required_on_valid_payload
  identityMode:
    - external_id
    - content_addressed
  bindingStatus: required_on_valid_payload
  evidence:
    action:
      - create
      - link_existing
      - no_op
    evidenceId: required_when_resolved
  findings:
    checkpointIssuesToCreate: count
    checkpointIssuesToLink: count
    projectIssuesToCreate: count
    projectIssuesToLink: count
    transitionsToCreate: count
    transitionsToReuse: count
    repairWorkUnitsToReuse: count
  decisionEscalations:
    create: count
    link: count
  warnings: bounded_array
  wouldChangeState: boolean
  wouldAppendRunlogEvents: count
```

Preview and real mutation must produce the same deterministic action plan when state has not changed between runs.

---

## 15. Mutation, Idempotency, and Runlog

### 15.1 Candidate-state pipeline

A non-preview import must:

1. read canonical state;
2. parse and normalize the payload;
3. calculate the canonical source digest;
4. evaluate binding;
5. resolve all findings and escalations;
6. build one complete candidate state;
7. validate references, IDs, issue keys, transitions, caps, and record sizes;
8. calculate deterministic events;
9. atomically persist state;
10. append runlog using established recovery semantics;
11. return structured output.

Any failure before persistence causes no mutation.

### 15.2 Idempotency

Reimporting the same logical payload against unchanged state must:

- return success;
- resolve the same evidence identity;
- create no second EvidenceRecord;
- create no second issue;
- create no second transition;
- create no second escalation;
- create no second repair Work Unit;
- append no duplicate mutation events;
- report `no_op` or `link_existing` accurately.

Import identity follows M23 §6.1:

- same scoped external ID and same digest → link/no-op;
- same scoped external ID and different digest → exit `3`, no mutation;
- different non-empty external IDs and same digest → distinct evidence records;
- absent external ID and same digest → link/no-op across file and stdin;
- absent external ID and different digest → distinct evidence records.

No conflict may overwrite or silently mutate historical evidence.

### 15.3 Runlog

Prefer the M22 event owners.

M23 may add a compact command-level event only if repository evidence proves existing events cannot record adapter provenance safely:

```text
evidence.imported
```

Maximum event payload:

```yaml
event:
  adapterId: required
  sourcePayloadDigest: required
  evidenceId: required
  bindingStatus: required
  createdCounts: bounded_summary
  linkedCounts: bounded_summary
```

Never include:

- raw payload;
- source file path;
- artifact body;
- full findings;
- personal contact data;
- secrets.

No mutation event is appended for preview, rejected input, or true no-op.

---

## 16. Exit Codes and Error Taxonomy

```yaml
exit_codes:
  0: success_preview_no_op_or_advisory_warning
  1: reserved_for_existing_quality_or_review_failure_semantics
  2: reserved_for_existing_workflow_blocked_semantics
  3: invalid_input_invalid_state_mismatch_or_unsupported_format
  10: no_input_source_supplied
```

| Condition | Exit | Mutation |
|---|---:|---|
| Valid new import | 0 | atomic |
| Valid preview | 0 | none |
| Duplicate/no-op import | 0 | none |
| Stale/unavailable/unknown binding | 0 with warning | requested preview or mutation |
| No `--from-file` or `--stdin` | 10 | none |
| Both input modes | 3 | none |
| Unsupported format | 3 | none |
| Malformed JSON | 3 | none |
| Empty input | 3 | none |
| Oversized/deep payload | 3 | none |
| Unknown/prohibited field | 3 | none |
| Broken reference | 3 | none |
| Mismatched binding | 3 | none |
| Duplicate logical ID in payload | 3 | none |
| Scoped external-ID/digest conflict under §6.1 | 3 | none |
| State-growth cap exceeded | 3 | none |
| Artifact locator unsafe | 3 | none |
| Raw payload contains unsupported inline artifact | 3 | none |

A failed validation result inside imported evidence is advisory data. It does not make the import command exit `1`.

---

## 17. Compatibility Contract

M23 must preserve:

- all historical pre-M22 state fixtures;
- M22 state without import provenance or import identity keys;
- state without `issues`;
- state without `evidence`;
- state with overrides/promotions only;
- state with CheckpointIssues;
- state with ProjectIssues and transitions;
- state with checkpoint amendments;
- effective-readiness behavior;
- `status`, `next`, `manage`, `review`, and export behavior unless the command explicitly imports evidence;
- AIQT schema version `0.5.0`, unless Gate C proves an additive change cannot be represented safely.

Read-only commands must not materialize:

- import provenance;
- adapter state;
- default evidence arrays;
- new runlog events.

No external payload path may become part of canonical state identity.

---

## 18. Security Boundary

M23 is a local data-ingestion feature, not an execution surface.

The implementation must add no:

- `child_process`;
- shell command;
- arbitrary executable path;
- network client;
- HTTP fetch;
- provider SDK;
- webhook listener;
- dynamic package import;
- plugin registry loaded from disk;
- `eval`;
- `Function` constructor;
- artifact downloader;
- archive extraction;
- binary parser;
- YAML/XML parser;
- recursive directory scanner.

Additional controls:

- input byte cap before parse;
- strict JSON only;
- recursive prohibited-key rejection;
- bounded error paths;
- no sensitive value echo;
- canonical digest;
- no raw payload persistence;
- atomic state mutation;
- explicit source mode;
- deterministic adapter registry.

---

## 19. Repository Implementation Areas

Exact paths must be confirmed during Gate C.

Expected areas:

```text
src/schema/
  external-evidence/
    generic-evidence-v1.schema.ts
    generic-ci-v1.schema.ts
    manual-evidence-v1.schema.ts
    normalized-evidence-candidate.schema.ts

src/evidence/ or current M22 evidence owner
  adapter-registry.ts
  generic-evidence-v1.adapter.ts
  generic-ci-v1.adapter.ts
  manual-evidence-v1.adapter.ts
  canonical-json.ts
  import-normalization.ts
  artifact-locator-normalization.ts
  evidence-import-service.ts

src/commands/
  evidence-import.ts

src/cli/
  command registration only through existing owner

tests/unit/
tests/integration/
tests/fixtures/evidence-import/
```

Do not create duplicate:

- M22 evidence schema;
- issue router;
- issue classifier;
- lifecycle resolver;
- promotion service;
- atomic writer;
- runlog writer;
- output envelope;
- exit-code mapping.

---

## 20. Testing Contract

### 20.1 Adapter schema fixtures

For every format:

- minimal valid payload;
- full valid payload;
- omitted optionals;
- invalid format;
- unknown field;
- prohibited object key;
- invalid enum;
- invalid timestamp;
- empty required string;
- duplicate logical ID;
- oversized string;
- too many findings;
- too many artifacts;
- excessive nesting;
- non-object top level.

### 20.2 Canonical digest and import identity

Test:

- object-key reordering produces the same digest;
- whitespace changes produce the same digest;
- file and stdin produce the same digest;
- array reordering changes the digest;
- changed semantic field changes the digest;
- UTF-8 strings are deterministic;
- digest does not include source filename;
- preview and mutation calculate the same digest;
- same scoped external ID and same digest resolves the same identity;
- same scoped external ID and different digest conflicts;
- same external ID under different provider IDs does not collide;
- different external IDs with the same digest remain distinct;
- missing external ID deduplicates the same payload across file and stdin;
- tuple encoding prevents delimiter/concatenation ambiguity.

### 20.3 Generic evidence adapter

Test:

- exact mapping to M22 fields;
- canonical trust `unverified`;
- source trust cannot be supplied;
- source severity/fixability remain claims;
- decision escalation candidates;
- artifacts;
- missing optional code binding;
- all result states.

### 20.4 Generic CI adapter

Test:

- all passed checks;
- failed check;
- partial mix;
- cancelled run;
- empty checks;
- all checks `not_run`;
- unknown/check-status mixtures;
- top-level passed with failed check → failed;
- top-level failed with all checks passed → failed;
- top-level passed with empty checks → unknown;
- run/check disagreement warning;
- deterministic aggregate-inconsistency finding;
- automatic finding for failed check;
- explicit finding reuse;
- conservative validation-result reconciliation;
- acceptance criteria always `not_checked`;
- canonical trust `self_reported`;
- platform verification never inferred;
- safe artifact locators.

### 20.5 Manual adapter

Test:

- human reviewer normalization;
- independent declaration values;
- canonical trust `self_reported`;
- no personal contact requirement;
- escalation candidates;
- source claims remain non-authoritative.

### 20.6 CLI input

Test:

- file input;
- stdin input;
- neither;
- both;
- missing file;
- directory;
- symlink to regular file;
- empty input;
- malformed JSON;
- input byte cap;
- preview;
- JSON output;
- no raw payload in errors.

### 20.7 Binding

Test all M22 states:

```text
current
stale
mismatched
unavailable
unknown
```

Confirm mismatched rejects and the other non-current states produce advisory output.

### 20.8 Routing and deduplication

Test:

- every F-06 route through imported payloads;
- no dual creation;
- link existing CheckpointIssue;
- link existing ProjectIssue;
- create transition;
- reuse transition;
- reuse repair Work Unit;
- repeated identical import;
- same logical payload from file and stdin;
- same scoped external ID with conflicting digest;
- same external ID under different provider IDs;
- different non-empty external IDs with the same logical digest;
- absent external ID with same digest across file/stdin.

### 20.9 Preview equivalence

Given unchanged state:

- preview action plan equals mutation action plan;
- IDs match;
- counts match;
- warnings match;
- preview changes no files;
- preview appends no runlog.

### 20.10 Atomicity and failure injection

Test:

- parse failure;
- adapter failure;
- reference failure;
- binding mismatch;
- cap failure;
- candidate-state failure;
- state write failure;
- runlog failure under repository recovery conventions;
- no partial state;
- no partial events.

### 20.11 Artifact safety

Test:

- relative path accepted;
- in-root absolute path normalized;
- outside-root absolute path rejected;
- opaque reference accepted;
- clean HTTPS URL accepted;
- URL userinfo rejected;
- URL query rejected;
- URL fragment rejected;
- `data:` rejected;
- base64 payload rejected;
- artifact never fetched/opened.

### 20.12 Historical compatibility

Re-run the complete M22 governance compatibility matrix plus:

- state with imported provenance;
- state without imported provenance;
- status/manage/navigation with imported evidence;
- old states remain byte-identical after read-only commands;
- no schema-version bump.

### 20.13 Execution-boundary tests

Prove:

- no network calls;
- no child process;
- no dynamic plugin loading;
- no artifact fetching;
- no provider-specific SDK;
- no directory scanning.

### 20.14 Clean-environment validation

From a disposable clean clone:

1. install the exact package manager;
2. use the frozen lockfile;
3. run typecheck;
4. run lint;
5. run the full suite;
6. run build;
7. run coverage;
8. run local and base-comparison version checks;
9. run representative file/stdin preview imports;
10. run representative committed imports in disposable AIQT project fixtures;
11. verify real CI on all supported Node versions.

All process exit codes must be checked explicitly.

---

## 21. Work Units

### WU23-01 — Import Envelope, Limits, and Static Adapter Registry

Objective: define the external envelope, exact supported format IDs, static registry, input caps, strict parsing conventions, and normalized candidate DTO.

Acceptance:

- exact three-format registry;
- no dynamic loading;
- strict schemas;
- canonical limits;
- no raw payload persistence;
- unit fixtures green.

Suggested tag:

```text
m23-wu01-import-envelope-registry
```

### WU23-02 — Canonical JSON, Import Identity, and Provenance

Objective: implement shared canonical JSON, SHA-256 payload digest, M23-owned `importIdentityKey`, conflict semantics, and the smallest additive import-provenance representation justified by Gate C.

Acceptance:

- stable digest fixtures;
- stable length-safe identity-key fixtures;
- external-ID scoping by adapter and provider;
- same identity/different digest rejects without mutation;
- absent external ID deduplicates by content across file and stdin;
- different external IDs may represent distinct occurrences even with identical content;
- no filename dependency;
- no duplicate provenance model;
- historical M22 evidence remains valid;
- no schema-version bump unless explicitly approved.

Suggested tag:

```text
m23-wu02-canonical-json-provenance
```

### WU23-03 — Generic Evidence Adapter

Objective: implement `generic-evidence-json@1`.

Acceptance:

- complete mapping;
- trust fixed to `unverified`;
- no canonical authority from source claims;
- artifacts and escalation candidates normalized;
- adapter fixtures green.

Suggested tag:

```text
m23-wu03-generic-evidence-adapter
```

### WU23-04 — Generic CI Adapter

Objective: implement `generic-ci-json@1`.

Acceptance:

- deterministic check aggregation;
- automatic failed-check findings;
- trust fixed to `self_reported`;
- no platform verification;
- no provider-specific semantics.

Suggested tag:

```text
m23-wu04-generic-ci-adapter
```

### WU23-05 — Manual Evidence Adapter

Objective: implement `manual-evidence-json@1`.

Acceptance:

- human/manual provenance;
- independence remains declared;
- no personal contact requirement;
- trust fixed to `self_reported`;
- decision escalations remain advisory.

Suggested tag:

```text
m23-wu05-manual-evidence-adapter
```

### WU23-06 — Import Normalization, Binding, and M22 Routing Integration

Objective: connect adapter output to M22 binding, fingerprint, classification, F-06 routing, transition, escalation, and promotion-deduplication owners.

Acceptance:

- no duplicated M22 algorithms;
- all binding states;
- no-dual-creation;
- transition replay;
- repair Work Unit reuse;
- source claims remain non-authoritative.

Suggested tag:

```text
m23-wu06-normalization-routing
```

### WU23-07 — `aiqt evidence import` and Preview

Objective: add file/stdin command handling, preview, structured output, and exit-code behavior.

Acceptance:

- exactly one input source;
- full preview pipeline;
- no preview mutation;
- bounded safe errors;
- deterministic human and JSON output.

Suggested tag:

```text
m23-wu07-evidence-import-command
```

### WU23-08 — Atomic Mutation, Runlog, Idempotency, and Security Hardening

Objective: persist imports through M22 candidate-state services, reuse compact runlog conventions, prove replay idempotency, and close unsafe input/artifact paths.

Acceptance:

- no partial mutation;
- no duplicate events;
- conflict behavior deterministic;
- artifact locators safe;
- no raw payload leakage;
- execution-boundary scan green.

Suggested tag:

```text
m23-wu08-import-atomicity-hardening
```

### WU23-09 — Full Regression, Clean-Clone Validation, and Milestone Closure

Objective: close compatibility coverage, validate real CI, determine versioning, calculate residual risk, and prepare Gate D.

Acceptance:

- full regression green;
- historical compatibility green;
- clean clone green;
- real CI green;
- all Work Unit tags verified;
- milestone and release tags created only after CI;
- merge residual risk `<=15`;
- no M24 implementation started.

Suggested tag:

```text
m23-wu09-final-validation
```

---

## 22. Source-Control and Version Discipline

- Default branch: `main`.
- No `.aiqt/` self-management state.
- Gate C is report-only and has no tag.
- Every numbered Work Unit receives:
  - one detailed commit;
  - one unique annotated tag;
  - validation evidence;
  - `Risk: N/100`;
  - structured Work Unit report.
- Do not create empty commits.
- Do not combine unrelated Work Units.
- Do not move or rewrite historical tags.
- Do not force-push.
- Use repository version governance.
- A minor product increment is likely because M23 adds a public command, but the exact version must be determined through the real version policy and `version:check`.
- Final milestone and release tags are created only after real CI passes.

Preferred final milestone tag:

```text
m23-external-evidence-import-normalization
```

---

## 23. Risk Register

The Controlled score is the risk after specification-level design controls but before Gate C repository evidence and implementation-specific mitigations.

| ID | Hazard | Probability | Impact | Inherent | Required design controls | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M23-R01 | External payload bypasses canonical M22 authority | Medium | High | 50 | adapters output internal DTO; M22 owners remain authoritative | 33 | 33 | 15 |
| M23-R02 | Provider-specific semantics leak into canonical state | Medium | High | 50 | generic formats, static mapping, no provider fields beyond provenance | 33 | 25 | 12 |
| M23-R03 | Source-authored trust is accepted as canonical | Medium | High | 50 | adapter-fixed trust ceilings, no trust input field | 17 | 17 | 8 |
| M23-R04 | Malformed or hostile JSON causes unsafe behavior | Medium | High | 50 | byte/depth caps, strict schemas, prohibited keys, safe errors | 33 | 25 | 12 |
| M23-R05 | Duplicate imports create duplicate issues or repair work | Medium | High | 50 | canonical digest, M22 issue key, idempotent candidate state | 33 | 25 | 12 |
| M23-R06 | Preview differs from actual mutation | Medium | Medium | 33 | shared planning pipeline, deterministic IDs, equivalence tests | 17 | 17 | 10 |
| M23-R07 | Artifact locator triggers secret leakage or external access | Medium | High | 50 | metadata-only normalization, URL restrictions, no fetch/open | 25 | 25 | 12 |
| M23-R08 | Raw external payload enters state or runlog | Medium | High | 50 | digest-only provenance, payload-leak tests, compact events | 17 | 17 | 8 |
| M23-R09 | Adapter registry becomes dynamic execution surface | Low | Critical | 33 | static compile-time registry, no imports from user input | 8 | 8 | 5 |
| M23-R10 | Binding mismatch is imported as valid evidence | Medium | High | 50 | mandatory M22 evaluator, mismatch rejection | 25 | 25 | 12 |
| M23-R11 | New optional provenance breaks historical state | Medium | High | 50 | additive optional field, no read-time materialization, fixtures | 25 | 25 | 10 |
| M23-R12 | Input failure partially mutates state/runlog | Medium | High | 50 | complete candidate state, atomic write, failure injection | 33 | 25 | 15 |
| M23-R13 | Generic CI payload is treated as platform-verified | Medium | High | 50 | trust fixed to self-reported, explicit negative tests | 17 | 17 | 8 |
| M23-R14 | Import command changes workflow readiness or checkpoint outcome | Low | Critical | 33 | advisory-only contract, no readiness/checkpoint wiring | 8 | 8 | 5 |
| M23-R15 | External-ID conflict silently overwrites evidence | Medium | High | 50 | M23-owned scoped import identity, immutable digest binding, explicit conflict rejection | 25 | 25 | 12 |

Risk derivation:

```text
controlledDesignRisk =
  max(Controlled score of every M23 hazard)

implementationEntryRisk =
  max(current score of every open M23 hazard after Gate C)

mergeResidualRisk =
  max(residual score of every open or accepted M23 hazard)
```

```yaml
risk_targets:
  controlledDesignRisk: 33
  implementationEntryRiskMaximum: 33
  mergeResidualRiskMaximum: 15
```

M23 must not begin above `33` and must not merge above `15`.

---

## 24. Out of Scope

M23 must not add:

- provider API clients;
- OAuth;
- webhooks;
- CI polling;
- CI execution;
- repository hosting integration;
- signed provenance verification;
- artifact downloading;
- artifact-content hashing;
- YAML, XML, SARIF, JUnit, TAP, or vendor-specific parsers;
- JSONL or directory batch import;
- archive import;
- network URL import;
- dynamic adapters;
- provider plugins;
- arbitrary validation command execution;
- coding-agent execution;
- workspace/worktree creation;
- evidence requirement policies;
- checkpoint enforcement;
- readiness changes;
- automatic issue resolution;
- automatic escalation resolution;
- platform-verified trust;
- repository-local trust;
- M24 workspace assignment metadata.

---

## 25. Definition of Done

```yaml
definition_of_done:
  gate_c:
    - baseline verified
    - all M22 owners verified
    - entry risk <= 33
  formats:
    - generic-evidence-json@1 implemented
    - generic-ci-json@1 implemented
    - manual-evidence-json@1 implemented
    - registry static
  input:
    - explicit file input
    - explicit stdin input
    - byte and depth caps
    - strict JSON
  normalization:
    - one internal candidate DTO
    - canonical JSON digest
    - M23-owned scoped import identity
    - deterministic external-ID/digest conflict handling
    - adapter-fixed trust
    - safe artifact references
  m22_integration:
    - binding evaluator reused
    - issue fingerprint and key reused
    - F06 routing reused
    - transitions reused
    - lifecycle owner reused
    - promotion deduplication reused
  preview:
    - full pipeline
    - deterministic action plan
    - zero mutation
  persistence:
    - candidate-state atomicity
    - idempotent replay
    - compact runlog
    - no raw payload persistence
  security:
    - no network
    - no shell
    - no plugin loading
    - no artifact fetch
    - no provider SDK
  compatibility:
    - historical fixtures green
    - schema version remains 0.5.0 unless explicitly approved
    - read-only commands do not materialize new state
  validation:
    - typecheck green
    - lint green
    - full tests green
    - build green
    - coverage green
    - clean clone green
    - real CI green
  governance:
    - every numbered Work Unit committed and tagged
    - package version and tags consistent
    - residual risk <= 15
  boundary:
    - no required-evidence semantics
    - no workflow blocking
    - no M24 implementation
```

---

## 26. Required Agent Output

For every numbered Work Unit:

```yaml
work_unit_result:
  work_unit_id: required
  baseline_verified: required
  objective: required
  summary: required
  files_changed: required
  contracts_or_behavior_added: required
  M22_owners_reused: required
  compatibility_evidence: required
  security_boundary_evidence: required
  tests_added_or_updated: required
  validation_commands_and_exit_codes: required
  acceptance_criteria_evidence: required
  commit: required
  tag: required
  risk_score_0_to_100: required
  residual_findings: required
  next_action: required
```

Final M23 report must include:

1. Gate C report;
2. exact repository baseline;
3. Work Unit completion table;
4. final adapter registry;
5. payload contract summary for all three formats;
6. canonical digest and import-identity algorithms with fixtures;
7. generic-CI status reconciliation evidence;
8. trust-assignment matrix;
9. binding behavior;
10. M22 routing/classification/lifecycle reuse evidence;
11. preview/mutation equivalence evidence;
12. idempotency and conflict evidence;
13. artifact safety evidence;
14. state/runlog atomicity;
15. historical compatibility matrix;
16. execution-boundary scan;
17. full validation and real-CI results;
18. files, commits, tags, PRs, and package version;
19. hazard-by-hazard residual risk;
20. final merge residual risk;
21. Gate D readiness;
22. confirmation that M24 was not started.

---

## 27. Gate D Readiness

M23 may declare Gate D open only when:

- all three formats import through file and stdin;
- preview and mutation are equivalent;
- identical payload replay is idempotent;
- M23 import identity and scoped external-ID conflict behavior are deterministic and non-destructive;
- contradictory CI aggregate claims reconcile conservatively and never silently pass;
- every imported finding uses M22 routing;
- no provider payload can elevate trust or lifecycle authority;
- no network/process/plugin/artifact-fetch surface exists;
- historical state remains compatible;
- real CI is green;
- merge residual risk is `<=15`.

Gate D output must identify:

```yaml
gate_d_handoff:
  supported_formats:
    - generic-evidence-json@1
    - generic-ci-json@1
    - manual-evidence-json@1
  canonical_import_command: aiqt evidence import
  execution_surface: none
  provider_network_surface: none
  required_evidence_semantics: none
  next_milestone:
    id: M24
    title: Workspace Assignment and Parallel Eligibility Metadata
```

M23 must not implement M24.

---

## 28. Review Questions

1. Does M23 reuse the M22 canonical evidence and issue owners rather than duplicating them?
2. Are the three supported formats provider-neutral and statically registered?
3. Can any payload claim or elevate canonical trust?
4. Is generic CI evidence explicitly self-reported rather than platform-verified?
5. Is one shared canonical digest used across file, stdin, preview, and mutation?
6. Does M23 explicitly own scoped external import identity and same-ID/different-digest conflicts?
7. Does generic CI reconcile run/check contradictions conservatively and emit bounded evidence?
8. Is the raw payload absent from state, runlog, errors, and output?
9. Does strict parsing reject unknown fields, prohibited keys, oversized input, and unsafe nesting?
10. Are artifact references metadata-only and never fetched?
11. Does binding mismatch reject without mutation?
12. Are stale, unavailable, and unknown evidence accepted only with explicit warnings?
13. Does every finding flow through M22 F-06 routing and centralized classification?
14. Is initial routing still CheckpointIssue XOR ProjectIssue?
15. Are replay, transitions, escalations, promotions, and repair Work Units idempotent?
16. Does preview execute the full planning pipeline without mutation?
17. Are preview and mutation action plans equivalent on unchanged state?
18. Are file/stdin conflicts and exit codes deterministic?
19. Is the import command advisory only?
20. Does M23 avoid network, shell, plugins, provider SDKs, and workflow enforcement?
21. Are historical fixtures and schema version preserved?
22. Is controlled design risk `33`, entry risk `<=33`, and residual risk `<=15` supported by evidence?
23. Is Gate D prepared without starting M24?

Approval threshold:

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  implementation_entry_risk_maximum: 33
  merge_residual_risk_maximum: 15
  hidden_execution_surfaces: 0
  raw_payload_persistence: 0
  provider_specific_canonical_semantics: 0
  historical_fixture_regressions: 0
```
