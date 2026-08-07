# AIQT Milestone 26 Build Specification v0.3

## Long-Running Execution Protocol

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.3
  status: Revised lean review candidate before build handoff
  milestone:
    id: M26
    title: Long-Running Execution Protocol
  baseline:
    product_version: 0.12.0
    product_release_tag: v0.12.0
    development_baseline_commit: 76f6730
    milestone_tag: m25-managed-workspace-provider-adapters
    test_count: 1838
    schema_version: 0.5.0
    m25_merge_residual_risk: 15
    gate_f_status: open
    verification_required: true
  protocol: long-running-execution-protocol@1
  architecture_role: provider-neutral metadata protocol
  risk:
    inherent: 50
    controlled_design_target: 33
    implementation_entry_maximum: 30
    merge_residual_maximum: 12
```

---

## 0. v0.2 Position and Change Summary

M25 created bounded local workspaces. M26 records the lifecycle of longer external coding-agent execution without running the agent itself.

```text
current Work Unit
+ current packet
+ workspace context
+ external provider identity
+ imported protocol events
→ canonical execution-session metadata
```

M26 is intentionally **metadata-only**:

- AIQT records sessions, iterations, budgets, decisions, summaries, and references.
- The external agent or execution system performs the work.
- Checkpoint remains the only owner of Work Unit completion.
- M27 may later map a real provider into this protocol.

v0.2 replaced the large v0.1 implementation handbook with a lean product contract. v0.3 preserves that lean format while restoring the independently verifiable controls identified during review.

v0.3 changes:

1. restores a complete per-hazard risk table with Probability, Impact, Inherent, Controlled, Entry target, and Residual target;
2. adds a consolidated exit-code contract;
3. adds compact review questions and a machine-checkable approval threshold;
4. makes terminal-session grace-window evaluation deterministic through `--as-of`;
5. adds `planned → failed` for sessions that fail before first execution;
6. keeps the six-Work-Unit structure and avoids restoring repeated implementation boilerplate.

The load-bearing contracts retained here are:

1. session identity and lifecycle;
2. atomic event import and replay protection;
3. iterations, budgets, decisions, and stale handling;
4. checkpoint, workspace, and packet safety;
5. bounded state and privacy constraints;
6. compatibility, risks, validation, and Gate G.

---

## 1. Baseline and Gate F

Gate F is a read-only pre-build audit. It creates no commit, tag, or `.aiqt/` development state.

Verify, rather than assume:

```yaml
expected_baseline:
  branch: main
  product_version: 0.12.0
  release_tag: v0.12.0
  development_commit: 76f6730
  milestone_tag: m25-managed-workspace-provider-adapters
  tests: 1838
  schema_version: 0.5.0
  m25_merge_residual_risk: 15
  critical_high_dependency_alerts: 0
```

Gate F must identify the actual repository owners for:

- Work Unit statuses, current Work Unit, packet identity/history, checkpoint preconditions, `next cancel`, and centralized next-action guidance;
- M25 workspace records, bindings, release preconditions, and workspace status;
- evidence-reference validation;
- state/candidate-state writing, runlog, canonical IDs, canonical JSON digest, file/stdin input, preview, JSON output, and exit codes;
- review, manage, and status integration;
- historical M22–M25 compatibility fixtures.

Gate F must also:

- document a real need for one packet to span multiple external iterations or context windows;
- confirm that a metadata protocol is sufficient and no provider runtime is required;
- resolve the M25 closure-report inconsistency over the exact authorized Git-runner subcommand count;
- carry forward M25-R16 by requiring direct M26 state-write/runlog-failure tests;
- confirm that M26 adds no process, shell, Git, network, provider adapter, or validation execution.

Risk rule:

```text
implementationEntryRisk =
  max(current score of every open M26 hazard after Gate F controls)
```

Implementation may begin only when:

```text
implementationEntryRisk <= 30
```

Stop before implementation if the need cannot be justified, additive compatibility cannot be preserved, or the protocol would require execution/provider behavior.

---

## 2. Objective and Boundaries

M26 must prove that AIQT can:

1. bind one execution session to a project, Work Unit, packet, workspace context, and opaque provider identity;
2. preserve multiple historical sessions while allowing at most one non-terminal session per packet;
3. import bounded event batches from file or stdin;
4. apply each batch atomically and idempotently;
5. reject replay conflicts and invalid transitions without mutation;
6. record multiple iterations without confusing iteration, session, and Work Unit completion;
7. record optional budgets, human decisions, stale state, commit/evidence references, learning summaries, and provider-reported rollback metadata;
8. block checkpoint, workspace release, or packet cancellation when execution history makes those actions unsafe;
9. expose execution state through read-only status, review, and manage surfaces;
10. preserve legacy projects and current M22–M25 behavior.

M26 must not:

- invoke or supervise a coding agent;
- spawn a process or terminal;
- execute validation commands or Git;
- call, authenticate, poll, cancel, or roll back a provider;
- store credentials, billing data, raw prompts, transcripts, logs, diffs, or source files;
- change Work Unit status outside existing owners;
- implement M27.

Provider identity is opaque metadata:

```yaml
ExecutionProviderRef:
  providerId: bounded_namespaced_string
  externalSessionId: optional_bounded_string
```

`providerId` syntax:

```text
^[a-z0-9][a-z0-9._/-]{0,127}$
```

Unknown valid provider IDs are allowed. AIQT does not load or interpret them.

---

## 3. Canonical Contracts

M26 adds one optional state field:

```yaml
State:
  executionSessions: optional_array
```

Historical states without this field remain valid and read-only commands must not materialize it.

### 3.1 Execution session

```yaml
ExecutionSession:
  id: canonical_session_id
  protocolVersion: long-running-execution-protocol@1
  sessionClientKey: bounded_stable_key
  provider: ExecutionProviderRef
  workUnitId: canonical_work_unit_id
  packetId: canonical_packet_id
  workspaceRef:
    mode: managed | none
    workspaceId: optional
    workspaceBindingId: optional
    workspaceGeneration: optional
  status:
    - planned
    - running
    - paused
    - blocked
    - stale
    - failed
    - completed
    - cancelled
  budgets: optional
  budgetState: not_configured | within | reached | exceeded
  stopCondition: optional
  iterations: bounded_array
  decisions: bounded_array
  rollbackRecords: bounded_array
  commitRefs: bounded_array
  evidenceRefs: bounded_array
  learningSummary: optional_bounded_string
  statusTransitions: bounded_array
  eventReceipts: bounded_array
  createdAt: timestamp
  updatedAt: timestamp
  lastActivityAt: timestamp
  staleAt: optional_timestamp
  terminalAt: optional_timestamp
```

Core invariants:

- session status is independent from Work Unit status;
- iteration completion does not complete a session;
- session completion does not complete a Work Unit;
- terminal sessions are never reopened;
- raw provider payloads are not persisted;
- summaries and references are advisory metadata;
- one packet may have multiple terminal historical sessions but at most one non-terminal session;
- canonical state remains bounded.

### 3.2 Workspace binding

For M24 mode `shared` or `isolated`:

```yaml
workspaceRef:
  mode: managed
  workspaceId: required
  workspaceBindingId: required
  workspaceGeneration: required
```

For M24 mode `none`:

```yaml
workspaceRef:
  mode: none
```

At session open:

- managed references must resolve to an active M25 binding for the same Work Unit;
- the workspace must be ready and the generation must match;
- `none` is valid only for a Work Unit whose execution metadata uses workspace mode `none`;
- historical references remain after workspace release.

### 3.3 Session identity

Session identity is SHA-256 over canonical JSON containing:

```yaml
- projectId
- workUnitId
- packetId
- workspaceMode
- workspaceIdOrNone
- workspaceGenerationOrZero
- providerId
- sessionClientKey
```

Rules:

- same tuple → same session ID;
- duplicate open of the same active session → no-op;
- conflicting immutable fields → exit `3`;
- a retry after terminal state requires a new `sessionClientKey`;
- `sessionClientKey` must be stable, bounded, and treated only as data.

### 3.4 Iterations and decisions

```yaml
ExecutionIteration:
  id: canonical_iteration_id
  providerIterationKey: bounded_stable_key
  sequence: AIQT_assigned_positive_integer
  status: running | completed | failed | blocked | cancelled
  objectiveSummary: optional
  resultSummary: optional
  startedAt: timestamp
  finishedAt: optional
  reportedTokens: optional_non_negative_integer
  reportedDurationSeconds: optional_non_negative_integer
  commitRefs: bounded_array
  evidenceRefs: bounded_array
```

At most one iteration may be running per session.

```yaml
ExecutionDecision:
  id: canonical_decision_id
  providerDecisionKey: bounded_stable_key
  status: open | resolved
  title: bounded_string
  question: bounded_string
  contextSummary: optional
  options: bounded_array
  requestedAt: timestamp
  resolvedAt: optional
  selectedOption: optional
  resolutionSummary: optional
```

An open decision:

- places a non-terminal session in `blocked`;
- blocks new iterations and checkpoint;
- appears as user action in manage/review.

Resolving a decision does not automatically resume the session.

### 3.5 Budgets, summaries, and references

Optional budgets:

```yaml
ExecutionBudgets:
  maxIterations: 1..100
  maxTokens: 1..1000000000
  maxDurationSeconds: 1..604800
  staleAfterSeconds: 60..2592000
```

Usage is recomputed from canonical iterations. Reaching or exceeding a budget blocks further iteration starts. AIQT does not stop an external process.

Commit references are metadata only and do not prove Git existence. Evidence references must resolve through the existing M22/M23 evidence owner and do not elevate trust.

`learningSummary` is advisory text, maximum 4000 characters. It must not modify requirements, decisions, constraints, acceptance criteria, or checkpoint results.

Provider-reported rollback records are unverified historical metadata only. They never execute Git or alter a workspace.

---

## 4. Lifecycle and Event Import

### 4.1 Session transitions

```yaml
planned:
  - running
  - failed
  - cancelled
  - stale

running:
  - paused
  - blocked
  - failed
  - completed
  - cancelled
  - stale

paused:
  - running
  - blocked
  - failed
  - cancelled
  - stale

blocked:
  - running
  - paused
  - failed
  - cancelled
  - stale

stale:
  - running
  - paused
  - blocked
  - failed
  - cancelled

failed: []
completed: []
cancelled: []
```

Rules:

- `planned → failed` represents a provider-side failure before the first iteration starts;
- `cancelled` remains reserved for deliberate cancellation rather than startup failure;
- terminal sessions never transition;
- `stale → completed` is prohibited;
- every status change requires an explicit bounded reason;
- `completed` is invalid while an iteration is running or a decision remains open;
- no event implicitly finishes an iteration;
- terminal session status describes external execution only, not acceptance.

### 4.2 Import command

```text
aiqt execution import --from-file <path>
aiqt execution import --stdin
aiqt execution import --from-file <path> --preview
aiqt execution import --stdin --preview
aiqt execution import ... --as-of <ISO_TIMESTAMP>
aiqt execution import ... --json
aiqt execution import --example
```

Exactly one input mode is allowed.

Envelope:

```yaml
ExecutionProtocolEnvelope:
  protocolVersion: long-running-execution-protocol@1
  providerId: bounded_namespaced_string
  sessionClientKey: bounded_stable_key
  events: array_1_to_100
```

Supported events:

```text
session.opened
session.status_changed
session.budget_updated
iteration.started
iteration.finished
decision.requested
decision.resolved
rollback.reported
session.summary_updated
session.references_added
```

Unknown event types are invalid.

### 4.3 Replay, ordering, and atomicity

Event identity is scoped by:

```yaml
- providerId
- sessionClientKey
- eventId
```

Digest is SHA-256 over canonical normalized event JSON.

Rules:

- same scoped ID + same digest → no-op;
- same scoped ID + different digest → exit `3`, no mutation;
- different IDs + identical content → distinct events;
- events are applied in array order to one candidate state;
- any invalid event rejects the entire envelope;
- preview validates the complete candidate state but writes nothing;
- state is atomically written before bounded runlog events are appended;
- runlog failure after state success returns exit `3`; state remains authoritative and replay remains idempotent;
- full no-op replay creates no runlog event;
- raw event payload is not persisted.

A session-open event requires:

- current Work Unit exists and is `in_progress`;
- packet is current and has no checkpoint;
- workspace reference is valid;
- no other non-terminal session exists for the packet.

Terminal sessions may accept only summary/reference updates for seven days after `terminalAt`. No status, iteration, decision, budget, or rollback mutation is allowed after terminal state.

Grace-window evaluation uses:

```text
effectiveNow = --as-of when supplied, otherwise the current clock
```

Rules:

- `--as-of` applies to all time-dependent import validation;
- tests at, before, and after the seven-day boundary must use explicit `--as-of`;
- the exact boundary is inclusive through `terminalAt + 7 days`;
- after that instant, summary/reference updates are rejected with exit `2`;
- `--as-of` is validation context only and is not persisted.

### 4.4 Stale detection

```text
aiqt execution stale
aiqt execution stale --preview
aiqt execution stale --apply
aiqt execution stale --as-of <ISO_TIMESTAMP>
aiqt execution stale --apply --as-of <ISO_TIMESTAMP>
aiqt execution stale ... --json
```

Default without `--apply` is preview.

A non-terminal session becomes eligible when its configured stale deadline has passed. Apply transitions it to `stale` and records `stale_timeout`; it does not cancel the provider, release a workspace, or change the Work Unit.

Tests must use explicit `--as-of` for deterministic time behavior.

---

## 5. Integration Contracts

### 5.1 Checkpoint

Checkpoint is blocked with exit `2` while the current packet has:

- a non-terminal execution session;
- an open decision;
- a running iteration.

Checkpoint may proceed when no session exists or all sessions are terminal with no open decision.

Checkpoint:

- remains authoritative for acceptance, validation, issues, and final Work Unit status;
- may add optional `executionSessionIds`;
- never rewrites session history.

### 5.2 Workspace release

M25 workspace release is blocked with exit `2` while the workspace is referenced by a non-terminal session.

Terminal sessions do not block explicit release. Historical references remain unchanged. M26 adds no Git or filesystem behavior.

### 5.3 Packet cancellation

`aiqt next cancel` is blocked when **any** execution session exists for the current packet, including terminal history. Durable execution history must not be invalidated by cancelling the packet.

### 5.4 Status, review, and manage

```text
aiqt execution status
aiqt execution status --session <id>
aiqt execution status --work-unit <id>
aiqt execution status --json
```

This command is read-only and reports bounded session lifecycle, usage, decisions, iterations, references, stale deadline, and recommended execution action.

Existing `aiqt status` may add an execution summary only when sessions exist.

Review must detect:

- broken Work Unit, packet, workspace, or evidence references;
- multiple non-terminal sessions for one packet;
- terminal session with a running iteration;
- stale sessions;
- open decisions;
- budget stop conditions;
- terminal sessions awaiting checkpoint;
- provider-reported rollback as unverified advisory metadata.

Manage must reuse the existing centralized classification owner and include active/stale sessions, open decisions, budget state, terminal sessions awaiting checkpoint, and recommended action.

No session field means legacy status, review, and manage behavior remains unchanged.

---

## 6. Consolidated Exit-Code Contract

M26 uses the established AIQT exit-code owner.

| Condition | Exit | Mutation |
|---|---:|---|
| Successful import, stale apply, or valid read-only status | 0 | Expected or none |
| Valid preview | 0 | None |
| Full replay with identical event digests | 0 | None |
| Duplicate session open resolving to the same active session | 0 | None |
| Review or quality finding produced by existing review semantics | 1 | None |
| Active session blocks checkpoint, workspace release, or packet cancel | 2 | None |
| Open decision, running iteration, stale state, or budget stop blocks progression | 2 | None |
| State/session/input cap reached | 2 | None |
| Terminal grace window expired for a summary/reference update | 2 | None |
| No stale session eligible during `stale --apply` | 2 | None |
| Invalid event type, transition, reference, digest conflict, or immutable-field conflict | 3 | None |
| Malformed JSON, unsupported protocol version, invalid timestamp, or invalid state | 3 | None |
| Both or neither import input modes supplied | 3 | None |
| Runlog append fails after successful state write | 3 | State remains authoritative |
| Required input absent in an interactive/no-input command path | 10 | None |

Additional rules:

- exit `1` is not used for protocol-structure errors;
- exit `2` represents a valid but currently blocked operation;
- exit `3` represents invalid input, state, protocol, or integrity conflict;
- a failed envelope never partially mutates state;
- read-only and preview commands never append runlog events.

---

## 7. Limits, Security, and Compatibility

Minimum limits:

```yaml
input:
  max_bytes: 1048576
  max_json_depth: 20
  max_events_per_envelope: 100

state:
  max_sessions: 1000
  max_sessions_per_work_unit: 20
  max_non_terminal_sessions_per_packet: 1
  max_iterations_per_session: 100
  max_decisions_per_session: 20
  max_open_decisions_per_session: 5
  max_rollback_records_per_session: 50
  max_commit_refs_per_session: 100
  max_evidence_refs_per_session: 100
  max_status_transitions_per_session: 100
  max_event_receipts_per_session: 500
  max_serialized_session_bytes: 262144
```

Reaching a cap blocks mutation with exit `2`. M26 does not prune, compact, or archive automatically.

M26 must add zero new:

- process or child-process execution;
- shell or terminal control;
- Git invocation;
- network request or provider SDK;
- dynamic provider import;
- validation-command execution;
- scheduler or background worker;
- automatic rollback/cancellation;
- secret, prompt, transcript, log, diff, or source-code persistence.

All imported strings are data only and must never be interpreted as commands, paths, module names, or environment-variable names.

Compatibility requirements:

- M22 evidence semantics unchanged;
- M23 evidence import unchanged;
- M24 logical execution metadata and parallel eligibility unchanged;
- M25 workspace lifecycle and Git boundary unchanged;
- packet, readiness, checkpoint, issue, review, manage, and export owners preserved;
- historical state without `executionSessions` remains valid;
- no read-time materialization;
- schema version remains `0.5.0` unless additive compatibility is proven impossible and explicit approval is obtained.

---

## 8. Work Units and Validation

M26 uses six cohesive Work Units rather than nine artificial implementation slices.

### WU26-01 — Session Schema, Identity, and Core Lifecycle

Includes:

- optional session state;
- provider/workspace references;
- deterministic identity;
- status transitions;
- terminal immutability;
- limits and historical compatibility.

Suggested tag:

```text
m26-wu01-session-schema-lifecycle
```

### WU26-02 — Event Import and Atomic Replay Engine

Includes:

- event envelope and supported event schemas;
- file/stdin/example/preview CLI;
- canonical digests and receipts;
- candidate-state batch application;
- replay/no-op/conflict behavior;
- direct state-write and runlog-failure injection.

Suggested tag:

```text
m26-wu02-event-import-atomicity
```

### WU26-03 — Iterations, Budgets, Decisions, and Stale Handling

Includes:

- iteration lifecycle;
- usage and budget gates;
- human-decision lifecycle;
- stale preview/apply;
- stop conditions;
- commit/evidence/summary/rollback metadata.

Suggested tag:

```text
m26-wu03-execution-controls
```

### WU26-04 — Workflow Safety and Visibility Integration

Includes:

- checkpoint preconditions and session references;
- workspace-release and packet-cancel safeguards;
- execution status;
- existing status/review/manage integration;
- centralized classification reuse.

Suggested tag:

```text
m26-wu04-workflow-integration
```

### WU26-05 — Compatibility, Security, and Failure Hardening

Includes:

- M22–M25 regressions;
- malformed/cross-reference/cap cases;
- concurrent/replay consistency;
- byte-equivalent legacy behavior;
- execution-boundary scans;
- privacy/non-persistence assertions.

Suggested tag:

```text
m26-wu05-protocol-hardening
```

### WU26-06 — Full Validation and Closure

Includes:

- clean clone and frozen install;
- complete multi-iteration disposable-project lifecycle;
- explicit stale time;
- checkpoint/workspace/cancel safeguards;
- failure injection;
- versioning and real CI;
- hazard-level residual risk and Gate G.

Suggested tag:

```text
m26-wu06-final-validation
```

### 8.1 Required validation categories

Implementation must cover, without requiring a test case list in this specification:

1. schema, identity, transition, and reference integrity;
2. event replay, conflict, ordering, preview, and atomic batch behavior;
3. iteration, budget, decision, summary, evidence, and rollback semantics;
4. stale detection with explicit time;
5. checkpoint, workspace, packet, status, review, and manage integration;
6. caps, malformed input, privacy, historical compatibility, and non-materialization;
7. state-write/runlog failure ordering and idempotent retry;
8. zero process, shell, Git, network, provider, scheduler, and validation execution;
9. clean clone, typecheck, lint, full tests, build, coverage, version checks, disposable lifecycle, and real CI on supported Node versions.

Every command exit code must be asserted.

### 8.2 Development governance

M26 inherits established AIQT repository governance:

- default branch `main`;
- no `.aiqt/` self-management;
- Gate F has no commit/tag;
- continue automatically between Work Units unless a stop condition occurs;
- one detailed commit, annotated tag, validation record, and `Risk: N/100` per Work Unit;
- no empty commits, force-push, history rewrite, or moved tags;
- version determined by repository policy;
- final release and milestone tags only after real CI passes.

Preferred milestone tag:

```text
m26-long-running-execution-protocol
```

---

## 9. Risk, Closure, and Gate G

### 9.1 Hazard register

Risk scale:

```yaml
probability:
  low: 1
  medium: 2
  high: 3

impact:
  low: 3
  medium: 6
  high: 10
  critical: 11

inherent_score:
  formula: probability * impact
  normalized_values:
    3: 10
    6: 17
    9: 25
    10: 33
    11: 33
    12: 33
    18: 50
    20: 50
    22: 50
    30: 75
    33: 100
```

The `Controlled` score is the estimated risk after specification-level controls but before Gate F and implementation evidence.

| ID | Hazard | Probability | Impact | Inherent | Required control | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M26-R01 | Iteration, session, and Work Unit completion are conflated | High | High | 75 | separate lifecycles; checkpoint-only completion | 25 | 25 | 10 |
| M26-R02 | Invalid, replayed, conflicting, or partial event batches mutate state | High | High | 75 | scoped identity, digest conflict, candidate state, atomic write | 30 | 30 | 10 |
| M26-R03 | Broken Work Unit, packet, workspace, or evidence references enter state | High | High | 75 | complete cross-reference validation before write | 25 | 25 | 10 |
| M26-R04 | Terminal session is reopened or mutated outside grace rules | Medium | High | 50 | strict transition table, immutable fields, bounded deterministic grace exception | 25 | 25 | 10 |
| M26-R05 | Multiple non-terminal sessions compete for one packet | Medium | High | 50 | canonical uniqueness invariant and candidate-state validation | 25 | 25 | 10 |
| M26-R06 | Open decision, budget stop, or stale state is bypassed | High | High | 75 | iteration/checkpoint gates and explicit status visibility | 30 | 30 | 12 |
| M26-R07 | Workspace release or packet cancellation invalidates active/history state | Medium | High | 50 | M25/M9 integration preconditions | 25 | 25 | 10 |
| M26-R08 | Provider-specific behavior or rollback leaks into core execution | Medium | Critical | 50 | opaque provider metadata; no adapter, Git, process, or network surface | 17 | 17 | 8 |
| M26-R09 | Raw logs, prompts, transcripts, diffs, secrets, or source enter canonical state | Medium | Critical | 50 | summaries/references only; raw payload non-persistence | 17 | 17 | 8 |
| M26-R10 | Canonical state grows without bound | High | High | 75 | strict per-session/project caps and no raw history | 30 | 30 | 12 |
| M26-R11 | Time-dependent stale or grace-window behavior is nondeterministic | Medium | High | 50 | explicit `--as-of`, inclusive boundaries, preview/apply split | 17 | 17 | 8 |
| M26-R12 | Runlog failure after state success creates duplicate or inconsistent replay | High | High | 75 | state authority, event receipts, direct failure injection, idempotent retry | 30 | 30 | 12 |
| M26-R13 | Legacy M22–M25 behavior changes when sessions are absent | Medium | High | 50 | optional additive state, non-materialization, byte-equivalent fixtures | 25 | 25 | 10 |
| M26-R14 | M26 accidentally adds process, shell, Git, network, provider, validation, or scheduler behavior | Low | Critical | 33 | static boundary scan and negative integration tests | 8 | 8 | 5 |
| M26-R15 | Provider startup failure is misclassified as deliberate cancellation | Medium | Medium | 33 | explicit `planned → failed`; cancellation remains deliberate | 17 | 17 | 8 |
| M26-R16 | Terminal grace-window updates remain accepted after expiry | Medium | High | 50 | deterministic `--as-of`, inclusive boundary tests, exit `2` after expiry | 17 | 17 | 8 |

Risk formula:

```text
controlledDesignRisk =
  max(Controlled score of every M26 hazard)

implementationEntryRisk =
  max(current score of every open M26 hazard after Gate F)

mergeResidualRisk =
  max(final residual score of every open or accepted M26 hazard)
```

Derived targets:

```yaml
controlledDesignRisk: 30
implementationEntryRiskMaximum: 30
mergeResidualRiskMaximum: 12
```

Work Unit risk scores are point-in-time assessments and do not replace hazard-level closure risk.


### 9.2 Definition of Done

M26 is complete only when:

- Gate F passes and entry risk is at most `30`;
- `long-running-execution-protocol@1` is implemented as metadata only;
- sessions are deterministic, bounded, replay-safe, and historically compatible;
- iteration, session, and Work Unit lifecycles remain separate;
- event batches are atomic and idempotent;
- budgets, decisions, stale state, summaries, references, and rollback metadata obey this contract;
- checkpoint, workspace release, and packet cancel safeguards are enforced;
- status/review/manage visibility is read-only and reuses existing owners;
- direct state/runlog failure tests pass;
- no process, shell, Git, network, provider adapter, validation execution, or scheduler exists;
- schema remains `0.5.0` unless explicitly approved otherwise;
- all six Work Units are committed, tagged, and validated;
- clean-clone and real-CI validation pass;
- final hazard-based residual risk is at most `12`;
- M27 was not started.

### 9.3 Gate G

Gate G may open only when the core protocol is stable enough that an optional provider adapter can translate external provider state into the approved event envelope without changing core semantics.

```yaml
gate_g_handoff:
  protocol: long-running-execution-protocol@1
  provider_runtime: none
  process_execution: none
  Git_execution: none
  network_surface: none
  checkpoint_completion_owner: preserved
  workspace_lifecycle_owner: preserved
  next_milestone:
    id: M27
    title: Long-Running Execution Provider Adapter
    optional: true
```

M26 must not implement M27.

---

## 10. Review Questions and Approval Threshold

1. Is M26 still metadata-only with zero process, shell, Git, network, provider-adapter, validation-execution, or scheduler surface?
2. Are iteration, session, and Work Unit completion represented as separate lifecycles?
3. Does checkpoint remain the only Work Unit completion owner?
4. Is there at most one non-terminal execution session per packet?
5. Are terminal sessions immutable except for the bounded seven-day summary/reference window?
6. Is terminal grace evaluation deterministic through `--as-of`, including the exact inclusive boundary?
7. Can a session fail before its first iteration through `planned → failed` without being misclassified as cancelled?
8. Are all event types explicit and unknown event types rejected?
9. Are event identity, digest, replay, and conflict semantics deterministic?
10. Is an envelope applied through one candidate state with no partial mutation?
11. Does state write precede runlog append, with direct failure-injection evidence?
12. Are Work Unit, packet, workspace, binding, generation, and evidence references validated before mutation?
13. Are active sessions, running iterations, and open decisions correctly blocking checkpoint?
14. Are non-terminal sessions blocking workspace release?
15. Does any execution history block packet cancellation?
16. Are budgets recomputed from canonical iterations and used only as metadata gates?
17. Are stale detection and stale apply deterministic and side-effect bounded?
18. Are raw prompts, transcripts, logs, diffs, source files, secrets, credentials, and billing data excluded from state and runlog?
19. Are state and input limits explicit and enforced before mutation?
20. Do status, review, and manage reuse existing owners instead of introducing divergent classification logic?
21. Do projects without `executionSessions` preserve M22–M25 behavior and avoid read-time materialization?
22. Is schema version `0.5.0` preserved unless an explicitly approved incompatibility is proven?
23. Are all six Work Units independently committed, tagged, validated, and risk-scored?
24. Is the final hazard-based merge residual risk at most `12/100`?
25. Is Gate G open without any M27 implementation?

Approval threshold:

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  controlled_design_risk_maximum: 30
  implementation_entry_risk_maximum: 30
  merge_residual_risk_maximum: 12
  partial_event_batch_mutations: 0
  duplicate_non_terminal_sessions_per_packet: 0
  terminal_session_reopen_paths: 0
  raw_payload_persistence_paths: 0
  process_execution_surfaces: 0
  shell_surfaces: 0
  Git_execution_surfaces: 0
  network_surfaces: 0
  provider_adapter_surfaces: 0
  validation_execution_surfaces: 0
  scheduler_background_surfaces: 0
  historical_fixture_regressions: 0
  M27_implementation_surfaces: 0
```

