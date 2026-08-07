# AIQT Milestone 24 Build Specification v0.2

## Workspace Assignment and Parallel Eligibility Metadata

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Revised review candidate before build handoff
  milestone:
    id: M24
    title: Workspace Assignment and Parallel Eligibility Metadata
  baseline:
    product_version: 0.10.0
    product_release_tag: v0.10.0
    technical_closure_commit: e396211
    development_baseline_commit: c232ff0
    milestone_tag: m23-external-evidence-import-normalization
    test_count: 1506
    schema_version: 0.5.0
    open_critical_high_dependency_alerts: 0
    gate_d_status: open
    verification_required: true
  aligns_with:
    - AIQT Post-M20 Proposed Milestones Roadmap v0.4
    - AIQT Milestone 23 Build Specification v0.2
    - M23 technical and governance/atomicity closure reports
    - current work-graph, planning, next-selection, handoff-packet, state, runlog, output, and version-governance owners
  primary_agent_target: Claude Code, Codex, or equivalent coding agent
  architecture_role: local workflow control plane
  risk:
    inherent: 50
    controlled_design_target: 33
    implementation_entry_target: 30
    merge_residual_target: 12
```

---

## 0. Document Position

M23 established bounded external evidence ingestion.

M24 adds declarative execution-planning metadata for workspaces and safe parallelism.

Its responsibility is:

```text
Work Unit
+ graph dependencies
+ logical workspace assignment metadata
+ shared-resource claims
+ current Work Unit statuses
→ deterministic advisory parallel-eligibility result
```

M24 does not create or manage workspaces.

It must not:

- create Git branches or worktrees;
- clone repositories;
- create directories for agents;
- assign physical paths;
- checkout, reset, merge, rebase, or delete Git state;
- start coding agents;
- run Work Units;
- schedule background execution;
- lock operating-system resources;
- call provider APIs;
- execute shell commands;
- enforce parallel execution;
- mutate checkpoints or effective readiness;
- treat eligibility as execution authorization.

M24 creates the provider-neutral metadata and pure evaluation contracts required by:

- M25 — Managed Workspace Provider Adapters;
- M26 — Long-Running Execution Protocol.

The architecture remains:

```text
M24 declares logical workspace intent and computes advisory eligibility.
M25 may resolve logical assignments into managed provider workspaces.
M26 may consume eligibility through an execution protocol.
```

AIQT is the product being developed. M24 must be managed through repository specifications, Git, tests, CI, commits, tags, and structured reports. It must not use `.aiqt/` self-management state.

### 0.1 Gate and Work Unit governance

Gate D is a read-only pre-build gate.

Therefore:

- Gate D produces a structured report;
- Gate D creates no commit or tag;
- every numbered M24 Work Unit must produce one auditable commit and one annotated tag;
- if two Work Units cannot be separated without creating an invalid intermediate product state, implementation must stop and request an explicit combined-commit waiver before combining them;
- no waiver may be created retroactively merely to reconcile inaccurate reporting.

### 0.2 v0.2 Change Summary

v0.2 resolves the review findings from v0.1:

1. `workspaceAssignment.mode: none` combined with repository/path write or exclusive claims is now an intrinsic cross-field validation error on one Work Unit, rejected before persistence.
2. The pairwise workspace-conflict section now contains only relationships between two Work Units.
3. Assignment-key validation wording was simplified so the allowed-character rule is the normative constraint.
4. Path normalization now states explicitly that backslashes are inspected only to detect non-canonical input and are then rejected rather than silently converted.

No milestone scope, risk threshold, execution boundary, or parallel-eligibility semantics changed.

---

## 1. Objective

M24 must prove that AIQT can:

1. represent workspace-assignment intent without representing a physical workspace;
2. represent conservative parallel-execution policy per Work Unit;
3. represent bounded shared-resource claims;
4. preserve all historical Work Units that lack M24 metadata;
5. treat missing metadata as serialized, never implicitly parallel;
6. determine pairwise compatibility using graph, status, workspace, concurrency-group, and resource-claim rules;
7. account for already active Work Units when evaluating new ready Work Units;
8. construct one deterministic advisory parallel batch;
9. expose eligibility through an explicit read-only CLI flag;
10. include workspace and parallel-safety metadata in agent handoff packets;
11. integrate metadata into existing plan/import/refinement candidate-state paths;
12. avoid all workspace-provider, Git-operation, scheduler, and execution behavior;
13. preserve current readiness, checkpoint, issue, evidence, and navigation semantics.

---

## 2. Canonical Ownership and Storage

### 2.1 Preferred additive Work Unit shape

Gate D must verify the current Work Unit schema and exact field owner.

Preferred additive contract:

```yaml
WorkUnit:
  existing_fields: preserved
  executionMetadata:
    workspaceAssignment: optional
    parallelPolicy: optional
```

Rules:

- `executionMetadata` is optional;
- both child objects are optional;
- historical Work Units remain valid;
- missing metadata is interpreted through conservative derived defaults;
- read-only commands do not materialize defaults;
- metadata is stored with the Work Unit because it describes planned execution characteristics, not runtime workspace state;
- no top-level managed-workspace state is added in M24;
- no physical provider assignment is persisted in M24;
- no schema-version bump is expected unless Gate D proves additive compatibility impossible.

If `executionMetadata` conflicts with an existing field name, Gate D must identify a repository-consistent alternative without changing the conceptual ownership.

### 2.2 Runtime state separation

M24 must not persist:

- workspace lifecycle;
- provider state;
- physical path;
- branch name;
- worktree name;
- process identifier;
- lease;
- heartbeat;
- lock;
- execution attempt;
- agent session;
- remote repository;
- provider credentials.

Those belong to M25 or later milestones.

---

## 3. Gate D — Mandatory Pre-Build Verification

No implementation begins until a read-only Gate D report verifies the live repository.

```yaml
gate_d_report:
  repository:
    branch: required
    clean_status: required
    origin_sync: required
    head_commit: required
    package_version: required
    release_tag: required
    m23_tag: required
    test_count: required
    dependency_alerts: required
  work_graph:
    WorkUnit_schema_owner: required
    WorkUnit_status_values: required
    dependency_graph_owner: required
    transitive_dependency_query_owner: required
    ready_selection_owner: required
    graph_ordering_owner: required
    active_status_semantics: required
    replanned_status_semantics: required
  planning:
    plan_create_owner: required
    plan_import_owner: required
    plan_extend_owner: required
    refine_owner: required
    candidate_state_validation_owner: required
    no_partial_write_guarantee: required
  handoff:
    packet_schema_owner: required
    packet_builder_owner: required
    packet_output_owner: required
  cli:
    status_command_owner: required
    status_flag_conventions: required
    json_output_owner: required
    exit_code_owner: required
  persistence:
    state_owner: required
    runlog_owner: required
    atomic_write_owner: required
    current_state_runlog_recovery_model: required
  compatibility:
    historical_fixture_matrix: required
    schema_version: required
    read_only_non_materialization: required
  execution_boundary:
    git_mutation_added: false
    workspace_creation_added: false
    process_execution_added: false
    network_surface_added: false
    provider_surface_added: false
  risk:
    recalculated_entry_risk: required
```

Expected baseline claims:

```yaml
expected_gate_d_baseline:
  branch: main
  package_version: 0.10.0
  product_release_tag: v0.10.0
  development_commit: c232ff0
  tests: 1506
  schema_version: 0.5.0
  critical_high_dependency_alerts: 0
```

Treat these as claims to verify.

### 3.1 Gate D risk rule

```text
implementationEntryRisk =
  max(current score of every open M24 hazard after Gate D controls)
```

Implementation may begin only when:

```text
implementationEntryRisk <= 30
```

Stop before writing code if:

- the Work Unit schema cannot accept additive metadata;
- graph dependency ownership is unclear;
- plan/refine mutations cannot remain atomic;
- active Work Unit status semantics are ambiguous;
- handoff packet ownership is duplicated;
- advisory output would require execution or provider behavior.

---

## 4. Workspace Assignment Metadata

### 4.1 Contract

```yaml
WorkspaceAssignmentMetadata:
  mode:
    - shared
    - isolated
    - none
  assignmentKey: optional_normalized_token
  access:
    - read_only
    - read_write
```

### 4.2 Meaning

`WorkspaceAssignmentMetadata` is logical planning metadata.

It does not identify a real directory, branch, worktree, container, virtual machine, remote environment, or provider workspace.

```yaml
mode_meaning:
  shared:
    description: multiple Work Units may intentionally reference the same logical workspace assignment
  isolated:
    description: the Work Unit requires a logically distinct workspace assignment
  none:
    description: the Work Unit does not require a repository workspace
```

### 4.3 Validation

Rules:

- `shared` and `isolated` require `assignmentKey`;
- `none` prohibits `assignmentKey`;
- `none` requires no repository workspace and therefore must use `access: read_only`;
- `assignmentKey` is a logical identifier, not a path;
- normalized length: `1..128`;
- allowed characters are limited to ASCII letters, digits, `.`, `_`, `-`, `/`;
- the whitelist above is normative and therefore excludes shell syntax, environment-variable expressions, URL delimiters, whitespace, and control characters;
- leading/trailing `/` prohibited;
- repeated `/` prohibited;
- `.` and `..` path segments prohibited;
- drive-letter and UNC forms prohibited;
- secret-looking values must not be inferred or logged;
- isolated assignment keys must be unique across non-terminal Work Units;
- shared assignment keys may repeat;
- M24 does not verify that any real workspace exists.

Cross-field self-consistency rules for one Work Unit:

- `workspaceAssignment.mode: none` is invalid when any resource claim has:
  - `domain: repository` or `domain: path`; and
  - `access: write` or `access: exclusive`;
- this contradiction is rejected during plan, import, extension, refinement, and any other metadata mutation path;
- rejection uses exit `3`;
- candidate state and runlog remain unchanged;
- this is an intrinsic metadata validation error, not a pairwise parallel conflict;
- read-only eligibility evaluation over already-invalid canonical state returns `invalid_execution_metadata`.

### 4.4 Workspace conflict

After intrinsic metadata validation has succeeded, two Work Units have a workspace conflict when:

- either lacks workspace metadata;
- both use the same non-`none` assignment key and at least one has `read_write` access;
- both declare `isolated` with the same assignment key.

Two Work Units do not conflict solely on workspace assignment when:

- both use `none`;
- both use the same shared assignment key with `read_only`;
- they use distinct valid assignment keys;
- workspace metadata is valid and another conflict category does not apply.

Invalid metadata is reported through the evaluator as `invalid_execution_metadata`; it is not treated as a valid pairwise workspace relationship.

---

## 5. Parallel Policy Metadata

### 5.1 Contract

```yaml
ParallelPolicyMetadata:
  mode:
    - serialized
    - eligible_if_no_conflict
    - manual_review
  concurrencyGroup: optional_normalized_token
  resourceClaims: bounded_array
```

### 5.2 Meaning

```yaml
parallel_mode:
  serialized:
    result: never automatically eligible with another active or selected Work Unit
  eligible_if_no_conflict:
    result: eligible only when every graph, status, workspace, group, and resource check passes
  manual_review:
    result: excluded from automatic batch and surfaced for human decision
```

Rules:

- missing `parallelPolicy` derives to `serialized`;
- source metadata cannot bypass graph dependencies;
- `manual_review` never becomes automatically eligible;
- eligibility is advisory and read-only;
- no mode authorizes execution.

### 5.3 Concurrency group

`concurrencyGroup` is an optional logical mutex namespace.

Rules:

- normalized length: `1..128`;
- same normalization restrictions as `assignmentKey`;
- two Work Units with the same non-empty group conflict;
- group comparison is exact after normalization;
- group values are not operating-system locks;
- no lock file is created.

---

## 6. Resource Claims

### 6.1 Contract

```yaml
ResourceClaim:
  domain:
    - repository
    - path
    - database
    - environment
    - external_system
    - custom
  key: normalized_domain_specific_key
  access:
    - read
    - write
    - exclusive
```

### 6.2 General rules

- maximum claims per Work Unit: `100`;
- duplicate normalized claims in one Work Unit are invalid;
- claims are declarative;
- M24 does not inspect the claimed resource;
- M24 does not authenticate to external systems;
- M24 does not create locks;
- M24 does not infer missing claims;
- empty claims mean no additional shared resources beyond workspace assignment.

### 6.3 Repository domain

```yaml
repository_claim:
  key: project
```

Only `project` is valid.

Conflict:

- `read/read` is compatible;
- any combination containing `write` conflicts;
- `exclusive` conflicts with all access modes.

### 6.4 Path domain

Path keys must be repository-relative POSIX paths.

Normalization:

1. inspect a temporary slash-normalized copy only to detect traversal, absolute, UNC, and drive-letter patterns consistently;
2. reject the original input whenever it contains `\`; M24 accepts only canonical forward-slash repository-relative paths and never silently converts persisted input;
3. reject absolute, UNC, drive-letter, URL, device, empty, `.` and `..` paths;
4. collapse no semantic segments silently;
5. strip one optional trailing `/`;
6. preserve case;
7. compare by complete path segment.

Overlap:

```text
src
overlaps src/file.ts

src/a
does not overlap src-ab

src/A
does not overlap src/a
```

Conflict:

- overlapping `read/read` is compatible;
- overlapping claims conflict when either is `write`;
- `exclusive` conflicts on overlap;
- non-overlapping paths are compatible.

M24 does not inspect symlinks or real filesystem case sensitivity.

### 6.5 Database, environment, external system, and custom domains

Keys:

- normalized Unicode NFC;
- trimmed;
- `1..256` characters;
- control characters prohibited;
- line breaks prohibited;
- exact case-sensitive comparison after normalization.

Conflict:

- same domain and key use the standard access matrix;
- different domains do not conflict;
- different keys do not conflict.

### 6.6 Standard access matrix

| A | B | Conflict |
|---|---|---|
| read | read | no |
| read | write | yes |
| write | read | yes |
| write | write | yes |
| exclusive | any | yes |
| any | exclusive | yes |

---

## 7. Conservative Historical Defaults

A historical Work Unit without M24 metadata remains valid.

Derived behavior:

```yaml
missing_execution_metadata:
  workspaceAssignment: unknown
  parallelPolicy:
    mode: serialized
  eligibility:
    automatic: false
    reason: metadata_missing
```

Rules:

- missing metadata never enables parallelism;
- no read-only command writes the derived default;
- no migration is required;
- existing packet generation remains valid;
- existing `next` behavior remains unchanged without the explicit M24 reporting flag.

---

## 8. Active Occupancy and Candidate Sets

### 8.1 Candidate Work Units

Automatic batch candidates must be Work Units currently considered ready by the existing graph/readiness owner.

M24 must not implement a second readiness algorithm.

### 8.2 Active Work Units

Gate D must verify exact status names.

Preferred occupied set:

```yaml
active_occupancy_statuses:
  - in_progress
  - needs_review
```

A ready candidate must be compatible with every active Work Unit.

If repository semantics prove that another status retains execution resources, Gate D may add it with explicit evidence.

Terminal statuses must not occupy resources.

Replanned Work Units must follow the existing graph owner's terminal/non-terminal semantics.

### 8.3 Dependency conflict

Two Work Units conflict when:

- either directly depends on the other;
- either transitively depends on the other;
- selecting both would violate current readiness semantics.

Dependency checks must use the existing graph owner.

---

## 9. Pairwise Parallel Eligibility

### 9.1 Derived result

```yaml
ParallelEligibilityResult:
  leftWorkUnitId: required
  rightWorkUnitId: required
  eligible: boolean
  disposition:
    - eligible
    - serialized
    - manual_review
    - conflict
    - invalid_metadata
  reasons: bounded_sorted_array
  conflicts: bounded_sorted_array
```

### 9.2 Reason vocabulary

```yaml
eligibility_reasons:
  - metadata_missing
  - parallel_policy_serialized
  - parallel_policy_manual_review
  - work_unit_not_ready
  - active_work_unit_conflict
  - direct_dependency
  - transitive_dependency
  - workspace_assignment_conflict
  - isolated_assignment_key_reused
  - concurrency_group_conflict
  - resource_claim_conflict
  - invalid_execution_metadata
```

Rules:

- reason ordering is deterministic;
- no free-form reason text in canonical result;
- human output may map reason codes to stable descriptions;
- duplicate reasons are removed;
- `eligible: true` is valid only when `reasons` and `conflicts` are empty.

### 9.3 Evaluation order

Evaluation must be deterministic:

1. validate both metadata objects;
2. verify candidate/active status semantics;
3. check direct/transitive dependency;
4. check parallel policy;
5. check workspace assignment;
6. check concurrency group;
7. check resource claims;
8. sort and deduplicate reasons;
9. derive final disposition.

The evaluator must be pure and perform no filesystem, Git, network, or state mutation.

---

## 10. Deterministic Advisory Batch

### 10.1 Batch purpose

M24 may produce one recommended advisory batch of ready Work Units.

It is not a scheduler.

```yaml
ParallelBatchResult:
  primaryWorkUnitId: optional
  activeWorkUnitIds: bounded_array
  selectedWorkUnitIds: bounded_array
  excluded:
    - workUnitId: required
      reasons: bounded_sorted_array
  manualReviewWorkUnitIds: bounded_array
  deterministicOrder: required
```

### 10.2 Algorithm

1. obtain ready Work Units from the existing readiness owner;
2. obtain stable graph order from the existing graph owner;
3. sort by graph order, then Work Unit ID;
4. choose the existing `next` selector's primary Work Unit when one exists;
5. reject the primary if it conflicts with any active Work Unit;
6. iterate remaining ready Work Units in stable order;
7. add a candidate only when it is eligible with:
   - every active Work Unit;
   - every already selected Work Unit;
8. classify manual-review candidates separately;
9. record deterministic exclusion reasons.

Rules:

- no optimization or maximum-independent-set search is required;
- result must be stable for identical state;
- no timestamps;
- no random IDs;
- no state mutation;
- no runlog event;
- no packet generation for multiple Work Units.

---

## 11. Public CLI Contract

M24 extends the existing status command:

```text
aiqt status --parallel
aiqt status --parallel --json
```

Rules:

- without `--parallel`, existing status output remains unchanged;
- `--parallel` is read-only;
- it evaluates active occupancy, ready candidates, pairwise conflicts, and the deterministic advisory batch;
- it does not start Work Units;
- it does not transition statuses;
- it does not generate multiple packets;
- it does not assign physical workspaces;
- it does not append runlog;
- it does not materialize missing metadata.

### 11.1 Human output

Minimum sections:

```text
Parallel execution advisory
Active Work Units
Recommended batch
Manual review
Excluded Work Units and reasons
```

Every output must state:

```text
Advisory only — no workspace was created and no Work Unit was started.
```

### 11.2 JSON output

```yaml
parallelStatus:
  advisory: true
  activeWorkUnitIds: []
  readyWorkUnitIds: []
  recommendedBatch: []
  manualReviewWorkUnitIds: []
  excluded: []
  metadataCoverage:
    complete: count
    missing: count
    invalid: count
```

Use established output-envelope conventions.

### 11.3 Exit codes

| Condition | Exit | Mutation |
|---|---:|---|
| Valid advisory result | 0 | none |
| No ready Work Units | 0 | none |
| Missing metadata | 0 with advisory reason | none |
| Manual review required | 0 with advisory reason | none |
| Structurally invalid execution metadata in canonical state | 3 | none |
| Broken Work Unit/dependency reference | 3 | none |
| Unsupported flag combination | 3 | none |

No parallel conflict produces exit `1` or `2`.

---

## 12. Planning, Import, Extension, and Refinement

M24 metadata must integrate with existing Work Unit mutation paths.

Gate D must identify the exact owners.

Required paths:

- initial plan creation;
- structured plan import;
- incremental extension;
- eligible Work Unit refinement/replacement.

Rules:

- metadata is optional;
- unknown fields follow existing strictness;
- validation happens before any state write;
- invalid metadata causes exit `3`;
- no partial graph mutation;
- boundary dependencies remain preserved;
- refinement may replace execution metadata only through existing refinement semantics;
- replanned originals preserve historical metadata;
- replacement Work Units receive explicit metadata or conservative defaults;
- M24 must not add a parallel plan-editing command if existing plan/import/refine owners can support the metadata.

### 12.1 Metadata-only update

If the repository has an established safe Work Unit update owner, M24 may extend it to update execution metadata.

If no such owner exists, do not create an isolated command in M24. Metadata changes may occur through plan extension/refinement only.

---

## 13. Agent Handoff Packet Integration

The existing packet builder must add one bounded section when M24 metadata is present:

```text
Workspace and parallel execution advisory
```

Minimum content:

```yaml
workspace:
  mode: required
  assignmentKey: present_when_allowed
  access: required
parallel:
  mode: required
  concurrencyGroup: optional
  resourceClaims: bounded_summary
  compatibleWithActiveWork: derived_boolean
  advisoryReasons: bounded_array
```

Rules:

- packet states that metadata is advisory;
- packet does not include a physical path;
- packet does not claim a workspace exists;
- packet does not authorize the agent to create a branch/worktree unless a future provider packet explicitly does so;
- packet does not include all other Work Unit packet bodies;
- absent metadata produces a short serialized/missing-metadata advisory;
- packet generation remains limited to the current Work Unit.

M24 must not change the existing Work Unit status transition performed by packet creation.

---

## 14. Mutation, Runlog, and Atomicity

### 14.1 Metadata mutations

Planning/import/refinement changes must use the existing candidate-state and atomic-write pipeline.

Any metadata validation failure causes:

- exit `3`;
- zero state mutation;
- zero runlog mutation.

### 14.2 Runlog

Prefer existing graph/work-unit mutation events.

Add a new event only if existing events cannot represent the change:

```text
work_unit.execution_metadata_changed
```

Maximum payload:

```yaml
event:
  workUnitId: required
  workspaceMode: optional
  parallelMode: optional
  resourceClaimCount: bounded_integer
```

Do not include:

- all claim keys;
- secrets;
- physical paths;
- provider data;
- packet content.

No runlog event is emitted for:

- `status --parallel`;
- pure eligibility evaluation;
- derived conservative defaults;
- no-op updates.

### 14.3 State/runlog recovery

M24 inherits the documented repository-wide model:

```yaml
recovery_model: authoritative_state_with_advisory_runlog_gap
```

Any new metadata mutation must be idempotent and safe to retry after a runlog append failure.

Required failure-injection coverage:

```text
state write succeeds
→ runlog append fails
→ canonical state remains correct
→ retry creates no duplicate metadata or graph records
```

M24 must not broaden the cross-file recovery model.

---

## 15. State-Growth Limits

```yaml
execution_metadata_limits:
  assignment_key_max_chars: 128
  concurrency_group_max_chars: 128
  resource_claim_key_max_chars: 256
  resource_claims_per_work_unit_max: 100
  serialized_execution_metadata_max_bytes: 16384
  eligibility_reasons_per_pair_max: 32
  conflicts_per_pair_max: 100
  advisory_batch_work_units_max: 5000
```

Rules:

- caps are validated before mutation;
- status output may truncate human-readable detail but JSON output must report truncation explicitly;
- no unbounded pairwise matrix is persisted;
- eligibility results are derived and not stored;
- batch evaluation must avoid persisting O(n²) output;
- pathological input must fail or degrade deterministically without memory-unbounded behavior.

---

## 16. Security and Execution Boundary

M24 must add no:

- `child_process`;
- `exec`;
- `spawn`;
- shell string;
- Git command invocation;
- Git library mutation;
- branch creation;
- worktree creation;
- filesystem workspace creation;
- lock-file creation;
- process management;
- network request;
- provider SDK;
- credential field;
- dynamic plugin;
- background worker;
- scheduler;
- agent invocation.

Logical assignment keys and resource claims must not be interpreted as executable paths or commands.

---

## 17. Compatibility Contract

M24 must preserve:

- historical state without `executionMetadata`;
- M22 evidence and ProjectIssue state;
- M23 import provenance;
- Work Units in all existing statuses;
- replanned Work Units;
- existing dependency graphs;
- current `status` output without `--parallel`;
- current `next` selection;
- packet creation status transitions;
- checkpoint behavior;
- review behavior;
- effective readiness;
- plan extension/refinement;
- runlog parsing;
- schema version `0.5.0`, unless additive compatibility is proven impossible.

Read-only commands must not materialize:

- workspace assignments;
- parallel policies;
- resource claims;
- derived defaults;
- eligibility results;
- recommended batches.

---

## 18. Repository Implementation Areas

Exact paths must be verified during Gate D.

Expected areas:

```text
src/schema/
  work-unit.schema.ts
  execution-metadata.schema.ts

src/workflow/ or current graph owner
  workspace-assignment.ts
  resource-claim.ts
  parallel-eligibility.ts
  parallel-batch.ts

src/commands/
  status.command.ts

src/planning/
  existing plan/import/extend/refine owners only

src/handoff/
  existing packet builder only

tests/unit/
tests/integration/
tests/fixtures/
```

Do not create duplicate:

- Work Unit schema;
- readiness service;
- graph traversal;
- packet builder;
- candidate-state pipeline;
- atomic writer;
- runlog writer;
- status output envelope.

---

## 19. Testing Contract

### 19.1 Workspace metadata schema

Test:

- shared valid;
- isolated valid;
- none valid;
- missing key;
- prohibited key with `none`;
- `none` plus repository `write` claim is rejected during intrinsic validation;
- `none` plus repository `exclusive` claim is rejected during intrinsic validation;
- `none` plus path `write` claim is rejected during intrinsic validation;
- `none` plus path `exclusive` claim is rejected during intrinsic validation;
- invalid cross-field metadata causes exit `3` and zero state/runlog mutation;
- invalid access;
- empty key;
- oversized key;
- repeated slash;
- `.`/`..` segment;
- URL;
- drive-letter form;
- UNC form;
- environment-variable expression;
- isolated key reuse;
- historical omission.

### 19.2 Parallel policy schema

Test:

- serialized;
- eligible-if-no-conflict;
- manual-review;
- missing metadata;
- valid group;
- invalid/oversized group;
- duplicate claims;
- claim count cap;
- metadata byte cap.

### 19.3 Resource normalization and conflicts

Test every domain and access combination.

Path fixtures:

- ancestor overlap;
- descendant overlap;
- segment boundary;
- case preservation;
- trailing slash normalization;
- traversal rejection;
- absolute rejection;
- backslash rejection;
- read/read compatibility;
- read/write conflict;
- exclusive conflict.

### 19.4 Dependency and status evaluation

Test:

- direct dependency;
- transitive dependency;
- unrelated ready Work Units;
- candidate not ready;
- active `in_progress`;
- active `needs_review`;
- terminal Work Unit ignored;
- replanned semantics;
- use of existing readiness owner.

### 19.5 Workspace conflicts

Test:

- missing metadata;
- same shared key read/read;
- same shared key read/write;
- same isolated key;
- distinct keys;
- both none;
- intrinsic invalid metadata is surfaced as `invalid_execution_metadata`, not as a valid pairwise workspace conflict.

### 19.6 Concurrency groups

Test:

- same group;
- different group;
- omitted group;
- normalized exact comparison;
- group conflict plus another conflict;
- deterministic reason ordering.

### 19.7 Pairwise eligibility

Test:

- eligible;
- serialized;
- manual review;
- invalid metadata;
- multiple reasons;
- no duplicate reasons;
- stable output;
- `eligible` implies empty reasons/conflicts.

### 19.8 Advisory batch

Test:

- no ready Work Units;
- one ready Work Unit;
- multiple compatible Work Units;
- graph-order tie broken by ID;
- conflict with active Work Unit;
- conflict with prior selected Work Unit;
- manual-review separation;
- deterministic repeated result;
- no mutation;
- no runlog.

### 19.9 CLI

Test:

- `status --parallel`;
- `status --parallel --json`;
- status without flag unchanged;
- no ready Work Units;
- metadata missing;
- invalid canonical metadata;
- broken dependency;
- advisory disclaimer;
- no state/runlog changes.

### 19.10 Planning and refinement

Test metadata through:

- plan creation;
- import;
- extend;
- refine;
- invalid metadata rollback;
- no partial graph;
- boundary dependency preservation;
- replanned original metadata preserved;
- replacement metadata explicit or absent;
- duplicate isolated key rejection.

### 19.11 Handoff packet

Test:

- metadata section present;
- physical path absent;
- provider claim absent;
- advisory wording;
- missing metadata serialized warning;
- current packet structure otherwise unchanged;
- status transitions unchanged.

### 19.12 Atomicity and recovery

Test:

- state-write failure;
- runlog failure after successful metadata write;
- authoritative state;
- safe retry;
- no duplicate Work Unit or metadata;
- no duplicate runlog event;
- no-op update emits nothing.

### 19.13 Historical compatibility

Re-run:

- M22 compatibility matrix;
- M23 compatibility matrix;
- pre-M24 Work Units without metadata;
- status without flag byte-identical;
- next selection unchanged;
- packet output unchanged except explicit M24 section;
- schema version unchanged;
- read-only commands do not materialize defaults.

### 19.14 Execution-boundary scan

Prove zero new:

- shell/process calls;
- Git mutation;
- workspace directory creation;
- lock creation;
- network;
- provider SDK;
- dynamic plugin;
- agent execution.

### 19.15 Clean-environment validation

From a disposable clean clone:

1. install exact package manager;
2. use frozen lockfile;
3. run typecheck;
4. run lint;
5. run full tests;
6. run build;
7. run coverage;
8. run local and base-comparison version checks;
9. exercise planning metadata;
10. run `status --parallel`;
11. create one representative handoff packet;
12. verify state/runlog non-mutation for read-only operations;
13. run real CI on all supported Node versions.

All process exit codes must be checked explicitly.

---

## 20. Work Units

### WU24-01 — Execution Metadata Schema and Additive Work Unit Integration

Objective: add optional workspace-assignment and parallel-policy metadata to the existing Work Unit schema.

Acceptance:

- historical Work Units parse;
- conservative defaults derived only;
- no read-time materialization;
- no schema-version bump unless explicitly approved;
- size and normalization limits enforced.

Suggested tag:

```text
m24-wu01-execution-metadata-schema
```

### WU24-02 — Planning, Import, Extension, and Refinement Integration

Objective: carry M24 metadata through all established Work Unit creation and replacement paths.

Acceptance:

- candidate-state validation;
- no partial graph mutation;
- isolated-key uniqueness;
- `none` plus repository/path write or exclusive claims rejected before persistence;
- boundary dependencies preserved;
- no new planning command unless Gate D proves necessary.

Suggested tag:

```text
m24-wu02-planning-metadata-integration
```

### WU24-03 — Resource Claim Normalization and Conflict Engine

Objective: implement domain-aware normalization, path overlap, access-matrix conflicts, and bounded claim validation.

Acceptance:

- every domain covered;
- path behavior segment-aware;
- deterministic conflict records;
- no filesystem inspection;
- no lock creation.

Suggested tag:

```text
m24-wu03-resource-conflict-engine
```

### WU24-04 — Pairwise Parallel Eligibility

Objective: implement the pure pairwise evaluator using existing graph/readiness owners.

Acceptance:

- dependency and status rules;
- active occupancy;
- workspace conflicts;
- concurrency groups;
- resource conflicts;
- deterministic reasons;
- advisory only.

Suggested tag:

```text
m24-wu04-pairwise-eligibility
```

### WU24-05 — Deterministic Advisory Batch

Objective: implement stable greedy batch construction without scheduling or mutation.

Acceptance:

- existing next selector supplies primary;
- stable graph/ID order;
- compatible with every active and selected Work Unit;
- manual-review separation;
- no O(n²) persistence;
- repeated result identical.

Suggested tag:

```text
m24-wu05-advisory-parallel-batch
```

### WU24-06 — `aiqt status --parallel`

Objective: expose advisory eligibility and batch results through existing status output conventions.

Acceptance:

- explicit flag only;
- human and JSON output;
- advisory disclaimer;
- unchanged status without flag;
- no state/runlog mutation;
- exit-code contract.

Suggested tag:

```text
m24-wu06-parallel-status-output
```

### WU24-07 — Handoff Packet Integration

Objective: include bounded workspace and parallel-safety metadata in the current Work Unit packet.

Acceptance:

- no physical workspace claim;
- no execution authorization;
- missing metadata serialized warning;
- current status-transition behavior preserved;
- existing packet sections otherwise stable.

Suggested tag:

```text
m24-wu07-handoff-execution-metadata
```

### WU24-08 — Compatibility, Limits, Atomicity, and Security Hardening

Objective: close historical fixtures, mutation failure coverage, state/runlog recovery, caps, and execution-boundary scans.

Acceptance:

- M22/M23 regressions green;
- runlog failure retry safe;
- all caps tested;
- no hidden Git/workspace/process/network surface;
- schema remains additive.

Suggested tag:

```text
m24-wu08-compatibility-hardening
```

### WU24-09 — Full Validation and Milestone Closure

Objective: run clean-clone and real-CI validation, determine versioning, verify all tags, calculate residual risk, and prepare Gate E.

Acceptance:

- full suite green;
- clean clone green;
- real CI green;
- all Work Unit tags verified;
- package and milestone tags consistent;
- merge residual risk `<=12`;
- M25 not started.

Suggested tag:

```text
m24-wu09-final-validation
```

---

## 21. Source-Control and Version Discipline

- Default branch: `main`.
- No `.aiqt/` self-management state.
- Gate D receives no commit or tag.
- Every numbered Work Unit receives:
  - one detailed commit;
  - one unique annotated tag;
  - test and validation evidence;
  - `Risk: N/100`;
  - structured Work Unit report.
- Do not create empty commits.
- Do not combine Work Units without prior explicit waiver.
- Do not move or rewrite existing tags.
- Do not force-push.
- Use repository version governance.
- A minor increment is likely because M24 adds public status behavior and packet metadata, but the exact version must be determined by the repository’s real rules.
- Final release and milestone tags are created only after real CI passes.

Preferred final milestone tag:

```text
m24-workspace-assignment-parallel-eligibility
```

---

## 22. Risk Register

The Controlled score is the risk after specification-level controls but before Gate D repository evidence and implementation-specific verification.

| ID | Hazard | Probability | Impact | Inherent | Required design controls | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M24-R01 | Missing historical metadata implicitly enables parallelism | Medium | High | 50 | conservative serialized default, no materialization, fixtures | 17 | 17 | 8 |
| M24-R02 | Dependency-related Work Units are marked compatible | Medium | High | 50 | reuse graph owner, direct/transitive checks, negative tests | 25 | 25 | 10 |
| M24-R03 | Active Work Unit occupancy is ignored | Medium | High | 50 | verified active statuses, evaluate against all active Work Units | 25 | 25 | 10 |
| M24-R04 | Resource/path overlap produces false-negative conflict | Medium | High | 50 | domain normalization, segment-aware overlap, access matrix | 33 | 30 | 12 |
| M24-R05 | Logical assignment key is treated as physical provider state | Medium | High | 50 | schema excludes path/branch/provider fields, boundary tests | 17 | 17 | 8 |
| M24-R06 | Parallel batch is nondeterministic | Medium | Medium | 33 | existing graph order, ID tie-break, pure greedy algorithm | 17 | 17 | 8 |
| M24-R07 | Manual-review policy becomes automatically eligible | Low | High | 25 | explicit disposition, exclusion tests | 8 | 8 | 5 |
| M24-R08 | Status advisory mutates state or runlog | Low | High | 25 | pure evaluator, read-only command tests | 8 | 8 | 5 |
| M24-R09 | Handoff packet implies workspace existence or execution authority | Medium | Medium | 33 | bounded advisory section, explicit disclaimer, no physical fields | 17 | 17 | 8 |
| M24-R10 | Additive metadata breaks historical state | Medium | High | 50 | optional fields, no schema bump, historical fixtures | 25 | 25 | 10 |
| M24-R11 | Plan/refine metadata failure partially mutates graph | Medium | High | 50 | candidate-state validation, atomic write, failure injection | 33 | 25 | 12 |
| M24-R12 | Runlog failure creates duplicate metadata on retry | Medium | High | 50 | authoritative state, idempotent update, recovery tests | 25 | 25 | 12 |
| M24-R13 | Resource claims cause unbounded state/output growth | Medium | Medium | 33 | claim/byte caps, derived-only results, truncation reporting | 17 | 17 | 8 |
| M24-R14 | M24 introduces Git/workspace/process/provider execution | Low | Critical | 33 | metadata-only design, static scans, negative tests | 8 | 8 | 5 |
| M24-R15 | Same isolated assignment is reused by active Work Units | Medium | High | 50 | uniqueness validation, planning/refinement tests | 25 | 25 | 10 |
| M24-R16 | `status --parallel` changes existing status semantics | Low | High | 25 | explicit flag, unchanged baseline output fixtures | 8 | 8 | 5 |
| M24-R17 | A self-contradictory `none` workspace policy survives until pairwise evaluation | Medium | High | 50 | intrinsic cross-field validation in every mutation path, zero-mutation rejection tests | 17 | 17 | 8 |

Risk derivation:

```text
controlledDesignRisk =
  max(Controlled score of every M24 hazard)

implementationEntryRisk =
  max(current score of every open M24 hazard after Gate D)

mergeResidualRisk =
  max(final residual score of every open or accepted M24 hazard)
```

```yaml
risk_targets:
  controlledDesignRisk: 33
  implementationEntryRiskMaximum: 30
  mergeResidualRiskMaximum: 12
```

M24 must not begin above `30` and must not merge above `12`.

---

## 23. Out of Scope

M24 must not add:

- physical workspace records;
- worktree providers;
- local directory providers;
- container providers;
- remote development environments;
- Git branch/worktree operations;
- workspace create/open/release/delete;
- provider adapters;
- provider credentials;
- workspace leases;
- workspace health;
- process execution;
- agent execution;
- multi-agent orchestration;
- automatic packet dispatch;
- execution attempts;
- heartbeats;
- cancellation;
- retries;
- background scheduling;
- OS-level locks;
- database locks;
- network calls;
- required parallelism;
- required isolation;
- checkpoint or readiness enforcement;
- M25 implementation.

---

## 24. Definition of Done

```yaml
definition_of_done:
  gate_d:
    - baseline verified
    - canonical owners verified
    - entry risk <= 30
  state:
    - optional Work Unit execution metadata
    - historical states valid
    - conservative default
    - no read-time materialization
  workspace_metadata:
    - logical assignment only
    - shared isolated and none modes
    - intrinsic cross-field consistency validated before persistence
    - none mode cannot carry repository/path write or exclusive claims
    - no physical path branch provider or lifecycle
  parallel_policy:
    - serialized
    - eligible_if_no_conflict
    - manual_review
  resources:
    - bounded claims
    - deterministic normalization
    - path overlap
    - access matrix
  evaluator:
    - existing readiness reused
    - dependencies reused
    - active occupancy considered
    - deterministic pairwise results
  batch:
    - advisory only
    - stable order
    - compatible with active and selected Work Units
  cli:
    - status --parallel
    - human and JSON output
    - zero mutation
    - existing status unchanged without flag
  handoff:
    - bounded advisory metadata
    - no physical workspace claim
    - no execution authorization
  mutation:
    - planning/import/refine integration
    - candidate-state validation
    - idempotent recovery
  security:
    - no Git mutation
    - no workspace creation
    - no process
    - no network
    - no provider
  compatibility:
    - M22 and M23 fixtures green
    - schema version remains 0.5.0 unless explicitly approved
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
    - package and milestone tags consistent
    - residual risk <= 12
  boundary:
    - no M25 implementation
```

---

## 25. Required Agent Output

For every numbered Work Unit:

```yaml
work_unit_result:
  work_unit_id: required
  baseline_verified: required
  objective: required
  summary: required
  files_changed: required
  canonical_owners_reused: required
  contracts_or_behavior_added: required
  compatibility_evidence: required
  execution_boundary_evidence: required
  tests_added_or_updated: required
  validation_commands_and_exit_codes: required
  acceptance_criteria_evidence: required
  commit: required
  tag: required
  risk_score_0_to_100: required
  residual_findings: required
  next_action: required
```

Final M24 report must include:

1. Gate D report;
2. exact baseline;
3. Work Unit completion table;
4. final Work Unit execution-metadata shape;
5. workspace-assignment and cross-field self-consistency validation matrix;
6. parallel-policy and concurrency-group rules;
7. resource-claim normalization and conflict matrix;
8. active-status and dependency behavior;
9. pairwise eligibility examples;
10. deterministic batch examples;
11. status human/JSON output evidence;
12. handoff packet evidence;
13. planning/import/refinement evidence;
14. atomicity and runlog-recovery evidence;
15. historical compatibility matrix;
16. execution-boundary scan;
17. full validation and real-CI results;
18. files, commits, tags, PRs, and package version;
19. hazard-by-hazard residual risk;
20. exact final merge residual risk;
21. Gate E readiness;
22. confirmation that M25 was not started.

---

## 26. Gate E Readiness

M24 may declare Gate E open only when:

- historical Work Units remain serialized by default;
- valid metadata can be created through established planning paths;
- active Work Units are included in conflict analysis;
- graph dependencies cannot be bypassed;
- pairwise results are deterministic;
- recommended batch is deterministic and advisory;
- status reporting is read-only;
- handoff packets contain no physical workspace claim;
- no Git/workspace/provider/process/network surface exists;
- all compatibility fixtures pass;
- real CI is green;
- final merge residual risk is `<=12`.

Gate E output:

```yaml
gate_e_handoff:
  metadata_owner: WorkUnit
  workspace_assignment_type: logical_only
  parallel_eligibility: advisory_only
  physical_workspace_state: none
  git_mutation_surface: none
  execution_surface: none
  provider_surface: none
  next_milestone:
    id: M25
    title: Managed Workspace Provider Adapters
```

M24 must not implement M25.

---

## 27. Review Questions

1. Is execution metadata additive and owned by the existing Work Unit schema?
2. Do historical Work Units default to serialized rather than parallel?
3. Are logical assignment keys clearly separated from physical workspace paths and provider state?
4. Is `mode: none` with repository/path write or exclusive access rejected intrinsically before persistence?
5. Can an isolated assignment key be reused by multiple non-terminal Work Units?
6. Are all path claims repository-relative, segment-aware, and deterministic?
7. Does read/read remain compatible while write/exclusive conflicts?
8. Are direct and transitive dependencies checked through the existing graph owner?
9. Are active `in_progress` and `needs_review` Work Units considered?
10. Can `manual_review` ever enter the automatic batch?
11. Is pairwise reason ordering deterministic?
12. Is the advisory batch stable for identical state?
13. Does batch construction verify compatibility with every active and selected Work Unit?
14. Does `status --parallel` leave state and runlog unchanged?
15. Is existing status output unchanged without the flag?
16. Does the packet avoid claiming that a real workspace exists?
17. Can planning/import/refinement reject invalid metadata without partial mutation?
18. Is retry after runlog append failure idempotent?
19. Are eligibility results derived rather than persisted?
20. Are all metadata and output collections bounded?
21. Does M24 avoid Git mutation, workspace creation, process execution, network, providers, and scheduling?
22. Is schema version `0.5.0` preserved unless explicitly justified?
23. Is controlled risk `33`, entry risk `<=30`, and residual risk `<=12` evidenced?
24. Is Gate E prepared without starting M25?

Approval threshold:

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  implementation_entry_risk_maximum: 30
  merge_residual_risk_maximum: 12
  hidden_execution_surfaces: 0
  physical_workspace_state_added: 0
  implicit_parallel_defaults: 0
  historical_fixture_regressions: 0
```
