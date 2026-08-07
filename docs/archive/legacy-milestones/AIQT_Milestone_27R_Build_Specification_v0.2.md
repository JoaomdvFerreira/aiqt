# AIQT Milestone 27R Build Specification v0.2

## Agent-Agnostic External Execution Contract and Adapter Refactor

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Revised review candidate before implementation
  milestone:
    id: M27R
    title: Agent-Agnostic External Execution Contract and Adapter Refactor
    class: corrective_architecture_refactor
  baseline:
    product_version: 0.14.0
    development_baseline_commit: 58f16ad
    release_tag: v0.14.0
    milestone_tag: m27-claude-code-stream-json-adapter
    test_count: 2076
    schema_version: 0.5.0
    M27_merge_residual_risk: 15
    M27_adapter:
      id: claude-code-stream-json@1
      validation_level: synthetic_fixtures_only
      runtime_owned_by_AIQT: false
    CI:
      node_22: green
      node_24: green
    dependency_alerts:
      reported_pre_existing_high: 2
      introduced_by_M27: false
      verification_required: true
  risk:
    inherent_maximum: 100
    controlled_design_target: 30
    implementation_entry_maximum: 30
    core_merge_residual_maximum: 12
    milestone_merge_residual_maximum: 15
```

---

## 0. Position and Architectural Correction

M26 established a provider-neutral long-running execution protocol.

M27 then implemented a useful but provider-specific Claude Code adapter:

```text
Claude Code stream-json
  → Claude-specific parser and request model
  → M26 execution events
```

That adapter is technically valuable, but it is not the correct primary abstraction for AIQT. AIQT must remain agnostic to the coding agent selected and operated by the human.

M27R changes the architecture to:

```text
AIQT generic execution request
  → human runs any external coding agent
  → generic AIQT execution result
  → M26 execution session and iteration
```

Optional native adapters become translators at the edge:

```text
Claude Code stream-json
  → claude-code-stream-json@1
  → generic AIQT execution result

future Codex native output
  → future optional Codex adapter
  → generic AIQT execution result
```

The existing M27 implementation must be preserved and refactored, not discarded.

### 0.1 v0.2 review corrections

v0.2 resolves three build-readiness gaps:

1. defines the system-owned `sessionClientKey` used to create deterministic M26 generic-session identities;
2. defines exactly how new and legacy Claude adapter requests participate in generic cross-agent continuity;
3. tags every hazard as generic-core or retained/overall-only so both residual-risk rollups are independently reproducible.

### 0.2 Product capability after M27R

A human must be able to:

1. generate one bounded execution request for the current Work Unit;
2. give that request to Claude Code, Codex, Cursor, Copilot, a local agent, or another coding agent;
3. require the external agent to produce a small generic result document;
4. import that result into AIQT;
5. record one M26 iteration without AIQT understanding the agent’s native transcript or runtime;
6. use an optional native adapter when a supported agent provides a useful machine-readable format.

The generic contract is the product capability. Native adapters are optional convenience layers.

### 0.3 Explicit non-goals

M27R does not:

- add a Codex-native adapter;
- validate or control any external agent runtime;
- launch, supervise, authenticate, poll, cancel, resume, or roll back an agent;
- add process, shell, terminal, PTY, network, Git, or validation execution;
- create dynamic plugins or load project-controlled modules;
- treat agent success as Work Unit completion;
- implement M28.

### 0.4 M27 closure position

M27 remains a released optional Claude-specific adapter at `v0.14.0`.

Its synthetic-only producer validation is preserved as an explicit limitation:

```yaml
claude_adapter_maturity:
  status: experimental
  contract_validation: synthetic_only
  production_shape_validation: incomplete
```

M27R must not claim that the Claude adapter is validated against real producer output unless real captured fixtures are independently added and reviewed.

---

## 1. Gate R — Remediation Entry

Gate R is read-only. It creates no commit, tag, generated request, or `.aiqt/` development state.

### 1.1 Verify the baseline

Verify directly:

```yaml
branch: main
product_version: 0.14.0
development_baseline_commit: 58f16ad
release_tag: v0.14.0
milestone_tag: m27-claude-code-stream-json-adapter
tests: 2076
schema_version: 0.5.0
M27_mergeResidualRisk: 15
CI:
  node_22: green
  node_24: green
```

Verify the actual owners for:

- M26 sessions, iterations, transitions, budgets, decisions, stale state, receipts, and checkpoint integration;
- M27 adapter requests, Claude request generation, stream parser, normalization, import, status, review, and manage integration;
- M25 workspace references and release safeguards;
- corrected M26 packet-cancellation behavior;
- candidate-state writes, runlog ordering, canonical IDs, canonical JSON digests, file/stdin input, preview, JSON output, and exit codes;
- M22 evidence references;
- historical M22–M27 compatibility fixtures.

### 1.2 Architecture extraction audit

Gate R must document:

1. which M27 components are already provider-neutral;
2. which components contain Claude-specific semantics;
3. which code directly maps Claude output into M26;
4. which request-state fields can remain shared;
5. which existing commands and state shapes require compatibility preservation;
6. the smallest extraction that makes the generic contract authoritative;
7. the migration strategy for existing `v0.14.0` state;
8. the exact boundary between generic core and native adapters.

### 1.3 Dependency-alert disposition

Reverify the two reported pre-existing High devDependency alerts.

Implementation may proceed only when one of these is true:

```yaml
dependency_alert_disposition:
  - alerts_resolved
  - alerts_no_longer_present
  - explicit_repository_waiver_recorded
```

The waiver, when used, must identify:

- packages and advisories;
- why M27R does not worsen exposure;
- why remediation is deferred;
- compensating controls;
- expiry or review condition.

### 1.4 Gate R decision

Implementation may start only when:

```text
implementationEntryRisk <= 30
```

Stop when:

- the baseline differs materially;
- the existing Claude adapter cannot be preserved additively;
- generic result import would require changing M26 completion semantics;
- dynamic provider loading appears necessary;
- schema `0.5.0` cannot remain compatible without approval;
- High dependency alerts lack an approved disposition.

---

## 2. Objective and Boundaries

M27R must prove that AIQT can:

1. generate a provider-neutral execution request;
2. accept a provider-neutral result from any human-operated coding agent;
3. record opaque agent identity and optional external run/session references;
4. map one accepted generic result to exactly one M26 iteration;
5. support multiple iterations in one M26 session even when different external agents are used;
6. preserve replay, atomicity, checkpoint, workspace, packet, and evidence semantics;
7. refactor the Claude adapter to produce the generic result contract before M26 mapping;
8. preserve all existing M27 commands and historical state;
9. make the generic path the recommended default;
10. leave future native adapters optional and static.

M27R must not:

- require an agent-specific runtime, session format, transcript, or output stream;
- require a native adapter for normal use;
- infer provider identity from free text;
- persist raw prompts, responses, reasoning, source, diffs, logs, tool data, or credentials;
- elevate self-reported validation or evidence trust;
- modify Work Unit status outside existing checkpoint owners;
- implement a Codex-specific contract;
- implement M28.

---

## 3. Canonical Agent-Agnostic Contracts

M27R introduces these contracts:

```yaml
protocols:
  request: aiqt-external-execution-request@1
  result: aiqt-external-execution-result@1
  normalized_result: aiqt-normalized-execution-result@1
  adapter_interface: aiqt-external-agent-adapter@1
```

### 3.1 Static adapter registry

Exactly these adapters exist at M27R closure:

```yaml
adapters:
  - adapterId: generic-json@1
    role: canonical_default
    input: aiqt-external-execution-result@1
    maturity: stable

  - adapterId: claude-code-stream-json@1
    role: optional_native_translator
    input: supported_Claude_stream_json_subset
    maturity: experimental
    validation: synthetic_only
```

There is no:

- dynamic adapter loading;
- arbitrary module path;
- executable adapter;
- arbitrary provider command;
- project-defined parser;
- network-backed adapter discovery.

Future adapters must implement the same internal interface but require a separate reviewed milestone or extension.

### 3.2 Generic M26 session identity

Every new M27R execution session uses:

```yaml
M26_provider:
  providerId: external/agent
```

M27R introduces a system-owned stable key:

```yaml
GenericSessionClientKey:
  format: external/<uuid>
  generatedBy: AIQT
  persistedBeforeExport: true
  userSupplied: false
  mutable: false
```

The key is the `sessionClientKey` used by the existing M26 canonical identity tuple.

Rules:

- AIQT generates one UUID when a new generic execution session is created;
- the exact `external/<uuid>` value is persisted before any request bundle is written;
- retries after canonical-state success reuse the persisted key, M26 session, and active request;
- retries before canonical-state success may generate a new key because no canonical session exists yet;
- a resume request always reuses the targeted session’s existing `sessionClientKey`;
- an independent execution attempt for the same Work Unit, packet, and workspace requires a new generic session and therefore a new generated key;
- the key is identity data only and is never interpreted as a provider, command, path, credential, or external session ID;
- users and adapters cannot override it.

The M26 identity remains deterministic:

```text
same M26 identity tuple, including the persisted sessionClientKey
→ same executionSessionId

different generated sessionClientKey
→ distinct executionSessionId
```

The AIQT execution session remains stable even when the human uses different agents for separate iterations. Actual agent identity is recorded per imported request/result, not used as the M26 session owner.

Existing pre-M27R Claude-specific M26 sessions with `providerId: anthropic/claude-code` remain valid and are not migrated automatically.


### 3.3 Agent reference

```yaml
ExternalAgentRef:
  providerId: bounded_namespaced_string
  product: optional_bounded_string
  version: optional_bounded_string
  externalSessionId: optional_bounded_string
  externalRunId: optional_bounded_string
```

Rules:

- only `providerId` is required;
- syntactically valid unknown provider IDs are accepted;
- values are opaque metadata;
- values are never used to load code, resolve credentials, call a service, or execute a command;
- examples include `openai/codex`, `anthropic/claude-code`, `github/copilot`, and `custom/local-agent`, but none is privileged in the generic path.

### 3.4 Generic execution request

```yaml
ExternalExecutionRequest:
  protocolVersion: aiqt-external-execution-request@1
  requestId: canonical_request_id
  executionSessionId: canonical_M26_session_id
  sessionClientKey: external/<uuid>
  workUnitId: canonical_work_unit_id
  packetId: canonical_packet_id
  workspaceRef:
    mode: managed | none
    workspaceId: optional
    workspaceBindingId: optional
    workspaceGeneration: optional
  requestSequence: positive_integer
  objective: bounded_string
  packet:
    sourcePacketId: canonical_packet_id
    role: bounded_string
    scope: bounded_array
    outOfScope: bounded_array
    constraints: bounded_array
    acceptanceCriteria: bounded_array
    validationCommands: bounded_array
  expectedResultProtocol: aiqt-external-execution-result@1
  createdAt: timestamp
  expiresAt: timestamp
```

The export may include human/agent-readable instructions, but canonical identity is derived from the machine-readable request.

### 3.5 Generic execution result

```yaml
ExternalExecutionResult:
  protocolVersion: aiqt-external-execution-result@1
  requestId: canonical_request_id
  executionSessionId: canonical_M26_session_id
  agent: ExternalAgentRef
  resultClass: success | limited | unavailable | failed
  summary: bounded_string
  continuation:
    recommended: boolean
    reason: optional_bounded_string
  validationClaims: bounded_array
  commitRefs: bounded_array
  evidenceRefs: bounded_array
  rollbackClaim: optional
  reportedUsage: optional
```

Validation claims are self-reported:

```yaml
ValidationClaim:
  command: bounded_string
  status: passed | failed | not_run
  summary: optional_bounded_string
  trust: self_reported
```

Rules:

- no raw command output;
- no source code or diff;
- no arbitrary nested payload;
- evidence references must resolve through the existing evidence owner;
- self-reported validation never becomes repository-local or platform-verified evidence;
- rollback is advisory metadata only.

### 3.6 Normalized result

All adapters must output the same internal shape:

```yaml
NormalizedExternalExecutionResult:
  protocolVersion: aiqt-normalized-execution-result@1
  adapterId: bounded_static_adapter_id
  requestId: canonical_request_id
  executionSessionId: canonical_M26_session_id
  agent: ExternalAgentRef
  resultClass: success | limited | unavailable | failed
  summary: bounded_string
  continuation: bounded_object
  validationClaims: bounded_array
  commitRefs: bounded_array
  evidenceRefs: bounded_array
  rollbackClaim: optional
  reportedUsage: optional
  sourceDigest: sha256
```

Only the normalized result may enter the generic M26 mapping service.

Native adapters must not write M26 state directly.

---

## 4. Request State and Compatibility

M27R should reuse the existing optional collection:

```yaml
State:
  executionAdapterRequests: optional_array
```

It must remain valid for existing Claude requests.

The request record becomes additively provider-neutral:

```yaml
ExecutionAdapterRequest:
  id: canonical_request_id
  adapterId: generic-json@1 | claude-code-stream-json@1
  executionSessionId: canonical_M26_session_id
  sessionClientKey: optional_external_uuid_key
  workUnitId: canonical_work_unit_id
  packetId: canonical_packet_id
  workspaceRef: bounded_reference
  requestSequence: positive_integer
  status: requested | imported | expired | invalid
  requestDigest: sha256
  importedSourceDigest: optional_sha256
  importedIterationId: optional_canonical_iteration_id
  importedAgent: optional_ExternalAgentRef
  createdAt: timestamp
  expiresAt: timestamp
  importedAt: optional_timestamp
```

Rules:

- existing M27 records remain valid without new fields;
- `sessionClientKey` is required for new generic-session requests and optional only for historical M27 compatibility records;
- read-only commands do not materialize defaults;
- one M26 session has at most one active request;
- request sequences remain monotonic;
- retries reuse the active request;
- imported requests are immutable;
- request identity remains deterministic;
- no destructive migration is allowed;
- schema stays `0.5.0` unless explicitly approved otherwise.

Existing Claude-specific fields that cannot be generalized must remain optional compatibility fields and be isolated behind the Claude adapter.

---

## 5. Generic Request Export

### 5.1 Commands

```text
aiqt execution external request <work-unit-id>
aiqt execution external request <work-unit-id> --resume-session <session-id>
aiqt execution external request <work-unit-id> --preview
aiqt execution external request <work-unit-id> --output <path>
aiqt execution external request <work-unit-id> --json

aiqt execution external example
aiqt execution external example --json
```

### 5.2 Export bundle

The generated non-canonical bundle contains:

```text
request.json
instructions.md
result.example.json
result.schema.json
```

The bundle must explain:

1. AIQT does not run the agent;
2. the human may use any coding agent;
3. the agent must work only within the packet scope;
4. the agent must write a result conforming to `aiqt-external-execution-result@1`;
5. result success is not Work Unit completion;
6. checkpoint remains authoritative.

The bundle must not:

- include credentials or environment values;
- generate agent-specific commands by default;
- require a particular vendor;
- claim that an agent is installed or available;
- include raw historical transcripts.

### 5.3 Generic session behavior

For a first generic request:

1. verify there is no conflicting active request for the packet;
2. generate and persist a new system-owned `sessionClientKey` in the form `external/<uuid>`;
3. create or reuse the M26 session derived from that exact key with provider ID `external/agent`;
4. bind the current packet and workspace;
5. persist the adapter request before writing the export bundle.

Command retry behavior:

- when the state already contains the active request created by the same completed canonical operation, return the same request and bundle identity;
- do not generate a second M26 session merely because bundle writing or user display is retried;
- an explicit resume targets an existing session ID;
- a new independent attempt after terminal history creates a new generic session and generated key.

For a resume request:

- reuse the same generic M26 session and `sessionClientKey`;
- increment request sequence;
- allow a different `agent.providerId` in the next imported result;
- enforce M26 decision, budget, stale, iteration, packet, and workspace preconditions.

New M27R sessions created through either the generic request command or the refactored Claude adapter use `providerId: external/agent`.

Historical M27 Claude sessions with `providerId: anthropic/claude-code`:

- remain valid and resumable by the Claude adapter;
- are not migrated;
- cannot accept non-Claude adapter iterations;
- are excluded from the cross-agent continuity claim.


---

## 6. Generic Result Import

### 6.1 Commands

```text
aiqt execution external import --request <request-id> --from-file <path>
aiqt execution external import --request <request-id> --stdin
aiqt execution external import ... --preview
aiqt execution external import ... --json

aiqt execution external status
aiqt execution external status --session <session-id>
aiqt execution external status --request <request-id>
aiqt execution external status --json
```

Exactly one import transport is allowed.

### 6.2 Replay and atomicity

Identity:

```yaml
GenericImportIdentity:
  adapterId: generic-json@1
  requestId: canonical_request_id
  sourceDigest: sha256_of_exact_input_bytes
```

Rules:

- requested request + valid result → apply once;
- imported request + same digest → no-op;
- imported request + different digest → exit `3`;
- request/result/session mismatch → exit `3`;
- expired or invalid request → exit `2`;
- malformed or unknown fields → exit `3`;
- preview validates the full candidate state and writes nothing;
- any invalid reference rejects the entire import;
- state is written before runlog append;
- runlog failure returns exit `3`, with state authoritative and replay idempotent;
- raw source bytes are not persisted.

### 6.3 Result mapping

One valid result maps to exactly one M26 iteration:

| Generic result | M26 iteration | M26 session |
|---|---|---|
| `success` | completed | paused |
| `limited` | blocked | blocked |
| `unavailable` | failed | blocked |
| `failed` | failed | failed |

Always-applicable invariants:

- no result automatically completes the M26 session;
- no result completes the Work Unit;
- checkpoint remains authoritative;
- continuation recommendation is advisory;
- validation claims remain self-reported;
- commit references are unverified metadata;
- evidence references keep their existing trust;
- rollback claims are advisory only.

### 6.4 Agent switching

The generic path explicitly allows:

```text
AIQT execution session
  ├── iteration 1: openai/codex
  ├── iteration 2: anthropic/claude-code
  └── iteration 3: custom/local-agent
```

Rules:

- all iterations must belong to the same AIQT session, packet, Work Unit, and valid workspace lineage;
- each request has one imported agent reference;
- external agent session/run IDs may differ;
- AIQT does not infer continuity between vendor-specific sessions;
- continuity is owned by the AIQT execution session and packet.

---

## 7. Claude Adapter Refactor

The released Claude adapter remains available through its existing commands.

M27R must refactor its internal flow to:

```text
Claude stream-json
  → Claude parser and structural classifier
  → NormalizedExternalExecutionResult
  → generic result application service
  → M26 events and request finalization
```

It must no longer:

- own a separate M26 lifecycle mapper;
- write M26 state directly;
- define completion semantics separately from the generic path;
- duplicate replay, request, reference, runlog, or result-application logic.

### 7.1 New Claude requests after M27R

Every new Claude adapter session created after M27R uses:

```yaml
M26_provider:
  providerId: external/agent
sessionClientKey:
  ownership: AIQT
  format: external/<uuid>
requestAdapter:
  adapterId: claude-code-stream-json@1
importedAgent:
  providerId: anthropic/claude-code
```

Consequences:

- a new Claude adapter request participates in the same generic M26 identity space as Codex, Cursor, or another external agent;
- a Claude request may resume an eligible existing `external/agent` M26 session;
- a later generic or future native adapter request may resume that same generic session;
- the per-iteration `ExternalAgentRef` records which agent actually produced the imported result;
- Claude’s external session UUID remains adapter metadata and does not replace the AIQT `sessionClientKey`.

### 7.2 Legacy Claude compatibility

Existing pre-M27R Claude sessions with:

```yaml
providerId: anthropic/claude-code
```

remain valid.

They:

- retain their existing identity and state;
- remain resumable through the Claude adapter;
- continue to use existing Claude request records and source-digest behavior;
- are not automatically converted to `external/agent`;
- do not accept generic or non-Claude adapter iterations;
- are reported as `legacy_provider_specific_session` in bounded status/review metadata.

A new standalone Claude command must not create another provider-specific M26 session after M27R. Provider-specific session creation is historical compatibility behavior only.

### 7.3 Preserved Claude responsibilities

The Claude adapter may retain:

- stream-json parsing;
- supported message-family validation;
- synthetic fixture corpus;
- Claude-specific request export;
- structural result-subtype classification;
- provider-health normalization.

Those responsibilities must end at the normalized-result boundary.

Compatibility requirements:

- existing Claude CLI commands remain valid;
- existing Claude request records remain valid;
- existing fixtures and exit codes remain green;
- existing source-digest replay behavior remains;
- existing synthetic-only maturity remains visible;
- no real-producer validation claim is introduced;
- no Claude behavior becomes required for generic execution.


---

## 8. Status, Review, Manage, and External Setup

### 8.1 Status

Generic status must report:

- request/session/iteration state;
- adapter used;
- imported agent identity;
- continuation recommendation;
- self-reported validation summary;
- evidence and commit reference counts;
- request expiry;
- recommended next action.

Claude-specific health may appear only when the Claude adapter was used.

### 8.2 Review and manage

Reuse existing centralized owners.

Detect:

- broken request/session/packet/workspace references;
- multiple active requests;
- imported request without exactly one linked M26 iteration;
- generic result imported through the wrong adapter;
- unsupported adapter ID;
- raw provider content persisted;
- self-reported validation presented as verified evidence;
- terminal session with active request;
- stale or expired request;
- compatibility drift between generic and Claude result mapping.

### 8.3 Setup contract

The generic path requires no vendor integration.

AIQT must provide:

- a vendor-neutral request bundle;
- a generic result schema and example;
- concise instructions suitable for any external coding agent;
- a user-action checklist:
  1. select an agent;
  2. provide the request bundle;
  3. run the agent externally;
  4. save the generic result;
  5. import the result;
  6. continue or checkpoint based on AIQT status.

Optional native adapters may add separate setup instructions but cannot redefine the generic workflow.

---

## 9. Limits and Security

Minimum generic limits:

```yaml
input:
  max_bytes: 1048576
  max_json_depth: 20

result:
  max_summary_chars: 4000
  max_validation_claims: 50
  max_commit_refs: 100
  max_evidence_refs: 100
  max_continuation_reason_chars: 1000
  max_agent_field_chars: 256

requests:
  max_per_session: 100
  max_per_work_unit: 200
```

M27R must add zero new:

- process or child-process execution;
- shell, terminal, or PTY control;
- Git invocation;
- validation-command execution;
- network request or provider SDK;
- credential or authentication handling;
- dynamic import from project paths;
- provider polling, cancellation, or rollback;
- background scheduler.

All imported strings are data only.

Prohibited persistence includes:

- prompts;
- responses;
- reasoning;
- source;
- diffs;
- raw logs;
- tool inputs or outputs;
- secrets;
- credentials;
- tokens;
- billing data;
- arbitrary extension payloads.

---

## 10. Consolidated Exit-Code Contract

| Condition | Exit | Mutation |
|---|---:|---|
| Generic request generated | 0 | Yes |
| Request preview or example succeeds | 0 | No |
| Valid generic result imported | 0 | Yes |
| Identical replay | 0 | No |
| Read-only status succeeds | 0 | No |
| Existing review semantics produce findings | 1 | No |
| M26/session/workspace/decision/budget/stale precondition blocks request | 2 | No |
| Request expired or invalid | 2 | No |
| Generic limit reached | 2 | No |
| Malformed result or unsupported protocol | 3 | No |
| Request/session/packet/workspace mismatch | 3 | No |
| Source digest conflict | 3 | No |
| Unknown adapter or prohibited field | 3 | No |
| Both or neither import transports supplied | 3 | No |
| State succeeds but runlog append fails | 3 | State remains authoritative |
| Required input absent | 10 | No |

No generic result failure is a quality-gate exit `1`.

---

## 11. Work Units

### WU27R-01 — Gate R and Extraction Plan

- verify baseline and dependency-alert disposition;
- map generic versus Claude-specific ownership;
- approve migration and compatibility plan;
- calculate implementation-entry risk.

Suggested tag:

```text
m27r-wu01-gate-extraction-plan
```

### WU27R-02 — Generic Contracts and Static Adapter Boundary

- generic request, result, normalized result, and agent-reference schemas;
- static adapter registry;
- provider-neutral request-state additions;
- identity, caps, and historical compatibility.

Suggested tag:

```text
m27r-wu02-generic-contracts
```

### WU27R-03 — Generic Request Export

- generic session/request creation;
- request bundle;
- vendor-neutral instructions, example, and schema;
- preview, JSON, and output behavior.

Suggested tag:

```text
m27r-wu03-generic-request-export
```

### WU27R-04 — Generic Result Import and M26 Mapping

- generic JSON validation;
- replay and candidate-state atomicity;
- normalized-result application service;
- iteration/session mapping;
- agent switching;
- runlog ordering.

Suggested tag:

```text
m27r-wu04-generic-result-import
```

### WU27R-05 — Claude Adapter Refactor and Compatibility

- route Claude normalization through the generic application service;
- preserve existing commands, fixtures, state, and exit codes;
- remove duplicate M26 mapping;
- expose experimental/synthetic-only maturity.

Suggested tag:

```text
m27r-wu05-claude-adapter-refactor
```

### WU27R-06 — Hardening, Validation, and Closure

- M22–M27 compatibility;
- generic flows using at least three opaque agent IDs;
- cross-agent iteration lifecycle;
- raw-content and boundary scans;
- failure injection;
- clean clone, real CI, versioning, risk reconciliation, and Gate H.

Suggested tag:

```text
m27r-wu06-final-validation
```

Each Work Unit requires:

- one bounded implementation;
- focused tests;
- relevant validation;
- one detailed commit;
- one annotated tag;
- `Risk: N/100` in the commit body;
- structured report.

Continue automatically between Work Units. Do not combine them without explicit approval.

Preferred milestone tag:

```text
m27r-agent-agnostic-execution-contract
```

---

## 12. Risk Register

### 12.1 Scoring convention

M27R uses the roadmap formula:

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

### 12.2 Hazards

`Risk set` determines the rollups:

- `core` contributes to both `coreMergeResidualRisk` and `milestoneMergeResidualRisk`;
- `overall-only` contributes only to `milestoneMergeResidualRisk`.

| ID | Risk set | Hazard | Probability | Impact | Inherent | Required control | Controlled | Entry target | Residual target |
|---|---|---|---|---|---:|---|---:|---:|---:|
| M27R-R01 | core | Generic contract still embeds Claude assumptions | High | High | 75 | vendor-neutral schemas; opaque agent refs; generic-first tests | 25 | 25 | 10 |
| M27R-R02 | core | Native adapter bypasses generic application semantics | High | High | 75 | one normalized-result service; no direct M26 writes | 30 | 30 | 12 |
| M27R-R03 | overall-only | Existing Claude states or commands break | High | High | 75 | additive schema; compatibility fixtures; no destructive migration | 30 | 30 | 12 |
| M27R-R04 | core | Agent switching corrupts session continuity | Medium | High | 50 | AIQT-owned generic session and stable system-owned sessionClientKey; per-request agent identity | 25 | 25 | 10 |
| M27R-R05 | core | Self-reported validation is treated as verified evidence | High | Critical | 100 | explicit trust level; evidence-owner reuse; review findings | 30 | 30 | 12 |
| M27R-R06 | core | Raw agent content enters canonical state | High | Critical | 100 | strict schema; unknown-field rejection; persistence scans | 30 | 30 | 10 |
| M27R-R07 | core | Generic replay imports one result twice | Medium | High | 50 | exact request/source digest; candidate state; immutable imported request | 25 | 25 | 10 |
| M27R-R08 | core | Result binds to wrong Work Unit, packet, workspace, or session | High | High | 75 | exact cross-reference validation | 30 | 30 | 12 |
| M27R-R09 | core | Generic agent identity becomes executable configuration | Medium | Critical | 67 | opaque data only; static registry; no dynamic loading | 17 | 17 | 8 |
| M27R-R10 | core | Provider success completes session or Work Unit | Medium | High | 50 | shared result mapping; checkpoint-only completion | 25 | 25 | 10 |
| M27R-R11 | overall-only | Claude synthetic-only limitation is hidden or understated after refactor | Medium | High | 50 | explicit experimental maturity; no production-shape claim; status visibility | 25 | 25 | 15 |
| M27R-R12 | core | Generic request bundle leaks secrets or excessive context | Medium | Critical | 67 | packet-bounded export; no environment/credential capture | 25 | 25 | 10 |
| M27R-R13 | core | State/runlog failure breaks replay consistency | Medium | High | 50 | state authority; direct failure injection | 25 | 25 | 12 |
| M27R-R14 | core | M25/M26 safety behavior regresses | Medium | High | 50 | direct checkpoint/workspace/packet-cancel regressions | 25 | 25 | 10 |
| M27R-R15 | core | Optional native adapters become mandatory for generic use | Medium | High | 50 | `generic-json@1` canonical default; no provider dependency | 17 | 17 | 8 |
| M27R-R16 | overall-only | Pre-existing High dependency alerts are silently inherited | Medium | High | 50 | Gate R resolution or explicit bounded waiver | 25 | 25 | 12 |
| M27R-R17 | core | Generic state grows without bound | Medium | High | 50 | request/result caps and bounded summaries | 25 | 25 | 12 |
| M27R-R18 | core | M27R introduces runtime, shell, network, or Git behavior | Low | Critical | 33 | static boundary scans and negative tests | 8 | 8 | 5 |
| M27R-R19 | core | Independent attempts collide because generic sessionClientKey is absent, reused, or user-controlled | High | High | 75 | AIQT-generated immutable `external/<uuid>` persisted before export; retry reuse tests | 25 | 25 | 10 |
| M27R-R20 | core | New Claude requests remain in a provider-specific identity space and break cross-agent continuity | High | High | 75 | all new adapter sessions use `external/agent`; legacy sessions isolated explicitly | 25 | 25 | 10 |


### 12.3 Derived risk

```text
inherentRiskMaximum =
  max(Inherent across all rows)
  = 100

controlledDesignRisk =
  max(Controlled across all rows)
  = 30

implementationEntryRisk =
  max(current open hazard after Gate R)
  must be <= 30

coreMergeResidualRisk =
  max(final residual where Risk set = core)
  must be <= 12

milestoneMergeResidualRisk =
  max(final residual across all rows)
  must be <= 15
```

The approved design targets are independently reproducible:

```yaml
core_residual_target_maximum: 12
overall_only_residual_target_maximum: 15
milestone_residual_target_maximum: 15
```

Work Unit scores are point-in-time assessments and do not replace hazard-level closure risk.


---

## 13. Definition of Done

M27R is complete only when:

- Gate R passes;
- dependency alerts have an approved disposition;
- `generic-json@1` is the canonical default adapter;
- any external agent can fulfill a generic request without a native adapter;
- every new generic session has an AIQT-generated immutable `external/<uuid>` sessionClientKey persisted before export;
- independent attempts receive distinct sessionClientKeys while retries reuse canonical state;
- all new generic and native-adapter M26 sessions use `external/agent`;
- historical Claude provider-specific sessions remain valid but are explicitly excluded from agent switching;
- per-request agent identity is opaque and supports agent switching;
- one accepted result maps to exactly one M26 iteration;
- all result classes use one shared generic mapper;
- provider success never completes the session or Work Unit;
- self-reported validation remains self-reported;
- raw agent content is never persisted;
- generic replay and atomicity are proven;
- the Claude adapter routes through the generic normalized-result boundary;
- existing Claude commands, state, fixtures, and exit codes remain compatible;
- Claude synthetic-only maturity remains disclosed;
- corrected packet cancellation, checkpoint, and workspace release behavior remains intact;
- no process, shell, terminal, PTY, network, SDK, auth, Git, validation execution, polling, cancellation, or rollback surface exists;
- schema remains `0.5.0` unless explicitly approved otherwise;
- all six Work Units are committed, tagged, validated, and risk-scored;
- clean clone and real CI pass;
- generic core residual risk is at most `12`;
- overall milestone residual risk is at most `15`;
- Gate H is reopened for M28;
- M28 was not started.

---

## 14. Review Questions and Approval Threshold

1. Is the generic request/result contract usable without Claude Code or another native adapter?
2. Can Codex or any other agent produce the generic result using only the exported schema and instructions?
3. Is `generic-json@1` the canonical default?
4. Does every new generic M26 session receive an AIQT-generated immutable `external/<uuid>` sessionClientKey?
5. Do retries reuse persisted session identity while independent attempts receive distinct keys?
6. Are users and adapters unable to override the sessionClientKey?
7. Are native adapters static optional translators only?
8. Does every adapter terminate at one normalized-result boundary?
9. Is there exactly one service mapping normalized results into M26?
10. Do all new generic and Claude-adapter sessions use `providerId: external/agent`?
11. Can new Claude requests resume an eligible generic session and can another agent contribute a later iteration?
12. Are historical `anthropic/claude-code` sessions preserved but explicitly excluded from agent switching?
13. Can different agents contribute separate iterations to one generic M26 session?
14. Are actual agent IDs opaque per-request metadata?
15. Are existing Claude states and commands preserved?
16. Is Claude synthetic-only validation still disclosed?
17. Are self-reported validation claims prevented from gaining evidence trust?
18. Are prompts, responses, reasoning, source, diffs, logs, and tool payloads excluded?
19. Are request/result replay and atomicity deterministic?
20. Does provider success remain separate from session and Work Unit completion?
21. Are checkpoint, workspace release, and packet cancellation preserved?
22. Are dynamic adapters, executable configuration, SDKs, and network calls absent?
23. Are generic request and state limits explicit?
24. Is the dependency-alert disposition explicit?
25. Is schema `0.5.0` preserved additively?
26. Can the core and milestone residual-risk rollups be independently recomputed from the `Risk set` column?
27. Is generic core residual risk at most `12/100`?
28. Is overall residual risk at most `15/100`?
29. Is Gate H reopened without M28 implementation?

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  generic_adapter_is_default: true
  native_adapter_required_for_generic_use: false
  sessionClientKey_owner: AIQT
  sessionClientKey_user_override_surfaces: 0
  retry_identity_duplication_paths: 0
  independent_attempt_identity_collision_paths: 0
  new_native_adapter_provider_specific_session_paths: 0
  generic_cross_agent_session_supported: true
  legacy_Claude_sessions_auto_migrated: false
  normalized_result_application_owners: 1
  direct_native_adapter_M26_writers: 0
  dynamic_adapter_loading_surfaces: 0
  process_surfaces: 0
  shell_terminal_PTY_surfaces: 0
  network_SDK_auth_surfaces: 0
  Git_or_validation_execution_surfaces: 0
  raw_agent_payload_persistence_paths: 0
  self_reported_to_verified_evidence_escalation_paths: 0
  partial_import_mutations: 0
  historical_M22_M27_regressions: 0
  dependency_alerts_without_disposition: 0
  risk_rows_without_set_classification: 0
  core_merge_residual_risk_maximum: 12
  milestone_merge_residual_risk_maximum: 15
  M28_implementation_surfaces: 0
```

---

## 15. Gate H Handoff

Gate H reopens only after M27R closure.

```yaml
gate_h_handoff:
  execution_protocol: long-running-execution-protocol@1
  generic_request: aiqt-external-execution-request@1
  generic_result: aiqt-external-execution-result@1
  normalized_result: aiqt-normalized-execution-result@1
  canonical_adapter: generic-json@1
  optional_adapters:
    - adapterId: claude-code-stream-json@1
      maturity: experimental
      validation: synthetic_only
  provider_runtime_inside_AIQT: none
  completion_authority: checkpoint
  next_milestone:
    id: M28
    title: Evidence Gate Simulation
```

M27R must not implement M28.
