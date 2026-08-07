# AIQT Milestone 21 Build Specification v0.2

## Runtime, Supply Chain, and Repository Governance Hardening

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Build-handoff candidate
  milestone:
    id: M21
    title: Runtime, Supply Chain, and Repository Governance Hardening
  baseline:
    expected_latest_milestone: M20
    expected_m20_title: Explicit Ready Work Unit and Branch Selection
    expected_package_version: 0.7.0
    expected_tag: m20-explicit-next-selection
    verification_required: true
  aligns_with:
    - AIQT Post-M20 Proposed Milestones Roadmap v0.4
    - current repository architecture and canonical state contracts
  primary_agent_target: Claude Code, Codex, or equivalent coding agent
  architecture_role: local workflow control plane
  risk:
    inherent: 50
    controlled_design_target: 33
    implementation_entry_target: 25
    merge_residual_target: 10
```

---

## 0. v0.2 Change Summary

- Defines the exact numeric exit code for every M21 error, warning, blocked, and human-input condition using the established `0 | 1 | 2 | 3 | 10` taxonomy.
- Adds the Gate A and milestone risk aggregation rule: the implementation-entry or residual score is the maximum open hazard score after current controls and evidence are applied.
- Clarifies that per-Work-Unit commits, tags, and checkpoints are an intentional M21 governance experiment, not an accidental replacement of the historical milestone-level tagging convention.
- Preserves all v0.1 scope, architecture boundaries, Work Units, compatibility rules, and risk targets.

---

## 1. Source Alignment

M21 is the first implementation milestone under the approved post-M20 roadmap. It hardens the repository and runtime baseline before AIQT introduces evidence contracts, provider input, workspace metadata, or required workflow enforcement.

M21 must preserve the current execution boundary:

```text
AIQT stores workflow state and guidance.
AIQT does not execute arbitrary validation commands.
AIQT does not spawn coding agents.
AIQT does not load executable provider plugins.
AIQT does not autonomously mutate implementation repositories.
```

The implementation agent must inspect the actual repository before changing files. Baseline values in this document are expectations, not permission to ignore conflicting repository evidence.

---

## 2. Objective

Establish a supported, reproducible, and truthfully governed foundation for later evidence and provider milestones.

M21 must prove that AIQT can:

- declare and test supported Node.js and pnpm versions;
- keep CI behavior consistent across supported runtimes;
- expose accurate package ownership and distribution metadata;
- monitor dependency and GitHub Actions updates without introducing uncontrolled automation;
- generate a reproducible test-coverage baseline without using an arbitrary global threshold;
- document a truthful vulnerability-reporting policy;
- record whether main-branch checks are structurally enforced or advisory;
- retain crash-safe atomic writes while using collision-resistant exclusive temporary files;
- diagnose external implementation roots without blocking valid separate-repository workflows;
- provide a tested maintainer recovery and release runbook;
- make no change to workflow completion, checkpoint, readiness, or provider-execution semantics.

---

## 3. Gate A — Mandatory Pre-Build Verification

No implementation begins until the agent produces a read-only baseline report containing:

```yaml
gate_a_report:
  git:
    current_branch: required
    working_tree_clean: required
    head_commit: required
    default_branch: required
    relevant_tags: required
  aiqt:
    package_version: required
    latest_completed_milestone: required
    schema_version: required
    canonical_state_valid: required
  runtime:
    current_node_versions_in_ci: required
    current_pnpm_version_in_ci_and_lockfile: required
    locally_verified_supported_versions: required
  package_metadata:
    engines_present: required
    package_manager_present: required
    license_present: required
    private_field_present: required
  governance:
    branch_protection_capability_evidence: required
    required_status_checks_evidence: required
    force_push_protection_evidence: required
    dependency_update_automation_present: required
    security_policy_present: required
  test_posture:
    current_test_count: required
    coverage_provider_present: required
    current_coverage_baseline_available: required
  filesystem:
    atomic_write_implementation_summary: required
    temp_file_creation_behavior: required
  roots:
    existing_repository_path_behavior: required
    implementation_root_execution_surface: required
  recalculated_entry_risk: required
```

### Gate A risk aggregation rule

For Gate A and milestone closure:

```text
recalculatedRisk = max(currentScore for every open M21 hazard)
```

- Each hazard starts from its inherent score in Section 13.
- Gate A evidence and verified controls may reduce the current score, but the reduction must be justified per hazard.
- Closed hazards may be recorded as `0`; accepted risks retain their approved residual score.
- The milestone implementation-entry score is the maximum current score after Gate A controls.
- The milestone merge-residual score is the maximum residual score after implementation, validation, and review.
- Average risk, median risk, or a manually chosen overall score must not replace the maximum-hazard rule.

### Gate A pass conditions

- M20 baseline is consistent or discrepancies are resolved explicitly.
- The selected Node.js support range is based on currently supported official LTS releases and verified against the repository.
- The exact pnpm version is selected from actual repository/CI compatibility evidence.
- The branch-protection decision category is approved.
- The selected Vitest coverage provider is compatible with the current Vitest version.
- No proposed implementation introduces command execution or hard containment of external implementation roots.
- Recalculated implementation-entry risk is `<=25`.

A baseline conflict returns a blocked result. The agent must not repair history, retag milestones, or rewrite canonical state without an explicit reviewed correction plan.

---

## 4. Commands and User-Visible Behavior

M21 should prefer existing commands and reports. It must not add a broad new CLI surface merely for governance.

Permitted user-visible changes:

- additive runtime/governance/root diagnostics in an existing read-only report such as `aiqt manage`, `aiqt review`, or the repository's established equivalent;
- deterministic JSON fields corresponding to those diagnostics;
- warnings for external or missing implementation roots;
- documentation and repository configuration files.

Any exact command/output changes must follow existing `CommandResult`, deterministic ordering, JSON parity, and exit-code conventions.

Diagnostics must not convert a valid external implementation root into an error solely because it is outside the AIQT control root.

---

## 5. Scope

### 5.1 Runtime and package-manager support

- Select the supported Node.js LTS range using official current support status at implementation time.
- Test the selected range in CI before removing an older runtime.
- Add `engines.node` reflecting only verified support.
- Add an exact `packageManager` value for pnpm.
- Keep module format and TypeScript behavior unchanged unless a verified compatibility correction is required.
- Document the supported local-development baseline.

No package version or runtime claim may be added without a passing CI job or documented local evidence.

### 5.2 Package ownership and distribution intent

Gate A must resolve one of:

```yaml
package_distribution_intent:
  proprietary_private:
    package_json:
      private: true
      license: UNLICENSED
  distributable:
    package_json:
      private: false_or_omitted
      license: approved_SPDX_identifier
    repository:
      license_file: required
```

The implementation agent must not guess the license. Unresolved ownership intent is a human-input blocker for this Work Unit, not permission to choose a permissive license.

### 5.3 CI and branch-protection truthfulness

- Preserve all existing typecheck, lint, test, build, and version-governance checks.
- Add the supported Node.js CI matrix or an equivalent verified strategy.
- Record exactly one branch-protection decision:

```yaml
branch_protection_decision:
  status:
    - enabled
    - planned_upgrade
    - repository_publication_plan
    - accepted_unenforced_gap
  evidence: required
  rationale: required
  compensating_controls: required_when_unenforced
```

- When protection is unavailable, documentation and command output must call CI **advisory**, not enforced.
- M21 must not attempt to change GitHub billing, visibility, or branch settings automatically.
- External setup must be represented through configuration, documentation, and a clear user-action list.

### 5.4 Dependency and supply-chain monitoring

- Add `.github/dependabot.yml` for the npm ecosystem and GitHub Actions unless repository evidence justifies a different reviewed solution.
- Use a conservative weekly schedule, bounded open PRs, and deterministic grouping where appropriate.
- Confirm dependency graph and security-alert settings when platform access permits.
- Record unavailable platform settings as user actions; do not claim they are enabled without evidence.
- Do not auto-merge dependency updates.

### 5.5 Coverage baseline

- Add a compatible Vitest coverage provider, preferably `@vitest/coverage-v8` unless compatibility evidence requires another provider.
- Add a deterministic `coverage` script.
- Produce and document a baseline for critical modules, including at minimum:
  - filesystem and atomic writes;
  - canonical state stores and versioning;
  - workflow transitions and next-action computation;
  - Git/version governance;
  - issue/checkpoint amendment and effective-readiness services where present.
- Do not add an arbitrary repository-wide coverage threshold in M21.
- Identify candidate module-level thresholds for a future reviewed change.
- Keep generated coverage output out of canonical state and source control unless existing repository policy says otherwise.

### 5.6 Security policy

Add `SECURITY.md` containing:

- supported versions;
- reporting channel approved by the repository owner;
- expected initial response language that does not overpromise capacity;
- coordinated disclosure expectations;
- public/private repository-specific instructions;
- statement that secrets must not be placed in public issues.

Where the reporting channel requires user configuration, use a safe placeholder in documentation and return an explicit action item. Do not commit personal credentials or private contact data without approval.

### 5.7 Atomic-write hardening

Replace predictable temporary-file naming with collision-resistant exclusive creation while preserving the existing crash-safety sequence.

Required properties:

```yaml
atomic_write_properties:
  temp_location: same_directory_as_target
  name_entropy: cryptographically_strong_or_uuid
  creation: exclusive
  shell_usage: false
  fsync_temp_before_rename: preserved
  atomic_same_filesystem_rename: preserved
  cleanup_on_failure: preserved
  target_parent_sync_when_existing_contract_requires_it: preserved
```

The design should use Node core primitives such as `crypto.randomUUID()` or `randomBytes()` and exclusive file creation (`wx` or equivalent). It must not weaken permissions, overwrite another temporary file, follow an unsafe pre-existing temp path, or change canonical JSON formatting.

### 5.8 Control-root and implementation-root trust diagnostics

- Canonicalize roots when they exist using safe path resolution and realpath behavior.
- Preserve support for absolute and relative external implementation repositories.
- Report whether the implementation root:
  - exists;
  - is a directory;
  - is the control root or external;
  - is a Git repository when detectable;
  - resolves through a symlink;
  - is unavailable or unreadable.
- Treat external roots as a warning/trust classification, not an automatic error.
- Do not execute commands at the implementation root.
- Do not mutate, initialize, clean, reset, or repair the implementation repository.
- Do not silently rewrite `existingRepositoryPath`.

### 5.9 Maintainer recovery and release runbook

Create or update repository documentation covering:

- clean installation from a fresh clone;
- supported Node/pnpm setup;
- build/test/coverage commands;
- canonical-state backup and validation;
- tag/version verification;
- failed atomic-write recovery expectations;
- CI and branch-protection status;
- release checklist;
- rollback to the previous milestone tag;
- dependency-update review;
- owner actions still required outside the repository.

The runbook must be exercised through a documentation smoke test from a clean temporary clone or equivalent isolated environment.

---

## 6. Out of Scope

M21 must not introduce:

- evidence, reviewer, provider, or ProjectIssue schemas;
- external evidence imports;
- validation-command execution;
- arbitrary shell or subprocess execution;
- provider network calls;
- dynamic plugin loading;
- agent spawning;
- worktree creation or deletion;
- automatic branch protection or repository visibility changes;
- automatic dependency merging;
- checkpoint or amendment behavior changes;
- readiness or dependency-unblocking changes;
- workflow required mode;
- global coverage thresholds without baseline review;
- containment rules that prohibit the separate implementation repository supported by existing AIQT behavior.

---

## 7. Repository Implementation Areas

Exact paths must be confirmed against the repository. Expected areas include:

```text
package.json
pnpm-lock.yaml
.github/workflows/
.github/dependabot.yml
SECURITY.md
docs/versioning.md
docs/maintainer-recovery.md or existing equivalent
src/core/filesystem/atomic-write.ts
src/.../root-resolution.ts or current equivalent
src/.../manage/review/status diagnostics
src/core/output schemas when additive diagnostics are exposed
tests/unit/
tests/integration/
tests/fixtures/
```

Do not create duplicate modules when the repository already has an established owner for runtime capability, root resolution, issue reporting, or deterministic output.

---

## 8. Data and Compatibility Contract

M21 should not require an `AIQT_SCHEMA_VERSION` bump.

Rules:

- canonical project and state files must remain valid without new fields;
- runtime/governance data should remain repository configuration or derived diagnostics unless a reviewed persistent decision requires canonical storage;
- any additive command-output field must preserve deterministic JSON behavior;
- no migration may run during a read-only command;
- old project fixtures must behave identically except for explicitly added non-blocking warnings;
- external-root warnings must not change workflow state or `nextRecommendedCommand`.

The branch-protection decision should be persisted in repository governance documentation unless the existing AIQT project model already has a clearly appropriate, backward-compatible decision record. Do not invent a second governance state store.

---

## 9. Error and Exit-Code Contract

M21 uses the established public exit-code taxonomy:

```yaml
exit_codes:
  0: success_or_non_blocking_warning
  1: validation_or_quality_failure
  2: workflow_or_gate_blocked
  3: invalid_input_state_environment_or_filesystem_failure
  10: human_input_required
```

No M21 command or Gate A pathway may introduce a new numeric exit code.

| Situation | Exit code | Required behavior |
|---|---:|---|
| Gate A baseline conflict that cannot be resolved from read-only evidence | `2` | Return `blocked`; do not implement, repair history, retag, or rewrite canonical state |
| Unsupported actual Node.js runtime | `3` | Fail before normal command execution with deterministic unsupported-runtime guidance |
| Invalid or internally inconsistent runtime/package-manager configuration | `3` | Fail without mutating canonical state or repository governance files |
| Coverage command, test suite, typecheck, lint, or build fails while producing the baseline | `1` | Report validation failure; do not fabricate or publish a successful baseline |
| Coverage provider/configuration is invalid or incompatible | `3` | Report invalid environment/configuration and preserve existing package state when the change is not safely applicable |
| External implementation root is missing, unreadable, or not a directory during a read-only diagnostic command | `0` | Return a deterministic non-blocking warning unless the invoked command already requires that root |
| A current command requires the implementation root and that root is unavailable | `2` | Return `blocked`; do not silently fall back to the control root |
| Branch-protection API is unavailable, forbidden, or inconclusive during diagnostics | `0` | Report capability as `unknown` or `unavailable`; do not claim enforcement |
| Gate A cannot complete because the branch-protection decision still requires owner approval | `10` | Return `needs_input` with the required decision and evidence options |
| Dependabot, dependency-graph, security-alert, or repository setting cannot be changed automatically | `0` | Return a warning/user-action item when the repository files were completed correctly; do not claim the platform setting is enabled |
| Required owner decision for dependency/governance configuration remains unresolved | `10` | Return `needs_input`; do not guess or apply irreversible platform choices |
| Atomic-write temporary-name collision occurs and a bounded retry succeeds | `0` | Complete normally and leave no orphan temporary file |
| Atomic-write temporary-name collision exhausts the bounded retry policy | `3` | Fail without modifying the target; clean safe temporary artifacts |
| Atomic write, fsync, rename, permission, or parent-directory operation fails | `3` | Preserve the existing target where possible and clean temporary artifacts safely |
| License/distribution intent is unresolved | `10` | Return `needs_input`; do not select a license or change `private` semantics |
| Governance/coverage/security check completes with truthful non-blocking warnings only | `0` | Return `warning` status with deterministic findings and user actions |

Additional rules:

- Exit `1` is reserved for an executed validation or quality gate that failed; it is not used for missing human decisions.
- Exit `2` is reserved for a valid workflow or Gate A state that cannot proceed safely.
- Exit `3` is used for malformed configuration, unsupported environment, invalid repository state, or filesystem failure.
- Exit `10` is used only when an explicit owner decision or other human input is required.
- Warning-only diagnostics return exit `0` and must not alter workflow state or `nextRecommendedCommand`.
- No M21 condition may change a Work Unit to `done`, `needs_review`, or `blocked` outside the existing checkpoint/review contracts.

---

## 10. Testing Contract

### 10.1 Full regression

Run all existing repository validation commands on every supported CI runtime.

### 10.2 Runtime/package tests

- supported Node versions pass installation, typecheck, lint, tests, and build;
- unsupported-version messaging is tested when the repository already enforces engines;
- exact pnpm metadata matches the lockfile/CI decision;
- package metadata is internally consistent.

### 10.3 Atomic-write tests

At minimum:

- exclusive temporary-file creation;
- forced collision handling;
- cleanup after write/fsync/rename failure;
- target remains unchanged after failure;
- successful same-directory rename;
- malformed target-parent scenarios;
- Windows-compatible path behavior;
- deterministic persisted content remains unchanged;
- no orphan temporary file after successful write.

### 10.4 Root diagnostics tests

- control root equals implementation root;
- valid external absolute root;
- valid external relative root;
- missing external root;
- non-directory path;
- symlinked root;
- non-Git directory;
- spaces and Unicode in path;
- Windows separators/drives where test environment permits;
- warnings do not mutate canonical files or next action.

### 10.5 Coverage tests

- coverage command succeeds reproducibly;
- critical modules appear in the report;
- output directory is ignored appropriately;
- no arbitrary threshold blocks CI;
- baseline document is derived from actual output.

### 10.6 Governance/configuration tests

- Dependabot YAML parses and includes npm plus GitHub Actions;
- SECURITY.md contains required sections without unresolved unsafe placeholders;
- branch-protection decision has evidence, rationale, and compensating controls when applicable;
- CI documentation uses `enforced` only when current platform evidence proves it.

### 10.7 Clean-environment smoke test

From a clean clone or isolated temporary copy:

1. install the exact package manager;
2. install dependencies using the lockfile;
3. run typecheck, lint, tests, build, and coverage;
4. inspect package metadata;
5. exercise the maintainer recovery/release checklist through the point possible without external account actions.

---

## 11. Work Units

The final AIQT plan may refine IDs but must preserve these boundaries.

### WU21-01 — Gate A Baseline Audit

Objective: verify M20, runtime, CI, package metadata, GitHub capability, tests, filesystem behavior, and roots; recalculate entry risk.

Writes: audit/report artifacts only; no implementation change beyond a reviewed baseline record.

Acceptance:

- complete Gate A report;
- no baseline contradiction hidden;
- entry risk `<=25` before WU21-02 starts.

### WU21-02 — Runtime and Package Metadata

Objective: establish verified Node/pnpm support and explicit ownership/distribution metadata.

Dependencies: WU21-01 and human license decision where required.

### WU21-03 — CI Matrix and Governance Truthfulness

Objective: validate the supported runtime matrix and record branch-protection status without overstating enforcement.

Dependencies: WU21-02.

### WU21-04 — Dependency Monitoring

Objective: add conservative Dependabot configuration and document platform settings/user actions.

Dependencies: WU21-01.

### WU21-05 — Coverage Provider and Baseline

Objective: add compatible coverage tooling and produce a critical-module baseline without global thresholds.

Dependencies: WU21-02.

### WU21-06 — Security and Distribution Governance

Objective: add SECURITY.md, finalize package license intent, and align governance documentation.

Dependencies: WU21-02 and required human decisions.

### WU21-07 — Atomic-Write Hardening

Objective: use collision-resistant exclusive temp creation without regressing crash safety.

Dependencies: WU21-01.

### WU21-08 — Repository Root Trust Diagnostics

Objective: add warning-first control/implementation-root diagnostics with no execution or containment regression.

Dependencies: WU21-01.

### WU21-09 — Maintainer Recovery and Release Runbook

Objective: document and smoke-test clean setup, recovery, governance, release, and rollback.

Dependencies: WU21-03 through WU21-08.

### WU21-10 — Final Regression, Dogfood, and Milestone Closure

Objective: run the complete cross-platform/clean-environment validation, review findings, recalculate residual risk, close M21, and prepare M22 Gate B evidence.

Dependencies: all preceding Work Units.

Acceptance:

- all required validations pass;
- no command-execution surface added;
- old workflows remain equivalent;
- merge residual risk `<=10`;
- M21 commit/tag/version records are consistent.

---

## 12. Source-Control and Checkpoint Discipline

M21 intentionally introduces per-Work-Unit commits, tags, and checkpoints for AIQT's own repository. Earlier AIQT milestones generally used one milestone-level tag. This is a deliberate, bounded governance experiment for M21 because its Work Units change heterogeneous operational surfaces and must remain independently auditable and reversible. It does not automatically redefine the convention for later milestones; M21 closure must review whether the practice should continue.

- Default branch remains `main`.
- Work begins from a clean, verified baseline.
- Each completed Work Unit receives:
  - one detailed commit;
  - one unique tag;
  - a commit body listing objective, changes, validation, user actions, and `Risk: N/100`;
  - an AIQT checkpoint with structured evidence.
- Do not combine unrelated Work Units into one commit.
- Do not rewrite or delete historical milestone tags.
- Do not force-push.
- Final milestone closure receives a literal M21 tag chosen consistently with repository conventions and a package-version decision justified by the existing versioning policy.

Suggested Work Unit tag pattern:

```text
m21-wu01-baseline-audit
m21-wu02-runtime-package-metadata
...
m21-wu10-final-hardening-validation
```

The exact final milestone tag must follow the repository's established literal tag convention.

---

## 13. Risk Register

| ID | Hazard | Probability | Impact | Inherent | Required controls | Entry/Residual target |
|---|---|---|---|---:|---|---:|
| M21-R01 | Runtime migration breaks ESM/build/test behavior | Medium | High | 50 | CI matrix, reversible metadata, no feature semantics | 25 / 10 |
| M21-R02 | Governance claims exceed platform enforcement | Medium | High | 50 | API/settings evidence, explicit decision, truthful wording | 25 / 10 |
| M21-R03 | External-root diagnostics break separate repositories | Medium | High | 50 | warning-first, no containment rejection, no execution | 25 / 10 |
| M21-R04 | Coverage creates false assurance | Medium | Medium | 33 | baseline only, critical-module analysis, thresholds deferred | 17 / 8 |
| M21-R05 | Dependency automation creates noise or unsafe merges | Low | Medium | 17 | weekly/capped PRs, no auto-merge | 8 / 8 |
| M21-R06 | SECURITY.md overpromises support | Low | Medium | 17 | owner-approved truthful policy | 8 / 8 |
| M21-R07 | Temp-file hardening regresses atomicity | Medium | High | 50 | exclusive same-directory temp, fsync/rename/cleanup tests | 25 / 10 |
| M21-R08 | License choice unintentionally changes IP posture | Medium | Critical | 67 | mandatory human decision, no guessed license | 25 / 8 |
| M21-R09 | New diagnostics drift from existing output contracts | Low | Medium | 17 | existing report/service reuse, JSON parity tests | 8 / 8 |

Risk aggregation is deterministic:

```text
implementationEntryRisk = max(entry score of every open M21 hazard)
mergeResidualRisk = max(residual score of every open or accepted M21 hazard)
```

M21 implementation must not begin until `implementationEntryRisk <= 25`. It must not merge until `mergeResidualRisk <= 10`. The implementation report must show the current score and evidence for each hazard rather than reporting only the aggregate.

---

## 14. Definition of Done

M21 is complete only when:

```yaml
definition_of_done:
  baseline:
    - M20 commit/tag/version/state verified
  runtime:
    - supported Node range tested and declared
    - exact pnpm packageManager declared
    - clean install succeeds
  package:
    - distribution intent and license explicit
  ci:
    - supported matrix green
    - existing quality/version gates preserved
    - enforced vs advisory status truthful
  supply_chain:
    - dependency monitoring implemented or rejected with reviewed compensating control
  coverage:
    - provider installed
    - deterministic baseline generated
    - no arbitrary global threshold
  security:
    - SECURITY.md approved
  filesystem:
    - collision-resistant exclusive temp creation
    - atomic-write regression suite green
  roots:
    - warning-first trust diagnostics implemented
    - external repository behavior preserved
    - no execution surface added
  operations:
    - recovery/release runbook smoke-tested
    - external user actions listed clearly
  compatibility:
    - historical fixtures and workflows pass
    - canonical schema unchanged unless separately approved
  governance:
    - every Work Unit committed, tagged, and checkpointed
    - residual risk <= 10
```

---

## 15. Required Agent Output

For each Work Unit, the implementation agent must return:

```yaml
work_unit_result:
  work_unit_id: required
  baseline_verified: required
  summary: required
  files_changed: required
  behavior_changed: required
  tests_added_or_updated: required
  validation_commands_and_results: required
  acceptance_criteria_evidence: required
  external_user_actions: required
  commit: required
  tag: required
  risk_score_0_to_100: required
  residual_findings: required
  next_aiqt_command: required
```

For final M21 closure, also return:

- supported runtime/package-manager decision;
- package ownership/license decision;
- branch-protection decision and current evidence;
- coverage baseline summary;
- dependency-monitoring status;
- security-policy status;
- atomic-write evidence;
- root-diagnostics evidence;
- clean-environment smoke evidence;
- full regression result;
- final residual-risk calculation;
- Gate B readiness report for M22.

---

## 16. Review Questions

The reviewer should verify:

1. Does M21 remain strictly outside evidence/provider/checkpoint semantics?
2. Is every package/runtime claim verified against the real repository and supported official releases?
3. Can a private/free GitHub repository be described truthfully without pretending CI is enforced?
4. Is the license decision human-controlled?
5. Does coverage establish a baseline without numeric theater?
6. Does atomic-write hardening preserve fsync, rename, cleanup, and deterministic output behavior?
7. Do root diagnostics preserve separate implementation repositories and avoid execution?
8. Are all external setup steps placeholders/configuration plus an explicit user-action list?
9. Are all historical tests and canonical state fixtures preserved?
10. Is implementation-entry risk `<=25` and merge residual risk `<=10` based on evidence rather than assertion?

Approval threshold for this build specification:

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  implementation_entry_risk_maximum: 25
  hidden_execution_surfaces: 0
```
