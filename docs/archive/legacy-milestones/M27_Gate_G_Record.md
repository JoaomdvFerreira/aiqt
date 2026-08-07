# M27 Gate G Record

Read-only audit per `AIQT_Milestone_27_Build_Specification_v0.3.md` §1. This
record documents the audit's findings and decisions. It is not itself a
commit or tag boundary; it is committed as part of WU27-01.

## 1.1 Repository baseline (verified)

| Item | Expected | Verified |
|---|---|---|
| Baseline commit | `42a26b5` | `git log -1 42a26b5` resolves to `42a26b54eb9fa8cddedf88c678d4be735e4e3c85` on `main` |
| Release tag | `v0.13.1` | present, points at baseline commit |
| Milestone tag | `m26-long-running-execution-protocol` | present |
| Correction tag | `m26-correction-next-cancel-safeguard` | present |
| Package version | `0.13.1` | `package.json` `version` field |
| Test count | 2000 | `vitest run` reported 190 files / 2000 tests passing at baseline |
| Schema version | `0.5.0` | `src/core/constants/schema-version.ts` |
| CI | green on Node 22 and 24 | confirmed via `gh run list`/`gh run watch` on the baseline commit |

`long-running-execution-protocol@1` and its owners are implemented at:

- session/iteration/decision/budget/stale/transition: `src/schema/execution-session.schema.ts`, `src/workflow/execution-session-transitions.ts`, `src/workflow/execution-stale-detection.ts`, `src/workflow/execution-envelope-engine.ts`, `src/workflow/execution-event-digest.ts`, `src/workflow/execution-session-identity.ts`;
- query/service layer: `src/services/execution-session-service.ts` (includes `findAnySessionForPacket`, the corrected packet-cancellation query);
- CLI boundary: `src/cli/commands/execution-import.command.ts`, `execution-status.command.ts`, `execution-stale.command.ts`;
- packet-cancellation correction: `src/cli/commands/next-cancel.command.ts` (blocks on any session for the current packet, terminal or not).

M25 workspace identity/binding/status owners: `src/services/workspace-state-service.ts`, `src/schema/managed-workspace.schema.ts`. Candidate-state/atomic-write/runlog/digest/stdin/file/preview/JSON/status/review/manage owners: `src/state/workflow-state-store.ts` (`writeStateModel`/`readStateModel`), `src/core/filesystem/safe-writer.ts` (`writeJsonFile`/`appendJsonLine`), `src/state/runlog-store.ts` (`appendRunlogEvent`, `buildExecution*Event` builders), `src/schema/external-evidence/canonical-json.ts` (`computeCanonicalPayloadDigest`), `src/core/filesystem/stdin.ts`, `src/core/output/result.ts` (`makeResult`), `src/cli/commands/review.command.ts`, `src/cli/commands/manage.command.ts`, `src/cli/commands/execution-status.command.ts`.

Current input-size/depth/prohibited-key/unknown-field policy: `src/schema/external-evidence/limits.ts` (`EXTERNAL_INPUT_MAX_PAYLOAD_BYTES`, `EXTERNAL_INPUT_MAX_JSON_NESTING_DEPTH`, `PROHIBITED_KEYS`, `assertSafeParsedJson`). M27 defines its own, larger, line-oriented limits per §4.2 rather than reusing these byte/depth constants directly, since Claude Code's NDJSON transport is materially larger and differently shaped than M26's single-JSON-document envelope; M27's JSON-nesting-depth cap (20) is numerically identical to and reuses `assertSafeParsedJson`'s default.

No prior "adapter"/"extension"/"provider record" state concept exists. `ExecutionSession.provider` (`ExecutionProviderRefSchema`, with an already-optional `externalSessionId` field) is the closest existing shape and is reused as-is; M27 adds one new, additive, optional top-level state collection (`executionAdapterRequests`) following exactly the same pattern as M26's `executionSessions` addition to `StateModelSchema`.

**Decision: Gate G repository-baseline check passes.**

## 1.2 Producer contract evidence

No live Claude Code installation is available in this build environment (no network, no runtime execution permitted by M27's own boundary). Per §1.2, "fixtures must be synthetic or scrubbed" — this repository's fixture corpus is entirely synthetic, hand-authored against the publicly documented `--output-format stream-json` message-family shapes (`system`/`init`, `system`/`api_retry`, `assistant`, `user`, `stream_event`, `result`), and contains no real prompts, source code, credentials, absolute user paths, transcripts, or proprietary data.

Fixture corpus (`tests/fixtures/claude-code/`), one file per required minimum case:

| # | File | Case | Notes |
|---|---|---|---|
| 1 | `01-success-first-invocation.jsonl` | successful first invocation | `system/init` with no prior session, one assistant/user exchange, terminal `result` (`subtype: success`, `is_error: false`) |
| 2 | `02-success-resumed-invocation.jsonl` | successful resumed invocation | same `session_id` as an assumed prior session; represents the JSONL captured from a `--resume <uuid>` invocation |
| 3 | `03-multi-turn-tool-cycle.jsonl` | multi-turn with assistant/tool cycle | `tool_use` + `tool_result` pair between two text turns |
| 4 | `04-api-retry-then-success.jsonl` | API retry followed by success | two `system/api_retry` records (`category: rate_limit`) before a successful result |
| 5 | `05-max-turn-budget-stop.jsonl` | max-turn/budget stop | `result.subtype: error_max_turns`, `is_error: true` |
| 6 | `06-auth-availability-failure.jsonl` | authentication/availability failure | `result.subtype: error_during_execution`, `is_error: true`, `error_category: authentication` |
| 7 | `07-malformed-truncated.jsonl` | malformed/truncated JSONL | valid `system/init` + one `assistant` line, no terminal `result` line at all (truncated capture) |
| 8 | `08-mixed-session.jsonl` | mixed-session JSONL | a second, different `session_id` appears among the message lines |
| 9 | `09-subagent-records.jsonl` | subagent records | `parent_tool_use_id` present on nested assistant/user lines (Claude Code's documented subagent marker) |
| 10 | `10-partial-stream-events.jsonl` | partial `stream_event` records | two `content_block_delta` `stream_event` lines preceding the assistant text they describe |

For every fixture: Claude Code version is recorded as the synthetic placeholder `1.0.0` in `system/init.claude_code_version` (real captures must record the actual installed version); invocation form is documented in the table above; operating system is not applicable to synthetic fixtures (real captures must record OS); message types/subtypes present are exactly those named in the table; stable fields are `type`, `subtype` (where applicable), `session_id`, and the terminal `result`'s `subtype`/`is_error`/`usage`/`duration_ms`/`num_turns`; all other fields (message content, tool inputs/outputs, `cwd`, `model`) are treated as incidental and are never persisted; session-ID behavior is exactly one `session_id` per valid import, constant across every line; final-result behavior is exactly one terminal `result` record per valid import; sensitive/high-volume fields that must always be discarded are `message.content` (assistant/user text, tool inputs, tool results) and any `cwd`/absolute-path fields.

**Gate G note on real-version reverification**: per §0, "these external facts must be reverified during Gate G against the actual supported Claude Code version and captured fixtures" — this repository's Gate G record is built from public documentation and synthetic fixtures because no live Claude Code binary/authenticated session is available in this build environment. This is a disclosed limitation, not a silent waiver: the adapter's message-family recognition and result-classification are intentionally narrow and reject-by-default (§4.3: "unknown top-level message types or unsupported critical subtypes reject the import"), so a real captured transcript that differs from these fixtures in an unrecognized way is rejected (exit 3) rather than silently misclassified. `providerVersionConstraint` (§3.1) is recorded on every adapter request and is available for a future, real-fixture-informed version-compatibility tightening without a schema change.

**Decision: Gate G producer-contract-evidence check passes on this disclosed basis.**

## 1.3 Gate G decisions

- **Producer contract ID**: `claude-code-stream-json@1` (fixed literal; no dynamic adapter loading).
- **Minimum supported capability set**: the six message families listed above (`system/init`, `system/api_retry`, `assistant`, `user`, `stream_event`, `result`); `assistant`/`user`/`stream_event` are recognized-but-content-discarded; `stream_event` records are explicitly the "approved ignorable observability records" referenced in §4.3, counted and discarded, never required.
- **Version-compatibility policy**: `providerVersionConstraint` is a bounded opaque string recorded per request (§3.1); the adapter does not itself parse or compare semantic versions in M27 — an out-of-family message type or unsupported critical subtype is the enforcement mechanism (reject, exit 3), rather than a version string comparison, so the policy is fail-closed on unrecognized shape regardless of the version string's value.
- **Normalized result matrix** (§5.4.1, mutually exclusive):

  | `result.subtype` | `is_error` | `error_category` | Normalized class |
  |---|---|---|---|
  | `success` | `false` | — | `success` |
  | `error_max_turns` | `true` | — | `limited` |
  | `error_during_execution` | `true` | `authentication` \| `billing` \| `rate_limit` \| `service_unavailable` | `unavailable` |
  | `error_during_execution` | `true` | any other value or absent | `failed` |
  | anything else (unrecognized `subtype`) | — | — | rejected (exit 3, not a result class) |

  `error_category` is a bounded enum field read structurally (never inferred from free-text `resultSummary`); this satisfies §5.4.1's "the adapter must not infer a class from free text."
- **Request-package shape**: exactly `ClaudeCodeExecutionRequest` as specified in §3.3, with a fixed command-template argument array (`-p`, `--output-format stream-json`, `--verbose`, plus `--session-id <uuid>` or `--resume <uuid>`); no other flags are ever generated.
- **Maximum JSONL size/line count/line size/nesting depth**: adopted at the exact §4.2 ceiling (not lowered): `max_total_bytes: 16777216`, `max_lines: 20000`, `max_line_bytes: 1048576`, `max_json_depth: 20`, `max_distinct_session_ids: 1`.
- **Source-digest and replay identity**: `sourceDigest` is the SHA-256 hex digest (via the existing `sha256Hex` helper, `src/core/util/hash.ts`) of the exact raw input bytes as read (not a canonicalized/re-serialized form), matching §4.4's `sourceDigest: sha256_of_exact_input_bytes`.
- **Handling of incomplete output**: a JSONL body with no recognized terminal `result` line (or a malformed final line) is rejected atomically, exit 3, zero mutation (§4.3/§5.4.2).
- **Handling of provider session-ID mismatch**: any `session_id` on any parsed line other than the request's persisted `externalSessionId` is rejected atomically, exit 3, zero mutation (§4.4).
- **Mapping from provider result to M26 iteration/session state**: exactly the §5.2/§5.4.1 table (`success` → iteration `completed` / session `paused`; `limited` → iteration `blocked` / session `blocked`; `unavailable` → iteration `failed` / session `blocked`; `failed` → iteration `failed` / session `failed`).
- **External setup and user-action requirements**: documented per §7 in the `request` command's human-readable output and in `aiqt execution adapter claude-code example` output; AIQT never claims provider availability without imported evidence.
- **Implementation entry risk**: recalculated below; at or below `30/100`.

## Implementation entry risk recalculation

Per §11.1's roadmap formula and §11.3, `implementationEntryRisk = max(current open hazard score after Gate G)`. No implementation exists yet, so every M27 hazard's current score is its `Controlled` score from §11.2's hazard table (no Gate-G-specific mitigating evidence beyond what is already reflected in the `Controlled` column). The maximum `Controlled` score across all sixteen M27 hazards is `30` (M27-R01, M27-R03, M27-R04, M27-R06, M27-R12), matching the specification's own `controlledDesignRisk: 30` and `implementationEntryRiskMaximum: 30`.

**implementationEntryRisk = 30, at the maximum permitted value (`<= 30`). Gate G passes.**

## Stop-condition check (§1.3)

None of the listed stop conditions apply:

- corrected M26 closure is available (baseline verified above);
- a fixture corpus was produced (synthetic, disclosed as such);
- stream-json semantics are treated as a single fixed, versioned contract, not something varying across supported versions in this build (no live version matrix was exercised; this is the same disclosed limitation as §1.2, not a semantic-variance finding);
- the adapter design (§§3-6) never launches, polls, authenticates, or cancels Claude Code;
- provider output normalizes to bounded counts/digests/enums/summaries only, never raw content;
- M26 core semantics are reused unmodified (`applyExecutionProtocolEnvelope`, transition table, digest engine) -- M27 never changes M26 behavior, only supplies synthesized envelopes to the same engine.

**Gate G passes. Implementation may proceed.**
