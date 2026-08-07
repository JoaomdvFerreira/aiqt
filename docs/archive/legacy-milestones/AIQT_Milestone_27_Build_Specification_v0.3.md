# AIQT Milestone 27 Build Specification v0.3

## Claude Code Stream-JSON Execution Provider Adapter

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.3
  status: Revised review candidate; Gate G open; M27 implementation not started
  milestone:
    id: M27
    title: Long-Running Execution Provider Adapter
    optional: true
  concrete_adapter:
    id: claude-code-stream-json@1
    producer: Claude Code non-interactive stream-json output
    architecture: external-runtime_data-only_adapter
  baseline:
    status: verified
    product_version: 0.13.1
    development_baseline_commit: 42a26b5
    release_tag: v0.13.1
    milestone_tag: m26-long-running-execution-protocol
    correction_tag: m26-correction-next-cancel-safeguard
    test_count: 2000
    schema_version: 0.5.0
    M26_merge_residual_risk: 12
    gate_g_status: open
    CI:
      node_22: green
      node_24: green
  risk:
    inherent_maximum: 100
    controlled_design_target: 30
    implementation_entry_maximum: 30
    merge_residual_maximum: 15
```

---

## 0. Position and Source Alignment

M26 defines `long-running-execution-protocol@1` and remains provider-neutral. M27 adds one optional, static, data-only adapter that normalizes a real external producer into that protocol.

The selected producer is Claude Code non-interactive JSONL output:

```text
external Claude Code process
  → --output-format stream-json
  → bounded JSONL artifact or stdin stream
  → AIQT static adapter
  → M26 execution events and session metadata
```

AIQT does **not** start Claude Code.

This design follows the roadmap boundary for M27:

- one stable, reviewed producer contract;
- request-package generation;
- file/stdin result import;
- deterministic session and iteration normalization;
- source digest and replay protection;
- provider health and stale-state representation;
- no runtime coupling.

Current official Claude Code documentation confirms that non-interactive mode supports:

- `--output-format stream-json`;
- newline-delimited JSON events;
- a final `result` message containing session and usage metadata;
- explicit `--session-id` for new sessions;
- `--resume` for an existing session;
- `system/api_retry` progress records;
- streamed `system`, `assistant`, `user`, `stream_event`, and `result` message families.

These external facts must be reverified during Gate G against the actual supported Claude Code version and captured fixtures. The specification does not treat web documentation alone as a fixture corpus.

### 0.1 Why stream-json rather than the Agent SDK

M27 deliberately does not embed the Claude Agent SDK because the roadmap requires the provider runtime to remain external and data-only.

Using imported stream-json:

- avoids adding a provider SDK and its runtime to AIQT;
- avoids process, shell, terminal, network, authentication, and billing management inside AIQT;
- gives the adapter a bounded versioned data contract;
- lets users or external orchestrators choose how Claude Code is installed, authenticated, permitted, and executed;
- preserves M26 as the canonical lifecycle owner.

### 0.2 M26 correction dependency resolved

The focused M26 packet-cancellation review confirmed that production behavior was already specification-compliant. The correction added direct terminal-status coverage, corrected misleading report/test wording, and released the verification improvement as `v0.13.1`.

Verified Gate G input:

```yaml
required_gate_g_input:
  M26_formally_closed: true
  any_session_blocks_packet_cancel: true
  checkpoint_terminal_session_behavior: allowed
  workspace_release_terminal_session_behavior: allowed
  product_version: 0.13.1
  development_baseline_commit: 42a26b5
  correction_tag: m26-correction-next-cancel-safeguard
  release_tag: v0.13.1
  tests: 2000
  real_CI:
    node_22: green
    node_24: green
  mergeResidualRisk: 12
  Gate_G: open
```

M27 implementation remains unstarted. Gate G may now be executed from this exact baseline.

### 0.3 v0.3 review corrections

v0.3 makes two verification-focused clarifications without changing M27 scope:

1. it declares the exact roadmap risk formula used by M27 and explains the difference from M26 v0.3's milestone-local discrete normalization;
2. it separates mutually exclusive provider-result classifications from always-applicable safety invariants and non-import rejection dispositions.

It also corrects the document header's inherent-risk maximum from `75` to `100`, matching M27-R04.

---

## 1. Gate G

Gate G is a read-only audit. It creates no commit, tag, provider request, or `.aiqt/` development state.

### 1.1 Repository baseline

Verify:

- baseline commit `42a26b5`, release `v0.13.1`, milestone tag `m26-long-running-execution-protocol`, correction tag `m26-correction-next-cancel-safeguard`, package `0.13.1`, 2000 tests, schema `0.5.0`, and green Node 22/24 CI;
- `long-running-execution-protocol@1` exact implementation;
- M26 session, iteration, budget, decision, stale, receipt, reference, and transition owners;
- packet-cancellation correction;
- M25 workspace identity/binding/status owners;
- candidate-state, atomic-write, runlog, digest, stdin/file, preview, JSON, status, review, and manage owners;
- current input-size, depth, prohibited-key, and unknown-field policies;
- existing extension or provider-record ownership patterns.

### 1.2 Producer contract evidence

Capture a fixture corpus from one explicitly supported Claude Code version.

Minimum fixtures:

1. successful first invocation with `--session-id`;
2. successful resumed invocation with `--resume`;
3. multi-turn output with at least one assistant/tool cycle;
4. API retry followed by success;
5. max-turn or budget stop;
6. authentication or provider-availability failure;
7. malformed or truncated JSONL;
8. mixed-session JSONL;
9. output containing subagent records;
10. output containing partial stream events, even though M27 does not require them.

For every fixture, record:

- Claude Code version;
- invocation form;
- operating system;
- message types and subtypes;
- stable versus incidental fields;
- session-ID behavior;
- final-result behavior;
- sensitive or high-volume fields that must be discarded.

Fixtures must be synthetic or scrubbed. They must not contain real prompts, source code, credentials, absolute user paths, transcripts, or proprietary data.

### 1.3 Gate G decisions

Gate G must approve:

- producer contract ID: `claude-code-stream-json@1`;
- minimum supported capability set;
- version-compatibility policy;
- normalized result matrix;
- request-package shape;
- maximum JSONL size, line count, line size, and nesting depth;
- source-digest and replay identity;
- handling of incomplete output;
- handling of provider session ID mismatch;
- mapping from provider result to M26 iteration/session state;
- external setup and user-action requirements;
- implementation entry risk at or below `30/100`.

Stop before implementation when:

- corrected M26 closure is unavailable;
- no stable fixture corpus can be produced;
- stream-json semantics vary materially across the selected supported versions;
- the adapter requires launching, polling, authenticating, or cancelling Claude Code;
- provider output cannot be normalized without persisting raw content;
- M26 core semantics must be changed rather than reused.

---

## 2. Objective and Boundaries

M27 must prove that AIQT can:

1. generate a bounded request package for the current Work Unit, packet, and workspace;
2. assign a durable external Claude Code session UUID before provider execution;
3. generate a non-executed command template for a new or resumed external invocation;
4. import complete Claude Code stream-json from file or stdin;
5. reject malformed, truncated, mixed-session, mismatched, replay-conflicting, or unsupported output atomically;
6. normalize one external invocation into exactly one M26 iteration;
7. preserve one M26 session across multiple Claude Code resume invocations;
8. summarize provider health, usage, retries, and result status without storing raw messages;
9. keep provider completion separate from checkpoint and Work Unit completion;
10. preserve all projects that do not use the adapter.

M27 must not:

- invoke `claude`;
- import the Claude Agent SDK;
- spawn or supervise any process;
- open a shell, terminal, or PTY;
- perform network calls;
- authenticate with Anthropic;
- read or persist API keys, OAuth tokens, billing credentials, or account details;
- approve Claude Code permissions;
- set `bypassPermissions`, `dangerously-skip-permissions`, or equivalent;
- poll, cancel, interrupt, resume, or roll back the provider;
- execute Git or validation commands;
- persist raw prompts, assistant text, tool inputs, tool results, source code, diffs, logs, or transcripts;
- treat provider success as checkpoint acceptance or Work Unit completion;
- define dynamic providers or plugins;
- implement M28.

The adapter is optional. Provider unavailability must not block projects or Work Units that do not use it.

---

## 3. Static Adapter and Request Contract

Exactly one M27 adapter exists:

```yaml
ExecutionProviderAdapter:
  adapterId: claude-code-stream-json@1
  providerId: anthropic/claude-code
  inputMode:
    - file
    - stdin
  runtimeOwnedByAIQT: false
  networkOwnedByAIQT: false
  credentialsOwnedByAIQT: false
```

There is no arbitrary `--provider`, executable plugin path, module path, command template override, or dynamic adapter loading.

### 3.1 Adapter request record

M27 may add one optional provider-neutral collection:

```yaml
State:
  executionAdapterRequests: optional_array
```

Historical state without the field remains valid. Read-only commands must not materialize it.

```yaml
ExecutionAdapterRequest:
  id: canonical_request_id
  adapterId: claude-code-stream-json@1
  executionSessionId: canonical_M26_session_id
  workUnitId: canonical_work_unit_id
  packetId: canonical_packet_id
  workspaceRef:
    mode: managed | none
    workspaceId: optional
    workspaceBindingId: optional
    workspaceGeneration: optional
  requestSequence: positive_integer
  externalSessionId: UUID
  mode: start | resume
  status: requested | imported | expired | invalid
  requestDigest: sha256
  importedSourceDigest: optional_sha256
  providerVersionConstraint: bounded_string
  createdAt: timestamp
  expiresAt: timestamp
  importedAt: optional_timestamp
```

Rules:

- request records are bounded and immutable except for lifecycle fields;
- one session has at most one active `requested` record;
- retries reuse the same active request and external session UUID;
- a resume request must use the session’s existing external session UUID;
- imported, expired, and invalid records are never reactivated;
- a new request sequence is monotonic within one M26 session;
- request identity is deterministic from canonical project/session/request-sequence/adapter data;
- the external session UUID is generated once, persisted before export, and reused;
- provider-specific raw fields are not persisted.

### 3.2 Session creation and resume

For a new adapter session:

1. validate current Work Unit, packet, workspace, and M26 preconditions;
2. create or reuse a planned M26 session using:
   - `providerId = anthropic/claude-code`;
   - deterministic `sessionClientKey`;
   - generated `externalSessionId`;
3. persist the adapter request;
4. generate the non-canonical request package.

For a resume request:

- the M26 session must be non-terminal;
- status must permit a new iteration under M26;
- no decision, budget stop, running iteration, or other active adapter request may block it;
- use the existing external session UUID;
- increment request sequence;
- do not create a second M26 session.

### 3.3 Request package

The request package is a generated, non-canonical export containing:

```yaml
ClaudeCodeExecutionRequest:
  contractVersion: claude-code-stream-json-request@1
  requestId: canonical_request_id
  adapterId: claude-code-stream-json@1
  executionSessionId: canonical_M26_session_id
  workUnitId: canonical_work_unit_id
  packetId: canonical_packet_id
  workspacePath: validated_path_or_null
  externalSessionId: UUID
  mode: start | resume
  prompt:
    bounded_text: true
    source: current_agent_packet
  commandTemplate:
    executable: claude
    arguments: fixed_array
  outputInstructions:
    format: stream-json
    capture: file_or_pipe_to_import
  createdAt: timestamp
  expiresAt: timestamp
```

The fixed command template may use only reviewed Claude Code flags required by Gate G, including the equivalent of:

```text
-p
--output-format stream-json
--verbose
--session-id <uuid>     # start
--resume <uuid>         # resume
```

Rules:

- the command template is displayed or exported but never executed;
- no permission-bypass flag is generated;
- no arbitrary user-supplied Claude argument is accepted;
- model selection, MCP, plugins, system-prompt replacement, remote control, cloud execution, and custom permission modes are outside M27;
- the prompt is bounded and derives from the current packet;
- request output must warn that Claude Code installation, authentication, permissions, and execution remain user/external-orchestrator responsibilities;
- request export must not contain credentials or environment values.

---

## 4. Provider Input Contract

### 4.1 Commands

```text
aiqt execution adapter claude-code request <work-unit-id>
aiqt execution adapter claude-code request <work-unit-id> --resume-session <session-id>
aiqt execution adapter claude-code request <work-unit-id> --preview
aiqt execution adapter claude-code request <work-unit-id> --output <path>
aiqt execution adapter claude-code request <work-unit-id> --json

aiqt execution adapter claude-code import --request <request-id> --from-file <path>
aiqt execution adapter claude-code import --request <request-id> --stdin
aiqt execution adapter claude-code import ... --preview
aiqt execution adapter claude-code import ... --json

aiqt execution adapter claude-code status
aiqt execution adapter claude-code status --session <session-id>
aiqt execution adapter claude-code status --json

aiqt execution adapter claude-code example
aiqt execution adapter claude-code example --json
```

Exactly one import transport is allowed.

### 4.2 Input limits

Gate G may lower these values but must not raise them without review:

```yaml
input_limits:
  max_total_bytes: 16777216
  max_lines: 20000
  max_line_bytes: 1048576
  max_json_depth: 20
  max_distinct_session_ids: 1
  prohibited_keys: inherited
```

Parsing must be line-oriented and bounded. AIQT must not load an unbounded provider transcript into memory.

### 4.3 Supported message families

The adapter recognizes only Gate-G-approved versions of:

```text
system/init
system/api_retry
assistant
user
stream_event
result
```

Rules:

- `system/init` establishes provider session metadata;
- `system/api_retry` contributes bounded health counts only;
- `assistant`, `user`, and `stream_event` contribute message/tool/count metadata only;
- their text, thinking, tool input, tool result, and source content are discarded;
- `result` closes the imported provider invocation and supplies the normalized outcome;
- unknown top-level message types or unsupported critical subtypes reject the import;
- explicitly approved ignorable observability records may be counted and discarded;
- one complete import must contain exactly one matching provider session ID and one terminal result;
- a missing result, malformed final line, or mixed session ID is invalid and causes no mutation.

### 4.4 Source identity and replay

```yaml
ProviderImportIdentity:
  adapterId: claude-code-stream-json@1
  requestId: canonical_request_id
  externalSessionId: UUID
  sourceDigest: sha256_of_exact_input_bytes
```

Rules:

- imported request + same source digest → no-op;
- imported request + different source digest → exit `3`;
- requested record + valid source → apply once;
- expired or invalid request → exit `2`;
- wrong external session ID → exit `3`;
- wrong Work Unit, packet, workspace, or request identity → exit `3`;
- preview validates the complete normalized candidate state and writes nothing;
- raw input bytes and parsed message bodies are never persisted;
- only digest, counts, bounded summaries, result classification, and M26 references are retained.

---

## 5. Normalization into M26

One complete Claude Code invocation maps to exactly one M26 iteration.

### 5.1 Atomic application

Import processing must:

1. read and hash the bounded input;
2. resolve the immutable adapter request;
3. parse every JSONL line;
4. validate one external session identity;
5. normalize provider result and usage;
6. synthesize one M26 event envelope;
7. apply through the existing M26 candidate-state and replay engine;
8. finalize the adapter request in the same candidate state;
9. atomically write state;
10. append bounded runlog events;
11. preserve state authority if runlog append fails.

Any failure before state write produces zero mutation.

### 5.2 Start invocation mapping

A valid first invocation synthesizes:

```text
session.status_changed: planned → running
iteration.started
iteration.finished
session.status_changed: running → paused | blocked | failed
session.references_added or session.summary_updated when bounded data exists
```

The provider invocation does not automatically set the session to `completed`.

### 5.3 Resume invocation mapping

A valid resumed invocation synthesizes:

```text
session.status_changed: paused|blocked|stale → running
iteration.started
iteration.finished
session.status_changed: running → paused | blocked | failed
```

Resumption from `blocked` or `stale` must still satisfy all M26 decision, budget, and transition rules.

### 5.4 Result classification

Gate G must approve the exact, mutually exclusive provider subtype-to-result-class mapping for the supported fixture corpus.

#### 5.4.1 Imported result classes

A valid import with exactly one recognized terminal `result` record must normalize to exactly one of these classes:

| Normalized result class | Provider condition | M26 iteration | M26 session | Required meaning |
|---|---|---|---|---|
| `success` | invocation completed successfully | completed | paused | the external turn ended successfully; resume or explicit M26 completion may still follow |
| `limited` | turn, context, or approved execution-budget limit reached | blocked | blocked | external execution stopped at a recognized limit |
| `unavailable` | authentication, billing, rate/service availability, or external setup failure that may be corrected | failed | blocked | user or external-orchestrator action is required before another request |
| `failed` | unrecoverable provider, model, or approved input failure | failed | failed | the M26 execution session cannot continue safely |

The concrete Claude Code result subtypes and fields assigned to these four classes are a Gate G fixture decision. The adapter must not infer a class from free text.

#### 5.4.2 Rejection dispositions

The following are not result classes and do not create an M26 iteration:

| Source condition | Disposition |
|---|---|
| incomplete, truncated, malformed, or missing terminal result | reject with exit `3`; zero mutation |
| mixed or mismatched provider session IDs | reject with exit `3`; zero mutation |
| unsupported critical message type, subtype, contract, or provider version | reject with exit `3`; zero mutation |
| request already imported with a different source digest | reject with exit `3`; zero mutation |
| expired or explicitly invalid request | block with exit `2`; zero mutation |

#### 5.4.3 Always-applicable invariants

Regardless of result class:

- a provider completion claim never completes the M26 session automatically;
- a provider completion claim never completes the Work Unit;
- checkpoint remains the only Work Unit completion authority;
- rollback claims are unverified metadata only and do not alter Git, workspace, session, checkpoint, or Work Unit state;
- provider result data never bypasses evidence, review, or checkpoint;
- free-form provider text never determines lifecycle transitions.


### 5.5 Provider health and usage

Persist only bounded normalized values:

```yaml
ClaudeProviderInvocationSummary:
  requestId: canonical_request_id
  providerVersion: bounded_string
  messageCount: non_negative_integer
  assistantMessageCount: non_negative_integer
  toolUseCount: non_negative_integer
  apiRetryCount: non_negative_integer
  apiRetryCategories: bounded_enum_counts
  reportedTokens: optional_non_negative_integer
  reportedDurationSeconds: optional_non_negative_integer
  reportedCost:
    stored: false
    reason: M26 does not own billing data
  resultClass: success | limited | unavailable | failed
  resultSummary: bounded_non_raw_summary
```

Provider timestamps are provenance only. AIQT-applied timestamps remain authoritative for M26 activity and stale logic.

---

## 6. Status, Review, Manage, and Recovery

### 6.1 Adapter status

Adapter status is read-only and reports:

- supported adapter contract;
- request counts by lifecycle;
- active request;
- associated M26 session and iteration state;
- provider version observed from imported fixtures/data;
- normalized health state: unknown, healthy, degraded, unavailable, failed;
- stale or expired requests;
- user action required;
- recommended next command.

It does not probe the Claude executable, network, account, credentials, or provider service.

### 6.2 Review and manage

Reuse existing M26/M22 owners.

Detect:

- request referencing missing session, packet, Work Unit, or workspace;
- multiple active requests for one session;
- imported request without matching M26 iteration;
- external session ID drift;
- unsupported provider version;
- stale/expired request;
- provider unavailable or failed;
- repeated API retries;
- provider rollback/completion claim as unverified metadata;
- terminal M26 session with active adapter request;
- raw provider content accidentally persisted.

Provider findings route through existing canonical finding/issue behavior. M27 must not create a provider-specific issue lifecycle.

### 6.3 Recovery

No provider process is recoverable by AIQT.

Recovery is limited to canonical request/import state:

- requested + no imported digest → remain requested until expiry or explicit invalidation;
- requested + complete valid source → import;
- imported + same digest → no-op;
- imported + different digest → conflict;
- expired + source → blocked/manual review;
- state finalized + runlog gap → state authoritative; replay no-op and bounded gap reporting;
- contradictory adapter/M26 state → exit `3`, no automatic repair.

No force, provider cancellation, provider resume, process kill, output truncation repair, or raw-record adoption exists.

---

## 7. External Setup Contract

M27 must treat Claude Code as a user-owned external integration.

AIQT provides:

- fixed request package;
- installation/authentication prerequisites documentation;
- exact supported producer capabilities;
- capture/import instructions;
- environment-variable placeholders only where unavoidable;
- a user-action checklist;
- troubleshooting for unsupported version, missing result, session mismatch, and provider unavailability.

AIQT does not:

- install Claude Code;
- log in;
- manage subscriptions or API credits;
- store keys or tokens;
- modify global Claude settings;
- enable hooks, plugins, MCP, remote control, or permission bypass;
- claim the provider is available without imported evidence.

---

## 8. Compatibility and Security

M27 must preserve:

- all M22 evidence and issue semantics;
- M23 external evidence import;
- M24 logical execution and parallel eligibility;
- M25 workspace lifecycle and Git boundary;
- corrected M26 packet-cancel behavior;
- M26 session, stale, checkpoint, workspace-release, status, review, and manage semantics;
- historical projects without adapter requests;
- schema `0.5.0` unless additive compatibility is proven impossible and approval is obtained.

Security requirements:

- no `child_process`, process runner, shell, PTY, terminal, HTTP, fetch, socket, SDK, or provider-auth dependency in M27 code;
- no dynamic import from project-controlled paths;
- no arbitrary executable or provider argument input;
- no generated permission-bypass flags;
- no raw payload persistence;
- no ANSI/control-byte leakage in output or state;
- no absolute user path persisted beyond existing validated workspace references;
- all strings treated as data;
- input depth, size, line, and count limits enforced before mutation;
- unknown fields rejected unless the Gate-G fixture contract explicitly classifies them as ignorable provider extensions.

---

## 9. Consolidated Exit-Code Contract

| Condition | Exit | Mutation |
|---|---:|---|
| Request generated and session/request persisted | 0 | Yes |
| Request preview generated | 0 | No |
| Valid provider import applied | 0 | Yes |
| Identical replay | 0 | No |
| Read-only status/example succeeds | 0 | No |
| Existing review semantics produce quality findings | 1 | No |
| Request expired or provider state currently unavailable | 2 | No |
| M26 decision, budget, stale, session, packet, or workspace precondition blocks request | 2 | No |
| Input/request/state cap reached | 2 | No |
| No provider result because external setup has not occurred | 2 | No |
| Malformed/truncated JSONL or unsupported contract/version | 3 | No |
| Mixed/wrong external session ID | 3 | No |
| Source digest conflict | 3 | No |
| Broken request/session/packet/workspace reference | 3 | No |
| Both or neither import transports provided | 3 | No |
| State succeeds but runlog append fails | 3 | State remains authoritative |
| Required input absent | 10 | No |

Exit `2` is a valid blocked condition. Exit `3` is invalid input, integrity conflict, or corrupt state.

---

## 10. Work Units

### WU27-01 — Gate G, Producer Contract, and Fixtures

- finalize corrected M26 baseline;
- capture and scrub fixture corpus;
- approve supported Claude Code capabilities/version policy;
- approve result normalization matrix;
- recalculate implementation-entry risk.

Suggested tag:

```text
m27-wu01-gate-provider-contract
```

### WU27-02 — Adapter Request State and Request Package

- optional adapter request schema;
- identity, sequence, external UUID, expiry, and caps;
- new/resume request generation;
- non-executed fixed command template;
- user-action output.

Suggested tag:

```text
m27-wu02-request-package
```

### WU27-03 — Bounded Stream-JSON Parser and Normalizer

- streaming JSONL parser;
- message-family schemas;
- source digest;
- session consistency;
- raw-content discard;
- health/usage/result normalization.

Suggested tag:

```text
m27-wu03-stream-json-normalizer
```

### WU27-04 — M26 Import and CLI Integration

- atomic synthesized M26 envelope;
- first/resume iteration mapping;
- replay/conflict behavior;
- status, review, and manage integration;
- runlog ordering.

Suggested tag:

```text
m27-wu04-m26-adapter-integration
```

### WU27-05 — Compatibility, Security, and Failure Hardening

- malformed/truncated/mixed-session cases;
- unsupported-version behavior;
- state/runlog failure injection;
- caps and memory bounds;
- no-runtime/no-network scans;
- M22–M26 regressions;
- Windows/macOS/Linux fixture portability where CI permits.

Suggested tag:

```text
m27-wu05-adapter-hardening
```

### WU27-06 — Full Validation and Closure

- clean clone and frozen install;
- request → external fixture → import → resume request → second import lifecycle;
- real M25 workspace binding;
- corrected packet-cancel behavior;
- real CI;
- versioning, release, hazard reconciliation, and Gate H.

Suggested tag:

```text
m27-wu06-final-validation
```

Continue automatically between Work Units. Do not combine Work Units without prior approval.

Each Work Unit requires:

- bounded implementation;
- focused tests;
- validation;
- one detailed commit;
- one annotated tag;
- `Risk: N/100` in the commit body;
- structured report.

Preferred milestone tag:

```text
m27-claude-code-stream-json-adapter
```

---

## 11. Risk Register

### 11.1 Risk-scoring convention

M27 uses the original AIQT roadmap probability/impact formula:

```yaml
probability_weight:
  low: 1
  medium: 2
  high: 3

impact_weight:
  low: 1
  medium: 2
  high: 3
  critical: 4

inherent_score:
  formula: round((probability_weight * impact_weight / 12) * 100)
  rounding: nearest_integer
```

Examples:

```text
High × High       = round((3 × 3 / 12) × 100) = 75
High × Critical   = round((3 × 4 / 12) × 100) = 100
Medium × Critical = round((2 × 4 / 12) × 100) = 67
Medium × High     = round((2 × 3 / 12) × 100) = 50
Medium × Medium   = round((2 × 2 / 12) × 100) = 33
```

M26 v0.3 used a milestone-local discrete normalization table. That table remains valid for M26's approved risk reconciliation, but it did not replace the roadmap formula. M27 and later roadmap specifications use the formula above unless a shared governance decision explicitly supersedes it.

### 11.2 Hazard table

| ID | Hazard | Probability | Impact | Inherent | Required control | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M27-R01 | Claude stream-json semantics are unstable or misinterpreted | High | High | 75 | one supported capability contract, captured fixtures, strict version policy | 30 | 30 | 15 |
| M27-R02 | Adapter becomes a hidden provider execution surface | High | High | 75 | data-only file/stdin boundary; static scans; no SDK/process/network code | 25 | 25 | 8 |
| M27-R03 | Provider output binds to the wrong packet, Work Unit, workspace, or session | High | High | 75 | persisted request identity, generated UUID, exact cross-reference validation | 30 | 30 | 12 |
| M27-R04 | Raw prompt, transcript, tool input/result, source, path, or secret enters state | High | Critical | 100 | discard content; persist counts/digests/enums only; direct persistence tests | 30 | 30 | 10 |
| M27-R05 | Replay or conflicting output mutates an iteration twice | Medium | High | 50 | request identity, exact source digest, M26 receipts, candidate-state application | 25 | 25 | 10 |
| M27-R06 | Truncated or mixed-session output produces a false canonical result | High | High | 75 | exactly one session and terminal result; full parse before mutation | 30 | 30 | 12 |
| M27-R07 | Provider success is mistaken for session, checkpoint, or Work Unit completion | Medium | High | 50 | success maps to iteration completed/session paused; checkpoint remains authoritative | 25 | 25 | 10 |
| M27-R08 | Provider outage blocks unrelated workflows | Medium | High | 50 | optional adapter; request-local blocked state; no global readiness effect | 17 | 17 | 8 |
| M27-R09 | Generated command weakens Claude permission safety | Medium | Critical | 67 | fixed reviewed flags; no arbitrary args or bypass flags | 25 | 25 | 10 |
| M27-R10 | Wrong external UUID resumes another Claude session | Medium | High | 50 | generated and persisted UUID; exact result/session match; no `--continue` | 25 | 25 | 10 |
| M27-R11 | Provider timestamps corrupt AIQT stale or ordering semantics | Medium | Medium | 33 | provider time is provenance only; AIQT applied time authoritative | 17 | 17 | 8 |
| M27-R12 | Large JSONL exhausts memory or canonical state | High | High | 75 | line-oriented limits, content discard, bounded request/session records | 30 | 30 | 12 |
| M27-R13 | Provider-specific fields leak into M26 core semantics | Medium | High | 50 | static normalization, provider-neutral request records, M26 events only | 25 | 25 | 10 |
| M27-R14 | Runlog failure creates inconsistent adapter/M26 replay | Medium | High | 50 | one candidate state, state authority, direct failure injection | 25 | 25 | 12 |
| M27-R15 | M27 regresses corrected M26 packet-cancel or M25 workspace safety | Medium | High | 50 | direct end-to-end regressions against terminal and non-terminal history | 25 | 25 | 10 |
| M27-R16 | External setup instructions overstate availability or hide required action | Medium | Medium | 33 | explicit user-action checklist; no provider probing or availability claim | 17 | 17 | 8 |

### 11.3 Derived risk

```text
inherentRiskMaximum =
  max(Inherent score of every M27 hazard)
  = 100

controlledDesignRisk =
  max(Controlled score of every M27 hazard)
  = 30

implementationEntryRisk =
  max(current open hazard score after Gate G)
  must be <= 30

mergeResidualRisk =
  max(final residual score of every open or accepted hazard)
  must be <= 15
```

Work Unit risk scores are point-in-time assessments and do not replace the final hazard reconciliation.

---

## 12. Definition of Done

M27 is complete only when:

- corrected M26 closure is accepted and Gate G is open;
- one supported Claude Code producer contract and scrubbed fixture corpus exist;
- adapter ID is exactly `claude-code-stream-json@1`;
- AIQT generates but never executes fixed request packages;
- first and resumed external invocations bind to the correct M26 session;
- complete provider output maps to exactly one M26 iteration;
- success pauses rather than completes the M26 session automatically;
- provider completion never completes the Work Unit;
- malformed, truncated, mixed-session, unsupported, mismatched, and conflicting input cause no partial mutation;
- raw provider content is never persisted;
- replay is idempotent;
- runlog failure leaves authoritative replay-safe state;
- provider unavailable/stale state does not block unrelated workflow;
- status/review/manage reuse existing owners;
- corrected M26 packet-cancel behavior remains intact;
- no process, shell, terminal, PTY, SDK, network, auth, Git, validation, provider cancellation, or automatic rollback surface exists;
- historical M22–M26 fixtures remain green;
- schema remains `0.5.0` unless explicitly approved otherwise;
- all six Work Units are committed, tagged, validated, and risk-scored;
- clean clone and real CI pass on supported Node versions;
- final hazard-based residual risk is at most `15`;
- Gate H is ready;
- M28 was not started.

---

## 13. Review Questions and Approval Threshold

1. Is M27 still a data-only adapter rather than a provider runtime?
2. Is one concrete producer contract selected and versioned?
3. Does Gate G require actual captured fixtures rather than documentation alone?
4. Does request generation know the external session UUID before execution?
5. Are new and resumed requests unambiguous and replay-safe?
6. Is `--continue` excluded in favor of an exact session UUID?
7. Are command arguments fixed and free of permission-bypass flags?
8. Are arbitrary provider/model/plugin/MCP/permission arguments prohibited?
9. Does Gate G approve a mutually exclusive subtype-to-result-class matrix separately from rejection dispositions and global invariants?
10. Does one complete provider invocation map to exactly one M26 iteration?
11. Does provider success map to session `paused`, not automatic session or Work Unit completion?
12. Are incomplete and mixed-session streams rejected atomically?
13. Is one exact source digest authoritative for replay?
14. Are raw prompts, assistant text, thinking, tools, results, source, diffs, paths, and secrets discarded?
15. Are usage and health records bounded and non-billing?
16. Are provider timestamps prevented from controlling AIQT stale semantics?
17. Are request/session/packet/workspace references validated before mutation?
18. Is runlog failure tested directly with state remaining authoritative?
19. Do status, review, and manage reuse existing owners?
20. Does provider failure remain local to the optional adapter/session?
21. Does corrected M26 packet cancellation remain blocked for all session history?
22. Are M25 workspace release and checkpoint semantics preserved?
23. Are historical states valid without adapter request records?
24. Are all input and state limits explicit?
25. Is implementation entry risk at most `30/100`?
26. Is merge residual risk at most `15/100`?
27. Is Gate H ready without M28 implementation?

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  corrected_M26_closure_required: true
  stable_fixture_corpus_required: true
  risk_formula_declared: true
  mutually_exclusive_result_matrix_required: true
  controlled_design_risk_maximum: 30
  implementation_entry_risk_maximum: 30
  merge_residual_risk_maximum: 15
  provider_process_surfaces: 0
  shell_or_terminal_surfaces: 0
  provider_SDK_dependencies: 0
  network_or_auth_surfaces: 0
  arbitrary_provider_argument_surfaces: 0
  permission_bypass_flags_generated: 0
  raw_provider_payload_persistence_paths: 0
  partial_import_mutations: 0
  provider_success_to_work_unit_completion_paths: 0
  historical_fixture_regressions: 0
  M28_implementation_surfaces: 0
```

## 14. Gate H

Gate H may open after M27 when:

- M27 is used, residual risk is at most `15`, and the adapter remains optional; or
- M27 is skipped and M28 does not depend on provider execution.

```yaml
gate_h_handoff:
  execution_protocol: long-running-execution-protocol@1
  optional_adapter: claude-code-stream-json@1
  provider_runtime_inside_AIQT: none
  provider_network_inside_AIQT: none
  provider_credentials_inside_AIQT: none
  completion_authority: checkpoint
  next_milestone:
    id: M28
    title: Evidence Gate Simulation
```

M27 must not implement M28.
