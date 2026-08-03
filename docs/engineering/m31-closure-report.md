# AIQT Milestone 31 Closure Report

## Milestone

**Title:** Canonical State and Preview Integrity

**Objective:** Restore the integrity guarantees that canonical state is authoritative, preview operations are non-mutating, repeated capture is safe, and partial persistence failures have deterministic behavior.

**Risk classification:** High-risk

**Implementation range:** `ad23965c80a8fea83411e0c2ba423d4b041f368c` through `b8d530dea43eb116dcffac9780dab225f43b5dbb`

**Package version:** `0.18.0`

**Canonical schema version:** `0.5.0`

## Work Units

| Work Unit | Commit | Tag | Scope |
| --- | --- | --- | --- |
| WU31-01 Initial Plan Preview Integrity | `22fdef73636ad6ded5431bec443516d6d4ba1ba8` | `m31-wu01-initial-plan-preview-integrity` | Corrected initial `plan --preview` so candidate planning performs zero canonical writes. Boundary: plan command and planning integration coverage. |
| WU31-02 Canonical Compatibility Policy and Version Gate | `6c1faf72975e8d31ab1152adfae9c3d4ed9f4a59` | `m31-wu02-canonical-compatibility-policy` | Centralized schema-version compatibility checks and documented version policy. Boundary: versioning module, project/state stores, historical compatibility tests, versioning docs. |
| WU31-03 Unknown-Field Preservation and Safe Round-Trip | `7e50c231a70fb28eb929dd7cb82aca79656a6258` | `m31-wu03-safe-canonical-roundtrip` | Preserved compatible unknown top-level canonical sections through store read/write cycles. Boundary: project/state stores, unknown-field helper, preservation tests, versioning docs. |
| WU31-04 Idempotent Project Context Replay | `910d2faea75c3f1cd9ad4694f8d0a845ada45382` | `m31-wu04-idempotent-project-update` | Made repeated prompt-shaped project updates deterministic and non-duplicating. Boundary: project update merge service, update command tests, README policy note. |
| WU31-05 Coordinated Mutation and Runlog Recovery Contract | `b8d530dea43eb116dcffac9780dab225f43b5dbb` | `m31-wu05-coordinated-mutation-recovery` | Added a shared coordinated persistence boundary for `update` and `checkpoint`, surfaced runlog-gap diagnostics, and reserved IDs from malformed runlog lines. Boundary: coordinated persistence helper, update/checkpoint commands, runlog store, tests, README policy note. |

## Decisions

M31 selected a hybrid canonical compatibility policy:

- Current schema versions are accepted.
- Older compatible schema versions, currently `0.1.0` through current, are accepted.
- Incompatible older versions below the compatible floor are rejected.
- Unsupported future, missing, non-string, or malformed versions are rejected before mutation.
- Version comparison is centralized; commands do not define private compatibility rules.

Unknown-field behavior:

- Compatible unknown top-level sections in `.aiqt/project.json` and `.aiqt/state.json` are preserved semantically across read-modify-write cycles.
- Unknown nested fields inside known schema-owned sections are not preserved unless promoted into the schema or stored as separate top-level compatible sections.

Project update replay identity precedence:

1. Explicit canonical `id`.
2. Stable `clientKey`.
3. Deterministic content fingerprint over semantic record fields.

Coordinated mutation behavior:

- `aiqt update` and `aiqt checkpoint` now build intended runlog events before persistence and use a shared state/project-write plus runlog-append boundary.
- Canonical state is written first and remains authoritative.
- If runlog append fails, AIQT returns a `CANONICAL-RUNLOG-GAP` diagnostic with an actionable retry/recovery hint rather than a generic failure.
- Retry paths are deterministic and do not duplicate already-persisted records or checkpoint state.

Malformed-runlog hardening:

- Runlog event-ID allocation now reserves event IDs discoverable in malformed lines, including truncated final lines, to avoid ID reuse or collision.

## Findings

- `CRIT-001` closed: initial plan preview no longer mutates canonical files or appends runlog events.
- `CRIT-002` materially reduced: unsupported state is rejected before writes; compatible unknown top-level sections are preserved.
- `HIGH-004` closed: repeated documented update input no longer duplicates project records or replay events.
- `HIGH-005` materially reduced: `update` and `checkpoint` use a documented coordinated persistence boundary with deterministic runlog-gap diagnostics.
- `MED-012` materially reduced: malformed final runlog lines no longer cause event-ID reuse when an ID can be recovered.
- `MED-014` materially reduced: schema-version enforcement is centralized and applied to project/state write paths.

## Validation

Focused validation completed during Work Unit implementation:

- WU31-01 targeted plan-preview tests, typecheck, lint, build, real CLI reproduction, and full-suite baseline disclosure.
- WU31-02 versioning unit tests, historical fixture compatibility tests, unsupported-future no-mutation tests, typecheck, lint, build, and full-suite baseline disclosure.
- WU31-03 round-trip and cross-command unknown-field preservation tests, compatibility tests, versioning unit tests, typecheck, lint, build, version check, and full-suite baseline disclosure.
- WU31-04 project-update service tests, update command replay tests, update-input schema tests, typecheck, lint, build, version check, and full-suite baseline disclosure.
- WU31-05 focused update, checkpoint, runlog, and canonical preservation tests: `50` tests passed.

Closure documentation-safe validation:

- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm build`: passed.
- `corepack pnpm version:check`: passed.
- `git diff --check`: passed.

Official full-suite result from the final implementation Work Unit:

- `643` suites total, `619` passed, `24` failed.
- `2318` tests total, `2269` passed, `49` failed.

This was the known timeout-heavy integration baseline, not reported M31 assertion regressions. M31 does not claim that the full test suite passes.

## Residual Risks

- Older multi-file command paths beyond `update` and `checkpoint` still use historical write patterns and should be migrated in a later persistence-hardening pass.
- The full-suite timeout baseline remains unresolved and still needs a separate deterministic timeout/CI correction.

## Closure Decision

M31 establishes a trustworthy canonical-state and persistence foundation. Planning for the next corrective milestone, including workflow-recommendation consolidation, may begin.

Autonomous execution remains deferred until later corrective milestones are complete.

Closure risk score: `10/100`.
