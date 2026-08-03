# AIQT Milestone 31 Build Specification

## Canonical State and Preview Integrity

**Product:** AIQT CLI  
**Milestone:** M31  
**Status:** Ready for implementation review  
**Risk classification:** High-risk  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 5  
**Primary objective:** Restore the integrity guarantees that canonical state is authoritative, preview operations are non-mutating, repeated capture is safe, and partial persistence failures have deterministic behavior.

---

## 1. Source Alignment

This milestone is corrective work derived from the consolidated read-only audit of the AIQT repository at:

- Branch: `main`
- Audited commit: `ad23965`
- Package version: `0.18.0`
- Canonical schema version: `0.5.0`

The audit concluded that corrective work is required before new autonomous-execution functionality is designed or implemented.

M31 preserves the established AIQT product model:

```text
state -> graph -> packet -> checkpoint
```

Canonical source of truth remains:

```text
.aiqt/project.json
.aiqt/state.json
.aiqt/runlog.jsonl
```

Generated exports remain secondary, non-canonical views.

M31 is for development of AIQT itself. Do not use AIQT commands or create `.aiqt/` self-management state inside the AIQT repository. Use repository specifications, Git commits and tags, CI, tests, and structured implementation reports.

---

## 2. Milestone Objective

M31 corrects the highest-risk persistence and preview defects identified by the audit.

The milestone must establish that:

1. Every supported preview or dry-run planning path performs zero canonical writes.
2. Newer or unknown canonical state cannot be silently destroyed by an older or incompatible binary.
3. Reapplying the documented project-capture input does not create unbounded duplicate records.
4. Multi-file mutation failures have a deterministic and recoverable contract.
5. State-integrity behavior is protected by real regression fixtures and integration tests.

M31 does not redesign the workflow recommendation engine, command-result contract, review rendering, or autonomous execution.

---

## 3. Accepted Findings in Scope

### P0

- **CRIT-001:** Initial `aiqt plan --preview` performs the real initial-plan mutation.
- **CRIT-002:** Unknown or newer canonical-state sections are silently removed on write, while the schema-version guard is effectively inert.

### P1

- **HIGH-004:** Reapplying documented `aiqt update` input duplicates project records.
- **HIGH-005:** Canonical writes and runlog appends are not transactionally linked, allowing state and audit history to diverge.

### Supporting integrity findings

- **MED-012:** Corrupt final runlog lines can cause event-ID reuse or event loss.
- **MED-014:** Canonical schema version is read but not consistently advanced or enforced during writes.

---

## 4. Out of Scope

M31 must not implement:

- Workflow recommendation consolidation.
- `needs_review` routing changes.
- Human review rendering fixes.
- Parser-level JSON error normalization.
- Global exit-code and `CommandResult` consolidation.
- Systemic test-timeout policy.
- README or `SECURITY.md` corrections unrelated to canonical-state integrity.
- Autonomous execution, background agents, scheduling, or direct model integration.
- General refactoring of command registration or runlog architecture unless required by an in-scope integrity correction.
- New `.aiqt/` canonical files.
- AIQT self-dogfood for the AIQT repository.

Related findings may be recorded but must not be opportunistically fixed.

---

## 5. Governing Decisions

### 5.1 Preview contract

A preview or dry-run command may:

- Parse input.
- Validate input.
- Evaluate readiness and gates.
- Compute a candidate result.
- Return deterministic human and JSON output.

It must not:

- Write `project.json`.
- Write `state.json`.
- Append to `runlog.jsonl`.
- Change work graph records.
- Change statuses or current pointers.
- Create packet, checkpoint, evidence, review, or recommendation state.
- Report persisted files in `changedFiles`.

Preferred control flow:

```text
read -> validate -> compute candidate -> preview return OR persist
```

Preview behavior must be enforced at one authoritative mutation boundary where practical.

### 5.2 Canonical compatibility policy

M31 must make and document one explicit compatibility decision before implementing WU31-02 and WU31-03.

Permitted policies:

#### Policy A — Strict version rejection

An older or incompatible binary rejects newer canonical state before any write.

#### Policy B — Unknown-field preservation

Unknown canonical sections are retained through read-modify-write operations.

A hybrid may be used where:

- Unsupported major versions are rejected.
- Additive unknown fields within a compatible version range are preserved.

The current implicit behavior—accepting state and silently stripping unknown fields—is prohibited.

### 5.3 Replay safety

Applying the same valid project-capture input more than once must be deterministic.

At minimum, repeated identical input must not create additional semantically identical:

- Requirements.
- Decisions.
- Risks.
- Assumptions.
- Open questions.

Identity may use:

- Stable explicit IDs.
- Stable `clientKey` values.
- Deterministic content fingerprints.

The chosen identity rule must be documented and tested.

### 5.4 Multi-file mutation contract

Commands that mutate more than one canonical file must have an explicit failure contract.

Acceptable approaches include:

- Transaction-like staging followed by coordinated commit.
- Durable write-ahead intent with deterministic recovery.
- Idempotent retry semantics with detectable incomplete operations.

A command must not report a generic failure while leaving an undocumented, unsafe partial state.

---

## 6. Work Units

## WU31-01 — Initial Plan Preview Integrity

**Risk:** 25/100  
**Objective:** Correct the initial-plan preview path so it computes and reports a candidate plan without persisting any canonical mutation.

### Scope

- Reproduce `CRIT-001` on the current baseline.
- Trace every `aiqt plan` branch.
- Correct the initial-plan mutation boundary.
- Keep existing extension, append, replace, and refinement behavior unchanged.
- Add integration-level regression coverage.

### Acceptance criteria

- `aiqt plan --from-file <path> --preview` leaves all canonical files byte-identical.
- No runlog event is appended.
- `changedFiles` is empty.
- Preview output does not imply that the plan was committed.
- A real initial plan succeeds immediately after preview.
- Existing extension/refinement preview tests remain green.
- No schema version change.
- No runtime dependency added.

### Required validation

- Targeted plan-preview tests.
- Typecheck.
- Lint.
- Build.
- Real CLI reproduction in a temporary directory outside the repository.
- Full supported test command, with baseline timeout failures disclosed rather than hidden.

### Commit and tag

- One Work Unit commit.
- Tag: `m31-wu01-initial-plan-preview-integrity`

---

## WU31-02 — Canonical Compatibility Policy and Version Gate

**Risk:** 45/100  
**Objective:** Define and implement the authoritative compatibility policy for canonical state.

### Scope

- Decide strict rejection, unknown-field preservation, or a documented hybrid.
- Define when `AIQT_SCHEMA_VERSION` changes.
- Define compatibility behavior for:
  - Current version.
  - Older compatible version.
  - Older incompatible version.
  - Unsupported future version.
  - Missing or malformed version.
- Remove tests that freeze `0.5.0` without a product-level reason.
- Add real historical fixtures from earlier repository state where available.

### Acceptance criteria

- The policy is documented in repository governance or versioning documentation.
- Unsupported future state cannot reach a write path.
- Compatible older state has deterministic behavior.
- Version comparison is centralized.
- No command implements a private compatibility rule.
- Tests use at least one real historical fixture rather than only current-schema builders.

### Required validation

- Versioning unit tests.
- Historical fixture integration tests.
- Unsupported-future-state mutation tests.
- Full typecheck, lint, build, and test gates.

### Commit and tag

- One Work Unit commit.
- Tag: `m31-wu02-canonical-compatibility-policy`

---

## WU31-03 — Unknown-Field Preservation and Safe Round-Trip

**Risk:** 55/100  
**Objective:** Ensure compatible canonical state survives read-modify-write cycles without silent loss.

### Scope

- Implement the WU31-02 compatibility policy.
- Preserve compatible unknown sections or block before writing.
- Audit all project/state writer entry points.
- Ensure parsed canonical objects do not silently discard future-compatible data.
- Define behavior for nested unknown fields where relevant.

### Acceptance criteria

- A compatible unknown top-level section survives a write byte-for-byte or semantically unchanged.
- Unsupported state is rejected before mutation.
- `project.json` and `state.json` follow the same policy.
- All mutating commands use the shared compatibility/write boundary.
- Unknown-field behavior is tested across at least:
  - `update`
  - `plan`
  - `checkpoint`
  - one later evidence or execution command

### Required validation

- Round-trip fixture tests.
- Cross-command preservation tests.
- Unsupported-version no-mutation tests.
- Full repository validation.

### Commit and tag

- One Work Unit commit.
- Tag: `m31-wu03-safe-canonical-roundtrip`

---

## WU31-04 — Idempotent Project Context Replay

**Risk:** 40/100  
**Objective:** Make repeated application of documented project-update input safe and deterministic.

### Scope

- Reproduce the duplicate-record behavior using the exact JSON shape generated by `aiqt prompt update`.
- Define record identity precedence:
  1. Explicit canonical ID.
  2. Stable `clientKey`.
  3. Deterministic content fingerprint.
- Apply the rule consistently to requirements, decisions, risks, assumptions, and open questions.
- Preserve intentional distinct records.
- Prevent duplicate runlog events for replayed no-op records.

### Acceptance criteria

- Reapplying identical valid input does not increase record counts.
- No duplicate decision or record-created runlog events are appended for a semantic no-op.
- Changed input updates or creates records according to the documented identity rule.
- Existing explicit-ID and `clientKey` behavior remains compatible.
- The prompt-generated update shape is covered by regression tests.

### Required validation

- Exact prompt-shape replay test.
- Mixed explicit-ID/clientKey/fingerprint tests.
- No-op runlog tests.
- Full repository validation.

### Commit and tag

- One Work Unit commit.
- Tag: `m31-wu04-idempotent-project-update`

---

## WU31-05 — Coordinated Mutation and Runlog Recovery Contract

**Risk:** 65/100  
**Objective:** Prevent undocumented divergence between canonical state and append-only audit history.

### Scope

- Inventory commands that write multiple canonical files or append multiple runlog events.
- Define coordinated mutation semantics.
- Implement the smallest reusable persistence boundary that provides:
  - Safe staging.
  - Deterministic commit order.
  - Failure detection.
  - Idempotent recovery or retry.
- Address corrupt-final-line event-ID behavior where it intersects with coordinated persistence.
- Avoid a full runlog rewrite or storage-engine replacement unless proven necessary.

### Acceptance criteria

- Injected failure after a staged write cannot leave an undocumented partial operation.
- Retry after an interrupted operation is deterministic and does not duplicate records.
- Event IDs remain monotonic and collision-safe when malformed runlog lines exist.
- Recovery behavior is documented and surfaced through actionable diagnostics.
- At least `update` and `checkpoint` use the hardened mutation boundary.
- Existing append-only runlog history is not deleted or rewritten.

### Required validation

- Injected filesystem failure tests.
- Partial-operation retry tests.
- Malformed-final-line event-ID tests.
- Cross-file consistency assertions.
- Full repository validation.

### Commit and tag

- One Work Unit commit.
- Tag: `m31-wu05-coordinated-mutation-recovery`

---

## 7. Repository Ownership Guidance

Use the maintained repository owner map and current implementation boundaries. Likely areas include:

- CLI plan command and planning services.
- Canonical schema and versioning modules.
- Project/state stores and safe-write utilities.
- Project update merge logic.
- Runlog store and event-ID allocation.
- Integration and regression tests.

Do not assume old milestone file paths remain authoritative. Inspect the current repository before implementation.

---

## 8. Cross-Work-Unit Invariants

Every Work Unit must preserve:

1. No AIQT self-management state in the AIQT repository.
2. Default branch remains `main`.
3. One detailed commit and one tag per completed Work Unit.
4. Commit body includes:
   - Scope completed.
   - Validation performed.
   - Known residual risks.
   - Risk score from 0–100.
5. No unrelated cleanup.
6. No hidden baseline failures.
7. No automatic dependency upgrade unless explicitly required by the Work Unit.
8. No direct source-code modification outside the bounded Work Unit scope.
9. Temporary dogfood or reproduction state must live outside the repository.
10. Final implementation report must include changed files, tests, commands, commit SHA, tag, and clean working-tree evidence.

---

## 9. Milestone Verification Gate

M31 is complete only when all of the following are true:

### Preview integrity

- Every supported planning preview path performs zero writes.
- Preview and real execution share one candidate-computation path.
- `changedFiles` accurately reflects no persistence.

### Compatibility integrity

- Canonical compatibility policy is explicit.
- Unsupported future state cannot be silently accepted and rewritten.
- Compatible unknown state is preserved or safely rejected.

### Replay integrity

- Repeated documented update input is idempotent.
- No duplicate records or replay events are produced.

### Persistence integrity

- Multi-file mutation failures have a deterministic recovery contract.
- State and runlog cannot silently diverge without a detectable repair path.
- Event IDs remain safe around malformed runlog content.

### Validation

- Typecheck passes.
- Lint passes.
- Build passes.
- Targeted regression suites pass.
- The official full test command is reported accurately.
- Any unrelated timeout baseline remains separately tracked and is not disguised as an M31 failure.
- All five Work Unit commits and tags exist.
- Final working tree is clean.

---

## 10. Milestone Closure Report Requirements

The M31 closure report must include:

- Starting and ending commits.
- Package and schema versions.
- Compatibility policy decision.
- Work Unit commit and tag table.
- Findings closed, reduced, or deferred.
- Files and architectural boundaries changed.
- Test additions.
- Full validation results.
- Remaining integrity risks.
- Recommendation on whether workflow-recommendation consolidation may begin.
- Explicit statement that autonomous execution remains deferred until later corrective milestones are complete.

---

## 11. Residual Risks After M31

M31 does not make AIQT ready for autonomous unattended execution by itself.

The following remain separate corrective work:

- One authoritative workflow recommendation engine.
- Recoverable `needs_review` guidance.
- Unified JSON and human output contracts.
- Parser-level structured error handling.
- Exit-code/body-field consistency.
- Deterministic full-suite timeout policy.
- Security and operational documentation corrections.

M31 only establishes a trustworthy canonical-state and persistence foundation on which those later corrections can safely build.
