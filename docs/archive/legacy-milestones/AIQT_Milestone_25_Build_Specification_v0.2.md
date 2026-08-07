# AIQT Milestone 25 Build Specification v0.2

## Managed Workspace Provider Adapters

```yaml
document:
  product: AIQT CLI
  type: Build Specification
  version: 0.2
  status: Revised review candidate before build handoff
  milestone:
    id: M25
    title: Managed Workspace Provider Adapters
  baseline:
    product_version: 0.11.0
    product_release_tag: v0.11.0
    development_baseline_commit: ce2d851
    milestone_tag: m24-workspace-assignment-parallel-eligibility
    test_count: 1683
    schema_version: 0.5.0
    open_critical_high_dependency_alerts: 0
    gate_e_status: open
    verification_required: true
  aligns_with:
    - AIQT Post-M20 Proposed Milestones Roadmap v0.4
    - AIQT Milestone 24 Build Specification v0.2
    - M24 final closure report
    - current Work Unit, execution-metadata, readiness, graph, packet, state, runlog, Git-governance, and version owners
  primary_agent_target: Claude Code, Codex, or equivalent coding agent
  architecture_role: local workflow control plane with bounded workspace side effects
  risk:
    inherent: 75
    controlled_design_target: 30
    implementation_entry_target: 30
    merge_residual_target: 15
```

---

## 0. Document Position

M24 introduced logical workspace assignment and advisory parallel eligibility.

M25 resolves approved logical assignment metadata into bounded local physical workspaces through a static provider layer.

Its responsibility is:

```text
M24 logical workspace intent
+ verified repository state
+ static provider policy
+ bounded local Git/filesystem operations
+ recoverable pending-operation state
→ managed workspace binding
```

M25 introduces controlled side effects for the first time in this roadmap segment.

It may:

- resolve a shared assignment to the existing implementation repository;
- create an isolated local Git worktree;
- inspect managed workspace health;
- release a clean isolated worktree;
- reconcile interrupted workspace operations;
- attach physical workspace information to one Work Unit handoff packet.

It must not:

- invoke a coding agent;
- execute Work Unit validation commands;
- schedule background work;
- monitor long-running execution;
- fetch or push Git remotes;
- merge, rebase, reset, cherry-pick, or amend commits;
- delete branches;
- force-remove dirty worktrees;
- remove unmanaged directories;
- discover dynamic providers;
- call cloud development-environment APIs;
- manage credentials;
- enforce parallel execution;
- implement M26 execution attempts, heartbeats, retries, or cancellation.

The architecture remains:

```text
M24 declares logical intent and advisory compatibility.
M25 prepares and records a bounded physical workspace.
M26 may later bind a long-running execution attempt to that workspace.
```

AIQT is the product being developed. M25 must be managed through repository specifications, Git, tests, CI, commits, tags, and structured reports. It must not use `.aiqt/` self-management state.

### 0.1 Gate and Work Unit governance

Gate E is a read-only pre-build gate.

Therefore:

- Gate E creates no commit or tag;
- every numbered M25 Work Unit must produce one detailed commit and one unique annotated tag;
- Work Units may not be combined without prior explicit approval;
- no retroactive waiver may be used to conceal inaccurate implementation history;
- final release and milestone tags are created only after real CI passes.

### 0.2 v0.2 Change Summary

v0.2 resolves the two findings from the v0.1 review:

1. Workspace identity is now split into a deterministic logical series identity and a monotonic workspace generation. Active or pending instances are reused idempotently; a new prepare after an immutable released record allocates the next generation and therefore a new workspace ID, path, and branch.
2. The Work Unit status table is now exhaustive. `planned` is explicitly prohibited from new workspace preparation because readiness remains owned by the existing graph engine.

The change preserves immutable released records, idempotent retries, deterministic ownership, static providers, the bounded Git surface, and all risk thresholds.

---

## 1. Objective

M25 must prove that AIQT can:

1. define one static provider contract without introducing dynamic plugins;
2. map M24 `shared`, `isolated`, and `none` modes deterministically;
3. resolve `shared` to the existing implementation root without creating filesystem state;
4. create an isolated Git worktree from a verified committed baseline;
5. create a deterministic AIQT-owned branch without accepting arbitrary Git arguments;
6. preserve immutable released workspace history while allowing a later explicit prepare of the same logical assignment through monotonic workspace generations;
7. persist canonical workspace and Work Unit binding records;
8. inspect workspace existence, Git registration, branch identity, cleanliness, and drift;
9. release only clean, AIQT-managed isolated worktrees;
10. never delete a branch during release;
11. recover safely from interruption between canonical-state writes and provider side effects;
12. make prepare and release idempotent;
13. expose explicit preview, prepare, status, release, and recovery commands;
14. include prepared physical workspace details in the current Work Unit packet;
15. preserve M24 advisory parallel semantics;
16. add no agent execution, scheduler, provider network, or remote Git behavior.

---

## 2. Static Provider Registry

M25 supports exactly:

```yaml
workspace_providers:
  - shared-repository@1
  - git-worktree@1
```

Resolution is fixed:

```yaml
provider_resolution:
  workspace_mode_shared: shared-repository@1
  workspace_mode_isolated: git-worktree@1
  workspace_mode_none: no_provider
```

Rules:

- provider selection is determined by canonical M24 metadata;
- payloads and CLI flags cannot select an arbitrary provider;
- no package discovery;
- no filesystem plugin discovery;
- no environment-controlled provider registration;
- no dynamic import based on project state;
- no third-party provider installation;
- unknown provider IDs in canonical state are invalid;
- provider IDs and contract versions are compile-time constants.

M25 must not add a generic `--provider` escape hatch.

---

## 3. Gate E — Mandatory Pre-Build Verification

No implementation begins until a read-only Gate E report verifies the live repository.

```yaml
gate_e_report:
  repository:
    branch: required
    clean_status: required
    origin_sync: required
    head_commit: required
    package_version: required
    release_tag: required
    m24_tag: required
    test_count: required
    dependency_alerts: required
    git_version: required
    git_worktree_support: required
  roots:
    control_root_owner: required
    implementation_root_owner: required
    repository_root_resolution: required
    repository_root_trust_diagnostics: required
    workspace_root_configuration_owner: required_or_gap
  m24:
    execution_metadata_owner: required
    workspace_assignment_validation_owner: required
    terminal_status_owner: required
    active_status_owner: required
    parallel_eligibility_owner: required
    isolated_key_uniqueness_owner: required
  workflow:
    WorkUnit_schema_owner: required
    WorkUnit_ID_owner: required
    status_transition_owner: required
    next_selection_owner: required
    handoff_packet_owner: required
  persistence:
    state_owner: required
    candidate_state_owner: required
    atomic_state_write_owner: required
    runlog_owner: required
    current_recovery_model: required
    canonical_ID_allocation_owner: required
    monotonic_generation_allocation_pattern: required_or_gap
  source_control:
    current_git_command_policy: required
    commit_and_tag_guidance_owner: required
    default_branch_owner: required
  cli:
    command_registration_owner: required
    preview_conventions: required
    JSON_output_owner: required
    error_envelope_owner: required
    exit_code_owner: required
  compatibility:
    M22_matrix: required
    M23_matrix: required
    M24_matrix: required
    schema_version: required
    read_only_non_materialization: required
  execution_boundary:
    agent_execution_added: false
    validation_execution_added: false
    remote_git_added: false
    provider_network_added: false
    scheduler_added: false
  risk:
    recalculated_entry_risk: required
```

Expected baseline claims:

```yaml
expected_gate_e_baseline:
  branch: main
  package_version: 0.11.0
  product_release_tag: v0.11.0
  development_commit: ce2d851
  tests: 1683
  schema_version: 0.5.0
  critical_high_dependency_alerts: 0
```

Treat these as claims to verify.

### 3.1 Gate E risk rule

```text
implementationEntryRisk =
  max(current score of every open M25 hazard after Gate E controls)
```

Implementation may begin only when:

```text
implementationEntryRisk <= 30
```

Stop before writing code if:

- the implementation root is not reliably identifiable;
- Git worktree support cannot be verified;
- workspace-root ownership cannot be added safely;
- M24 metadata cannot map deterministically to providers;
- canonical IDs or candidate-state ownership are unclear;
- recoverable external side effects cannot be designed without destructive cleanup;
- implementation would require remote Git or agent execution.

---

## 4. Workspace Root Configuration

### 4.1 Derived default

The default isolated-workspace root is derived from the implementation root:

```text
<implementation-root-parent>/.aiqt-workspaces/<implementation-root-name>
```

Example:

```text
/projects/app
→ /projects/.aiqt-workspaces/app
```

Rules:

- the workspace root must be outside the implementation root;
- it must not equal the implementation root;
- it must not be nested inside another managed worktree for the same project;
- filesystem root is prohibited;
- the user’s home directory itself is prohibited;
- the implementation-root parent itself is prohibited;
- a symlink workspace root is prohibited in M25;
- existing ancestor symlinks between the trusted parent and workspace root are prohibited;
- the derived root is not persisted merely by read-only inspection.

### 4.2 Optional explicit configuration

M25 may extend the existing project-update owner with:

```text
aiqt update --workspace-root <path>
```

only if Gate E confirms that this is the canonical configuration path.

Rules:

- absolute and implementation-root-parent-relative inputs may be accepted;
- the normalized resolved root is persisted in project configuration;
- validation occurs before mutation;
- invalid root → exit `3`;
- no directory is created by configuration alone;
- changing the root while active managed workspaces exist is blocked with exit `2`;
- read-only commands do not rewrite the configured value.

Do not create a second configuration file.

---

## 5. Canonical State Contracts

Gate E must identify the exact additive state owner.

Preferred shape:

```yaml
State:
  managedWorkspaces: optional_array
  workspaceBindings: optional_array
  pendingWorkspaceOperations: optional_array
```

Historical states without these fields remain valid.

### 5.1 Managed workspace

```yaml
ManagedWorkspace:
  id: canonical_workspace_id
  workspaceSeriesKey: deterministic_sha256
  generation: positive_integer
  providerId:
    - shared-repository@1
    - git-worktree@1
  assignmentKey: logical_assignment_key
  mode:
    - shared
    - isolated
  access:
    - read_only
    - read_write
  implementationRoot: normalized_absolute_path
  workspacePath: normalized_absolute_path
  branchName: optional
  baseCommit: full_commit_sha
  lifecycleStatus:
    - ready
    - released
  createdAt: timestamp
  releasedAt: optional_timestamp
```

Rules:

- no credentials;
- no remote URL;
- no provider token;
- no agent/session/process data;
- no mutable observation fields such as dirty status;
- `branchName` is required only for `git-worktree@1`;
- shared workspace path equals the implementation root;
- isolated workspace path must be a descendant of the trusted workspace root;
- released records remain immutable historical records;
- a released record is never reactivated;
- `workspaceSeriesKey` identifies the logical workspace series defined in §6;
- `generation` starts at `1` and increases monotonically within one series;
- `(workspaceSeriesKey, generation)` is unique;
- a later prepare after release creates a new generated workspace record rather than reusing or mutating the released record.

### 5.2 Workspace binding

```yaml
WorkspaceBinding:
  id: canonical_binding_id
  workUnitId: canonical_work_unit_id
  workspaceId: canonical_workspace_id
  status:
    - active
    - released
  boundAt: timestamp
  releasedAt: optional_timestamp
```

Rules:

- one active binding per Work Unit;
- one active isolated binding per workspace;
- multiple active shared bindings may reference one shared workspace;
- binding does not change Work Unit status;
- releasing a binding does not complete or cancel a Work Unit.

### 5.3 Pending operation

```yaml
PendingWorkspaceOperation:
  id: deterministic_operation_id
  type:
    - prepare
    - release
  workUnitId: canonical_work_unit_id
  workspaceId: canonical_workspace_id
  workspaceSeriesKey: deterministic_sha256
  generation: positive_integer
  providerId: static_provider_id
  expectedWorkspacePath: normalized_absolute_path
  expectedBranchName: optional
  baseCommit: full_commit_sha
  createdAt: timestamp
```

Rules:

- pending operations are canonical recovery markers;
- only currently pending operations are stored;
- completed operations are removed after canonical finalization;
- maximum one pending operation per Work Unit;
- maximum one pending operation per workspace path;
- raw Git output is not persisted;
- pending operation IDs are deterministic and idempotent;
- pending prepare records reserve one exact `(workspaceSeriesKey, generation)` pair;
- recovery and retries reuse that reserved generation;
- no random operation ID may cause duplicate recovery records.

No schema-version bump is expected unless Gate E proves additive compatibility impossible.

---

## 6. Workspace Series, Generation, and Instance Identity

M25 separates logical identity from physical workspace-instance identity.

This prevents a released immutable record from colliding with a later legitimate prepare of the same assignment.

### 6.1 Logical workspace series key

For shared mode:

```yaml
canonical_input:
  - project_id
  - provider_id
  - assignment_key
  - implementation_root
```

For isolated mode:

```yaml
canonical_input:
  - project_id
  - provider_id
  - assignment_key
  - base_commit
```

The canonical tuple is encoded through canonical JSON or an unambiguous length-prefixed representation and hashed with SHA-256.

The result is `workspaceSeriesKey`.

Rules:

- do not use ambiguous string concatenation;
- the same logical request resolves the same series key;
- different projects do not collide;
- different assignment keys do not collide;
- different isolated base commits produce distinct series keys;
- the series key is not a canonical workspace ID;
- the series key is not an issue, evidence, binding, operation, or execution-attempt key.

### 6.2 Monotonic generation

Each physical or shared managed-workspace record belongs to one series and has a positive integer `generation`.

Allocation rules:

```yaml
generation_allocation:
  active_workspace_for_series:
    action: reuse_active_workspace
    new_generation: false

  pending_prepare_for_series:
    action: reuse_pending_generation
    new_generation: false

  only_released_history_or_no_history:
    action: allocate
    generation: 1 + max(existing_generation_for_series, default=0)
```

Rules:

1. generation allocation occurs while holding the M25 workspace-operation lock;
2. active or pending records are inspected before allocating;
3. a retry of the same prepare reuses the active or pending generation;
4. a completed release makes the prior generation immutable;
5. a later explicit prepare for the same series allocates the next generation;
6. generations are never reused, decremented, compacted, or renumbered;
7. a missing generation between historical records is allowed and not repaired;
8. concurrent allocation of the same generation must be prevented by the operation lock and candidate-state uniqueness validation;
9. the maximum generation is bounded by the safe integer and schema limits;
10. generation allocation is canonical-state-dependent but deterministic for an identical locked state.

### 6.3 Workspace instance identity

The physical workspace instance identity is derived from:

```yaml
canonical_input:
  - workspaceSeriesKey
  - generation
```

The encoded tuple is hashed with SHA-256.

Canonical workspace and binding IDs must use the existing ID owner where possible, with the instance identity as deterministic input.

Required behavior:

```text
same series + active instance
→ link_existing or no_op

same series + pending prepare
→ continue or recover the reserved generation

same series + released latest instance
→ allocate generation + 1

same series + same generation + conflicting path/branch/state
→ conflict, no adoption

different series
→ distinct workspace history
```

A released record is never reactivated, overwritten, or assigned a new binding.

### 6.4 Physical path

The isolated physical path leaf is derived from the canonical workspace ID for the generated instance, not directly from `assignmentKey`.

```text
<workspace-root>/<workspace-id>
```

Therefore, a later generation receives a distinct path even when assignment key and base commit are unchanged.

### 6.5 Branch identity

The branch hash component is derived from the generated workspace instance identity.

Therefore, a later generation receives a distinct branch while the prior released branch remains preserved.



---

## 7. Branch Naming

The Git worktree provider creates one deterministic branch:

```text
aiqt/<project-token>/<work-unit-token>-<workspace-hash>
```

Rules:

- provider code owns the complete template;
- maximum full branch-name length: `180`;
- tokens use a strict lowercase ASCII subset;
- repeated separators are collapsed by the provider;
- branch name must pass `git check-ref-format --branch`;
- user input cannot inject Git options;
- no CLI flag accepts an arbitrary branch name;
- no existing unrelated branch may be adopted;
- branch collision with a different workspace is exit `3`;
- existing branch associated with the same active or pending generated workspace instance may be reused only when provider inspection proves exact ownership;
- a branch from a released generation is never reused for a later generation;
- release never deletes the branch;
- M25 never merges, rebases, resets, cherry-picks, or force-updates the branch.

---

## 8. Controlled Git Command Runner

M25 introduces one internal Git runner owned by the provider layer.

Requirements:

```yaml
git_runner:
  executable: git
  shell: false
  argument_form: fixed_array
  timeout_ms: 30000
  max_stdout_bytes: 1048576
  max_stderr_bytes: 1048576
  interactive_prompts: disabled
  cwd: verified_repository_or_workspace
  environment:
    GIT_TERMINAL_PROMPT: "0"
```

Allowed subcommands:

```yaml
read_only:
  - rev-parse
  - status
  - worktree list
  - branch --show-current
  - check-ref-format
  - diff --quiet
  - ls-files --others --exclude-standard
  - version

mutating:
  - worktree add
  - worktree remove
```

Rules:

- `branch` creation may occur only as the fixed `worktree add -b <derived-branch> <derived-path> <full-sha>` template;
- `worktree remove` must never use `--force`;
- no command accepts raw user-provided argument arrays;
- no shell string;
- no `sh`, `cmd`, PowerShell, or terminal invocation;
- no Git aliases;
- no remote commands;
- no `fetch`, `pull`, `push`, `clone`, or submodule command;
- no hooks are invoked intentionally;
- raw stdout/stderr is bounded and not persisted to state or runlog;
- errors expose a stable code and bounded sanitized summary.

---

## 9. Shared Repository Provider

Provider ID:

```text
shared-repository@1
```

Behavior:

- resolves the physical workspace to the verified implementation root;
- creates no directory;
- creates no branch;
- runs no mutating Git command;
- creates or reuses one active shared `ManagedWorkspace` per logical series;
- allows multiple active bindings to that active generation;
- after the final binding is released, a later prepare allocates the next shared generation rather than reactivating the released record;
- records the current full HEAD commit as `baseCommit`;
- reports current branch and cleanliness as derived status only;
- release removes only the selected binding;
- the shared workspace record becomes `released` only when no active bindings remain;
- release never deletes or alters the implementation repository.

Prepare is blocked with exit `3` when:

- M24 mode is not `shared`;
- implementation root is not a valid Git repository;
- assignment metadata is invalid;
- an active isolated workspace already owns the same canonical workspace identity.

Dirty shared repositories are reported but not modified. A warning is returned rather than automatic cleanup.

---

## 10. Git Worktree Provider

Provider ID:

```text
git-worktree@1
```

### 10.1 Prepare preconditions

Prepare requires:

- Work Unit mode `isolated`;
- valid M24 metadata;
- Work Unit status allowed by §13;
- implementation root is a trusted Git repository;
- implementation root HEAD resolves to a full commit SHA;
- implementation repository working tree is clean;
- no unresolved merge/rebase/cherry-pick operation;
- workspace root passes §4;
- target path is absent or exactly matches the same managed workspace;
- branch is absent or exactly owned by the same managed workspace;
- no conflicting pending operation;
- no conflicting active binding already exists for the Work Unit;
- generation resolution from §6 has completed under the operation lock.

M25 uses the committed `HEAD` as the base.

It does not include uncommitted changes.

### 10.2 Prepare side effect

Fixed operation:

```text
git worktree add -b <derived-branch> <derived-path> <full-head-sha>
```

Rules:

- no `--force`;
- no detached worktree;
- no remote tracking branch;
- no fetch;
- no user-provided ref;
- no nested worktree;
- no target path pre-creation beyond the trusted parent root;
- parent workspace root may be created through bounded recursive directory creation after validation;
- provider must verify the resulting worktree through `git worktree list --porcelain`;
- provider must verify branch identity and repository relationship before canonical finalization.

### 10.3 Idempotent reuse

Repeated prepare returns `link_existing` or `no_op` when:

- an active binding already exists for the same generated workspace instance;
- or a pending prepare reserves the same generation and the physical result matches;
- workspace path exists;
- Git registers it as the expected worktree;
- branch matches;
- provider ID, series key, generation, and instance identity match.

When the latest matching workspace is released, prepare allocates the next generation and creates a distinct path and branch.

Any mismatch is a conflict and causes no automatic adoption.

---

## 11. Workspace Inspection

Derived status:

```yaml
WorkspaceInspection:
  workspaceId: required
  providerId: required
  lifecycleStatus: canonical
  effectiveStatus:
    - ready
    - dirty
    - missing
    - drifted
    - released
    - recovery_required
  pathExists: boolean
  gitRegistered: boolean
  branchMatches: boolean
  currentCommit: optional_full_sha
  clean: optional_boolean
  activeBindingWorkUnitIds: bounded_array
  warnings: bounded_sorted_array
```

Rules:

- inspection is read-only;
- no state or runlog mutation;
- no provider repair;
- shared provider does not require Git worktree registration;
- released records are not reclassified as ready;
- dirty means tracked modifications or untracked files exist;
- ignored files alone do not make the worktree dirty;
- drift includes path mismatch, branch mismatch, repository mismatch, or registration mismatch;
- raw Git output is not returned;
- physical path may be shown locally but must not be included in general project exports unless explicitly requested.

---

## 12. Release

### 12.1 Shared provider release

- releases the selected Work Unit binding;
- does not modify the implementation repository;
- marks the shared workspace released only when no active bindings remain;
- repeated release is a no-op;
- no directory or branch operation occurs.

### 12.2 Isolated provider release

Release requires:

- active binding exists;
- canonical workspace uses `git-worktree@1`;
- workspace path is under the trusted workspace root;
- Git registers the exact path;
- branch matches the canonical record;
- workspace is clean;
- no unresolved Git operation;
- no pending operation for the workspace;
- no M26 execution attempt exists, because M26 is not yet implemented.

Fixed operation:

```text
git worktree remove <derived-path>
```

Rules:

- no `--force`;
- never delete branch;
- never delete an unmanaged path;
- never call recursive filesystem deletion on the workspace path;
- if dirty → exit `2`, zero side effect;
- if missing but canonical state says ready → recovery is required;
- repeated release after successful finalization is a no-op.

---

## 13. Work Unit Status Eligibility

Gate E must verify exact status semantics.

Preferred rules:

```yaml
prepare_allowed:
  - ready
  - in_progress

prepare_existing_binding_inspection_allowed:
  - needs_review

new_prepare_prohibited:
  - planned
  - done
  - replanned
  - cancelled

release_allowed:
  - any_status_with_explicit_command
```

The table is exhaustive over the canonical Work Unit status enum.

`planned` is explicitly prohibited because the Work Unit is not effectively ready and M25 must not pre-stage a physical workspace ahead of the existing graph/readiness owner.

Rules:

- workspace preparation does not change Work Unit status;
- workspace release does not change Work Unit status;
- `next` remains the owner of `ready → in_progress`;
- checkpoint remains the owner of completion transitions;
- M25 does not redefine readiness;
- `planned` never qualifies for prepare even when its metadata is otherwise valid;
- a `needs_review` Work Unit may retain and inspect an existing workspace but cannot create a new one without explicit future policy.

If current repository statuses differ, Gate E must reconcile them before implementation.

---

## 14. Recoverable Side-Effect Protocol

M25 must not perform a provider mutation before recording a deterministic pending operation.

### 14.1 Prepare protocol

```text
1. validate canonical state and provider plan
2. under the operation lock, resolve the logical series and active/pending/released history
3. reuse or allocate one exact generation
4. build deterministic pending prepare operation reserving that generation
5. atomically persist pending operation
6. perform bounded provider side effect
7. inspect and verify physical result
8. atomically persist:
   - ManagedWorkspace
   - WorkspaceBinding
   - removal of pending operation
9. append bounded runlog event
```

### 14.2 Release protocol

```text
1. validate canonical state and release plan
2. atomically persist pending release operation
3. perform bounded provider side effect
4. inspect and verify removal or shared unbinding
5. atomically persist:
   - released binding
   - released workspace when applicable
   - removal of pending operation
6. append bounded runlog event
```

### 14.3 Failure handling

If provider side effect fails:

- attempt a candidate-state cleanup that removes the pending operation only when inspection proves no side effect occurred;
- otherwise preserve the pending operation;
- return exit `2` for environment/provider blockage or `3` for invalid/conflicting state;
- never guess that an external side effect did or did not occur.

If final state persistence fails after side effect:

- pending operation remains canonical;
- `workspace recover` must inspect and finalize or safely roll back;
- no unmanaged deletion is permitted.

If runlog append fails after final state persistence:

- state remains authoritative;
- retry is idempotent;
- existing advisory-runlog-gap policy applies.

---

## 15. Recovery

Commands:

```text
aiqt workspace recover --preview
aiqt workspace recover --apply
aiqt workspace recover --apply --json
```

Default without `--apply` behaves as preview.

Recovery examines only canonical pending operations.

### 15.1 Prepare recovery

For each pending prepare:

```yaml
physical_result_exactly_matches:
  action: finalize_workspace_and_binding

physical_result_absent:
  action: clear_pending_operation_as_not_applied

physical_result_conflicts:
  action: blocked_manual_recovery
```

Recovery must not adopt an unrelated path or branch.

Recovery must also verify the exact reserved series key and generation. It cannot allocate a new generation while recovering an existing pending prepare.

### 15.2 Release recovery

For each pending release:

```yaml
workspace_removed_or_shared_binding_already_absent:
  action: finalize_release

workspace_still_present_and_clean_and_exactly_managed:
  action: retry_release_only_with_apply

workspace_dirty_or_drifted:
  action: blocked_manual_recovery
```

Rules:

- preview performs no mutation;
- apply is deterministic;
- repeated recovery is idempotent;
- no branch deletion;
- no force removal;
- no unmanaged cleanup;
- recovery actions and blockers are reported explicitly.

---

## 16. Public CLI Contract

### 16.1 Prepare

```text
aiqt workspace prepare <work-unit-id>
aiqt workspace prepare <work-unit-id> --preview
aiqt workspace prepare <work-unit-id> --json
```

Rules:

- explicit Work Unit ID required;
- no implicit `next` selection;
- no arbitrary provider flag;
- preview runs validation, identity, path, branch, and Git-read checks;
- preview creates no directory, branch, worktree, state, or runlog;
- successful apply creates or links one binding;
- does not start the Work Unit.

### 16.2 Status

```text
aiqt workspace status
aiqt workspace status --work-unit <id>
aiqt workspace status --json
```

Rules:

- read-only;
- inspects all or one managed workspace;
- reports pending recovery;
- no state or runlog mutation;
- no automatic repair.

### 16.3 Release

```text
aiqt workspace release <work-unit-id>
aiqt workspace release <work-unit-id> --preview
aiqt workspace release <work-unit-id> --json
```

Rules:

- release is explicit;
- preview performs all checks without side effects;
- dirty isolated workspace blocks with exit `2`;
- no force flag;
- no branch deletion.

### 16.4 Recovery

As defined in §15.

### 16.5 Exit codes

| Condition | Exit | Canonical mutation | Provider side effect |
|---|---:|---|---|
| Successful preview | 0 | none | none |
| Successful prepare/release/recovery | 0 | expected | expected |
| Idempotent no-op | 0 | none | none |
| Dirty workspace or unavailable Git environment | 2 | none or preserved pending marker | none/unknown safely reported |
| Invalid Work Unit, metadata, path, branch, or canonical conflict | 3 | none | none |
| Recovery requires manual intervention | 2 | pending marker preserved | none |
| Missing required CLI input | 10 | none | none |

---

## 17. Runlog Events

Preferred events:

```text
workspace.prepare_pending
workspace.prepared
workspace.binding_created
workspace.release_pending
workspace.binding_released
workspace.released
workspace.recovery_completed
workspace.recovery_blocked
```

Gate E must verify whether existing event families can represent these semantics.

Runlog payloads are bounded:

```yaml
event:
  workspaceId: required
  workUnitId: optional
  providerId: required
  operationId: optional
  workspaceSeriesKey: optional_bounded_digest
  generation: optional_positive_integer
  lifecycleStatus: optional
  outcome:
    - created
    - linked
    - released
    - recovered
    - blocked
```

Do not include:

- raw Git output;
- command arguments;
- environment;
- repository remote;
- credentials;
- full physical path unless existing local-runlog policy explicitly permits it;
- packet content.

No runlog event for:

- preview;
- status inspection;
- no-op prepare;
- no-op release;
- no-op recovery.

---

## 18. Handoff Packet Integration

When a current Work Unit has an active managed binding, the existing packet adds:

```text
Managed Workspace
```

Minimum content:

```yaml
providerId: required
workspaceMode: required
workspacePath: local_physical_path
branchName: optional
baseCommit: required
inspectionStatus: required
workspacePrepared: true
```

Rules:

- packet identifies the exact local workspace to use;
- packet does not claim the agent was started;
- packet does not execute Git;
- packet does not include provider commands;
- packet does not expose unrelated workspaces;
- isolated Work Unit without an active binding receives:
  - `workspacePrepared: false`;
  - stable instruction to run `aiqt workspace prepare <work-unit-id>`;
- shared Work Unit may resolve to an active shared binding;
- `none` mode states that no repository workspace is required;
- existing packet transition semantics remain unchanged;
- M25 does not block packet creation solely because a workspace is unprepared;
- M26 may later introduce execution preconditions.

---

## 19. Status and Parallel Advisory Integration

`aiqt status --parallel` may add bounded workspace readiness facts:

```yaml
workspaceReadiness:
  prepared: count
  unprepared: count
  recoveryRequired: count
  dirty: count
  drifted: count
```

Rules:

- no automatic preparation;
- no change to M24 eligibility;
- a Work Unit may remain advisory-parallel-eligible while its workspace is unprepared;
- output must distinguish:
  - logically eligible;
  - physically prepared;
- existing `status` without `--parallel` remains unchanged unless current status conventions already include managed-workspace summaries;
- no state/runlog mutation.

---

## 20. Concurrency and Locking

M25 must protect concurrent workspace operations.

Preferred local-operation lock:

```text
.aiqt/workspace-operation.lock
```

Requirements:

- exclusive create;
- contains bounded process metadata only:
  - process ID;
  - created timestamp;
  - operation ID;
- maximum age before considered stale: `30 minutes`;
- stale-lock removal requires:
  - process non-existence when determinable;
  - explicit recovery path;
- lock scope includes generation allocation and workspace provider mutation;
- read-only status and preview do not require the lock;
- lock is always released in `finally`;
- lock must not contain secrets;
- lock does not replace canonical pending operations;
- lock creation failure → exit `2`;
- no OS-global lock or database lock.

Gate E must verify whether an existing repository lock owner can be reused.

---

## 21. State-Growth Limits

```yaml
workspace_limits:
  managed_workspaces_max: 5000
  workspace_bindings_max: 10000
  pending_operations_max: 100
  active_binding_per_work_unit_max: 1
  active_isolated_binding_per_workspace_max: 1
  active_shared_bindings_per_workspace_max: 5000
  physical_path_max_chars: 4096
  branch_name_max_chars: 180
  workspace_generation_max: 9007199254740991
  inspection_warnings_max: 32
  status_workspaces_max: 5000
  serialized_workspace_record_max_bytes: 16384
  serialized_pending_operation_max_bytes: 8192
```

Rules:

- limits are validated before canonical mutation;
- no unbounded Git output;
- status JSON reports truncation explicitly;
- no persisted inspection history;
- no persisted O(n²) compatibility matrix;
- released records remain bounded by project lifetime limits;
- retention or archival is out of scope for M25.

---

## 22. Security Boundary

M25 permits only the bounded local side effects explicitly defined here.

It must add no:

- shell;
- raw command string;
- PowerShell/cmd/sh execution;
- user-provided Git argument arrays;
- remote Git;
- network request;
- provider SDK;
- cloud workspace;
- arbitrary filesystem deletion;
- recursive removal of unmanaged paths;
- branch deletion;
- force removal;
- reset/rebase/merge/cherry-pick;
- Git credential handling;
- secret storage;
- dynamic provider;
- agent invocation;
- validation-command execution;
- scheduler;
- background worker.

Every mutating path must prove:

- target is AIQT-managed;
- path is under trusted root;
- provider identity matches;
- pending operation is canonical;
- preview performs no side effect.

---

## 23. Compatibility Contract

M25 must preserve:

- all M22 evidence and issue contracts;
- M23 evidence import and provenance;
- M24 execution metadata and advisory eligibility;
- historical states without workspace fields;
- current Work Unit statuses;
- current readiness and dependency semantics;
- existing `next` selection;
- checkpoint and review behavior;
- status output without new flags;
- `status --parallel` logical eligibility;
- planning/import/extend/refine;
- runlog parsing;
- schema version `0.5.0`, unless additive compatibility is proven impossible.

Read-only commands must not materialize:

- workspace root;
- shared workspace record;
- isolated workspace record;
- binding;
- pending operation;
- inspection result;
- recovery action.

---

## 24. Repository Implementation Areas

Exact paths must be verified during Gate E.

Expected areas:

```text
src/schema/
  managed-workspace.schema.ts
  workspace-binding.schema.ts
  pending-workspace-operation.schema.ts

src/workspaces/
  workspace-provider.ts
  workspace-provider-registry.ts
  workspace-identity.ts
  workspace-path-policy.ts
  workspace-branch-policy.ts
  git-command-runner.ts
  shared-repository-provider.ts
  git-worktree-provider.ts
  workspace-inspection.ts
  workspace-recovery.ts
  workspace-service.ts
  workspace-operation-lock.ts

src/commands/
  workspace.command.ts

src/handoff/
  existing packet builder/template only

src/status/
  existing parallel-status owner only

tests/unit/
tests/integration/
tests/fixtures/
```

Do not create duplicate:

- Work Unit schema;
- M24 execution metadata;
- readiness evaluator;
- dependency graph;
- packet builder;
- candidate-state writer;
- runlog writer;
- ID allocator;
- CLI output envelope.

---

## 25. Testing Contract

### 25.1 Provider registry

Test:

- exactly two providers;
- fixed mode mapping;
- `none` resolves to no provider;
- unknown provider rejected;
- no dynamic import;
- no environment override;
- no CLI provider override.

### 25.2 Workspace-root policy

Test:

- derived sibling root;
- configured valid root;
- implementation-root nesting rejected;
- filesystem root rejected;
- home directory rejected;
- parent root rejected;
- symlink root rejected;
- symlink ancestor rejected;
- root change blocked with active workspace;
- configuration does not create directory;
- read-only inspection does not persist derived root.

### 25.3 Workspace series, generation, instance identity, and path

Test:

- deterministic shared series key;
- deterministic isolated series key;
- different assignment keys;
- different base commits;
- first generation is `1`;
- active instance reuse does not increment generation;
- pending prepare reuse does not increment generation;
- prepare after released generation allocates `generation + 1`;
- multiple release/reprepare cycles remain monotonic;
- released record remains byte-identical and unreactivated;
- later generation receives a distinct workspace ID;
- later generation receives a distinct path;
- later generation receives a distinct branch;
- concurrent same-series allocation cannot create duplicate generation;
- same series/generation conflict is rejected;
- missing historical generation is not compacted;
- path leaf derived from generated workspace ID;
- assignment key never becomes path;
- tuple ambiguity prevention;
- generation and collection caps.

### 25.4 Branch policy

Test:

- deterministic branch;
- valid `check-ref-format`;
- invalid token sanitization;
- length cap;
- collision;
- same-workspace reuse;
- unrelated existing branch rejected;
- no arbitrary branch CLI input.

### 25.5 Git runner

Test:

- shell false;
- fixed executable;
- fixed argument arrays;
- command allowlist;
- timeout;
- output cap;
- interactive prompts disabled;
- sanitized errors;
- remote and destructive commands impossible;
- user input cannot become an option.

### 25.6 Shared provider

Test:

- create logical shared workspace record;
- multiple bindings;
- no directory creation;
- no mutating Git;
- release one binding;
- release final binding;
- dirty repository warning;
- idempotent prepare/release;
- prepare after final release creates the next generation;
- released shared record remains immutable;
- mode mismatch rejection.

### 25.7 Git worktree prepare

Test:

- clean repository success;
- dirty repository blocked;
- unresolved Git operation blocked;
- target exists unmanaged;
- branch collision;
- invalid root;
- successful worktree verification;
- active binding no-op;
- exact active/pending generation reuse;
- prepare after release creates a new generation/path/branch;
- prior released branch remains present;
- drift conflict;
- no remote command;
- no status transition.

### 25.8 Inspection

Test:

- ready;
- dirty tracked files;
- dirty untracked files;
- ignored files only;
- missing path;
- missing Git registration;
- branch mismatch;
- repository mismatch;
- released;
- recovery required;
- no mutation;
- bounded warnings.

### 25.9 Release

Test:

- shared binding release;
- isolated clean release;
- dirty release blocked;
- missing workspace requires recovery;
- drift requires recovery;
- repeated release no-op;
- branch preserved;
- no force;
- no recursive filesystem delete;
- no Work Unit status change.

### 25.10 Pending operation protocol

Inject failure at every boundary:

- pending-state write fails;
- provider prepare fails before side effect;
- provider prepare succeeds then verification fails;
- provider prepare succeeds then final state write fails;
- final state succeeds then runlog fails;
- pending release write fails;
- provider release fails;
- provider release succeeds then final state fails;
- retry and recovery remain idempotent.

Verify:

- no duplicate workspace;
- no duplicate binding;
- no duplicate branch/worktree;
- no unmanaged cleanup;
- pending marker retained exactly when required.

### 25.11 Recovery

Test every matrix branch from §15.

Verify:

- preview zero mutation;
- apply finalizes exact side effect;
- absent side effect clears pending;
- conflict remains blocked;
- clean release retry;
- dirty release blocked;
- repeated recovery no-op;
- no branch deletion;
- no adoption.

### 25.12 CLI

Test:

- prepare;
- prepare for `planned` Work Unit rejected;
- prepare for `ready` Work Unit allowed;
- prepare for `in_progress` Work Unit allowed;
- new prepare for `needs_review` Work Unit rejected while existing binding remains inspectable;
- prepare for `done`, `replanned`, and `cancelled` rejected;
- prepare preview;
- prepare JSON;
- status all;
- status by Work Unit;
- release;
- release preview;
- recover preview/default;
- recover apply;
- missing Work Unit ID;
- invalid Work Unit;
- invalid metadata;
- exit-code matrix;
- human disclaimer that no agent was started;
- no raw Git output.

### 25.13 Handoff packet

Test:

- prepared isolated workspace;
- prepared shared workspace;
- unprepared isolated workspace instruction;
- `none` mode;
- physical path only for current Work Unit;
- branch/base commit;
- no execution claim;
- existing packet status transition unchanged.

### 25.14 Parallel status

Test:

- logical eligibility unchanged;
- prepared/unprepared distinction;
- dirty/drift/recovery counts;
- no automatic preparation;
- no state/runlog mutation.

### 25.15 Operation lock

Test:

- exclusive acquisition;
- concurrent mutation blocked;
- release in `finally`;
- stale lock with dead process;
- live process not removed;
- malformed lock blocked safely;
- preview/status do not lock;
- canonical pending operation remains authoritative.

### 25.16 Historical compatibility

Re-run:

- M22 matrix;
- M23 matrix;
- M24 matrix;
- pre-M25 state;
- no workspace arrays;
- status and next unchanged;
- packet unchanged when no M24/M25 metadata;
- schema version unchanged;
- read-only commands do not materialize defaults.

### 25.17 Execution-boundary scan

Prove:

- only approved Git subcommands exist;
- no shell;
- no remote Git;
- no arbitrary process;
- no network;
- no provider SDK;
- no recursive unmanaged delete;
- no branch deletion;
- no force;
- no agent execution;
- no validation execution;
- no scheduler.

### 25.18 Clean-environment validation

From disposable repositories and a clean clone:

1. exact package-manager install;
2. frozen lockfile;
3. typecheck;
4. lint;
5. full tests;
6. build;
7. coverage;
8. local and base-comparison version checks;
9. create a disposable Git repository fixture;
10. initialize an AIQT project fixture;
11. create one shared binding;
12. create one isolated worktree;
13. inspect;
14. verify packet output;
15. release clean worktree;
16. verify branch still exists;
17. prepare the same logical isolated assignment at the same base commit again;
18. verify a new generation, workspace ID, path, and branch;
19. verify the released prior record and branch remain unchanged;
20. inject interrupted prepare/release and recover;
21. verify no remote access;
22. run real CI on all supported Node versions.

Check all exit codes explicitly.

---

## 26. Work Units

### WU25-01 — Canonical Workspace State and Configuration

Objective: add optional managed-workspace, binding, pending-operation, and workspace-root contracts.

Acceptance:

- additive historical compatibility;
- no schema-version bump unless explicitly approved;
- deterministic series and instance IDs;
- monotonic generation allocation;
- immutable released records with safe reprepare;
- caps;
- no read-time materialization;
- root validation without directory creation.

Suggested tag:

```text
m25-wu01-workspace-state-configuration
```

### WU25-02 — Static Provider Registry, Path Policy, and Git Runner

Objective: implement the static provider interface, fixed registry, trusted-root policy, branch policy, and bounded Git runner.

Acceptance:

- exactly two providers;
- no dynamic loading;
- shell false;
- allowlisted Git commands only;
- no remote/destructive commands;
- path and symlink defenses.

Suggested tag:

```text
m25-wu02-provider-registry-git-runner
```

### WU25-03 — Shared Repository Provider

Objective: resolve shared logical assignments to the verified implementation root.

Acceptance:

- zero physical creation;
- multiple bindings;
- idempotent prepare/release;
- dirty warning only;
- no Work Unit status changes.

Suggested tag:

```text
m25-wu03-shared-repository-provider
```

### WU25-04 — Git Worktree Prepare Provider

Objective: create and verify isolated AIQT-managed worktrees and deterministic branches.

Acceptance:

- clean committed baseline;
- trusted path;
- exact fixed Git command;
- branch collision handling;
- exact active/pending reuse;
- new generation after release;
- no remote behavior;
- no arbitrary adoption.

Suggested tag:

```text
m25-wu04-git-worktree-prepare
```

### WU25-05 — Release and Recoverable Operation Protocol

Objective: implement pending-operation journaling, clean release, recovery matrices, and idempotent retry.

Acceptance:

- pending before side effect;
- finalization after inspection;
- dirty worktree never removed;
- branch never deleted;
- no unmanaged cleanup;
- interrupted prepare/release recoverable.

Suggested tag:

```text
m25-wu05-workspace-release-recovery
```

### WU25-06 — Workspace CLI

Objective: expose prepare, status, release, and recovery through established CLI conventions.

Acceptance:

- preview and JSON modes;
- correct exit codes;
- no implicit Work Unit selection;
- no arbitrary provider;
- no raw Git output;
- no agent execution.

Suggested tag:

```text
m25-wu06-workspace-cli
```

### WU25-07 — Handoff and Parallel-Status Integration

Objective: add prepared workspace facts to the current packet and physical-readiness summaries to parallel status.

Acceptance:

- current Work Unit only;
- prepared/unprepared distinction;
- no execution claim;
- M24 logical eligibility unchanged;
- read-only status.

Suggested tag:

```text
m25-wu07-handoff-status-integration
```

### WU25-08 — Compatibility, Concurrency, Security, and Failure Hardening

Objective: close operation-lock behavior, historical fixtures, failure injection, path safety, and execution-boundary scans.

Acceptance:

- concurrent mutation blocked;
- every interruption boundary tested;
- M22/M23/M24 regressions green;
- no remote Git/shell/agent/scheduler;
- schema remains additive.

Suggested tag:

```text
m25-wu08-workspace-hardening
```

### WU25-09 — Full Validation and Milestone Closure

Objective: execute clean-environment worktree lifecycle validation, determine versioning, run real CI, verify tags, calculate residual risk, and prepare Gate F.

Acceptance:

- complete local suite;
- disposable repository lifecycle green;
- recovery green;
- clean clone green;
- real CI green;
- all Work Unit tags verified;
- package/release/milestone tags consistent;
- final residual risk `<=15`;
- M26 not started.

Suggested tag:

```text
m25-wu09-final-validation
```

---

## 27. Source-Control and Version Discipline

- Default branch: `main`.
- No `.aiqt/` self-management state.
- Gate E receives no commit or tag.
- Every numbered Work Unit receives:
  - one detailed commit;
  - one annotated tag;
  - validation evidence;
  - `Risk: N/100`;
  - structured report.
- No empty commits.
- No combined Work Units without prior waiver.
- No force-push.
- No history rewriting.
- No moving existing tags.
- No remote Git operations inside product behavior.
- Use repository version governance.
- A minor version increment is likely because M25 adds public commands and managed side effects, but the exact version must be determined by the repository’s actual version policy.
- Final release and milestone tags are created only after real CI passes.

Preferred final milestone tag:

```text
m25-managed-workspace-provider-adapters
```

---

## 28. Risk Register

The Controlled score is the risk after specification-level controls but before Gate E evidence and implementation verification.

| ID | Hazard | Probability | Impact | Inherent | Required design controls | Controlled | Entry target | Residual target |
|---|---|---|---|---:|---|---:|---:|---:|
| M25-R01 | User input reaches shell or arbitrary Git arguments | High | High | 75 | shell false, fixed executable/arrays, command allowlist, no provider flag | 25 | 25 | 10 |
| M25-R02 | Workspace path escapes trusted root through traversal or symlink | High | High | 75 | derived ID path, root boundary, symlink rejection, realpath checks | 30 | 30 | 15 |
| M25-R03 | Release deletes unmanaged or dirty user data | High | High | 75 | Git-managed exact path, clean check, no force, no recursive delete | 30 | 30 | 15 |
| M25-R04 | Branch is deleted or history rewritten | Medium | High | 50 | no branch delete/reset/rebase/merge, static command scan | 17 | 17 | 8 |
| M25-R05 | Provider side effect succeeds but canonical state is not finalized | High | High | 75 | pending operation before side effect, inspection, explicit recovery | 30 | 30 | 15 |
| M25-R06 | Canonical state records workspace that was never created | Medium | High | 50 | side effect verification before finalization, recovery matrix | 25 | 25 | 12 |
| M25-R07 | Repeated prepare creates duplicate branch/worktree/binding | Medium | High | 50 | deterministic identity, exact inspection, idempotent link/no-op | 25 | 25 | 10 |
| M25-R08 | Existing unrelated branch/path is silently adopted | High | High | 75 | exact ownership proof, collision rejection, no adoption flag | 25 | 25 | 12 |
| M25-R09 | Shared and isolated provider semantics are confused | Medium | High | 50 | fixed mode mapping, strict provider contracts, negative tests | 17 | 17 | 8 |
| M25-R10 | Preview or status causes filesystem/Git mutation | Medium | High | 50 | pure planning, read-only runner allowlist, byte-identical tests | 17 | 17 | 8 |
| M25-R11 | Concurrent prepare/release corrupts workspace state | Medium | High | 50 | local mutation lock plus canonical pending operation | 25 | 25 | 12 |
| M25-R12 | Dirty/untracked changes are missed before release | Medium | High | 50 | tracked and untracked checks, ignored-file distinction, fixtures | 25 | 25 | 12 |
| M25-R13 | Physical paths or Git output leak into broad exports/runlog | Medium | Medium | 33 | bounded event schema, no raw output, explicit local-only path display | 17 | 17 | 8 |
| M25-R14 | Historical M24 projects break due workspace fields | Medium | High | 50 | optional additive state, no materialization, compatibility matrix | 25 | 25 | 10 |
| M25-R15 | Missing Git or incompatible repository state produces partial mutation | Medium | High | 50 | Gate E, preflight, pending protocol, no side effect before validation | 25 | 25 | 12 |
| M25-R16 | Runlog append fails after successful workspace finalization | Medium | High | 50 | authoritative state, idempotent retry, documented advisory gap | 25 | 25 | 15 |
| M25-R17 | M25 starts agents or runs validation implicitly | Low | Critical | 33 | explicit boundary, command scan, packet disclaimer | 8 | 8 | 5 |
| M25-R18 | Product fetches/pushes remote Git state | Low | Critical | 33 | remote-command prohibition, runner allowlist, network scan | 8 | 8 | 5 |
| M25-R19 | Workspace root change or drift makes release target unsafe | Medium | High | 50 | root change blocked with active workspaces, canonical exact path checks | 25 | 25 | 12 |
| M25-R20 | Recovery guesses incorrectly and adopts/removes unrelated state | High | High | 75 | exact-match recovery matrix, blocked manual recovery, no force/adoption | 30 | 30 | 15 |
| M25-R21 | Reprepare collides with immutable released workspace identity | Medium | High | 50 | logical series key, locked monotonic generation, generated instance identity, immutable-history tests | 25 | 25 | 12 |

Risk derivation:

```text
controlledDesignRisk =
  max(Controlled score of every M25 hazard)

implementationEntryRisk =
  max(current score of every open M25 hazard after Gate E)

mergeResidualRisk =
  max(final residual score of every open or accepted M25 hazard)
```

```yaml
risk_targets:
  controlledDesignRisk: 30
  implementationEntryRiskMaximum: 30
  mergeResidualRiskMaximum: 15
```

M25 must not begin above `30` and must not merge above `15`.

---

## 29. Out of Scope

M25 must not add:

- coding-agent invocation;
- OpenAI, Anthropic, or other model APIs;
- long-running execution attempts;
- process lifecycle;
- agent heartbeat;
- cancellation;
- retry policy for agents;
- validation-command execution;
- scheduler;
- background queue;
- multi-host coordination;
- cloud workspaces;
- containers;
- SSH;
- remote development environments;
- remote Git fetch/push/pull/clone;
- merge/rebase/cherry-pick/reset;
- branch deletion;
- force worktree removal;
- unmanaged directory cleanup;
- provider plugin installation;
- provider credentials;
- evidence enforcement;
- M26 implementation.

---

## 30. Definition of Done

```yaml
definition_of_done:
  gate_e:
    - baseline verified
    - Git capabilities verified
    - canonical owners verified
    - entry risk <= 30
  provider_registry:
    - exactly shared-repository@1 and git-worktree@1
    - fixed M24 mode mapping
    - no dynamic providers
  state:
    - optional managed workspaces
    - optional bindings
    - optional pending operations
    - logical series plus monotonic generation
    - immutable released records remain reusable only as history
    - historical states valid
    - no read-time materialization
  root_and_path:
    - trusted external workspace root
    - no nesting in implementation root
    - no symlink escape
    - path derived from canonical workspace ID
  git:
    - shell false
    - fixed allowlisted commands
    - no remote Git
    - no destructive history operations
  shared_provider:
    - resolves implementation root
    - no mutating side effect
    - multiple bindings
  isolated_provider:
    - clean committed baseline
    - deterministic branch
    - deterministic generated worktree
    - next generation after release
    - exact verification
    - no arbitrary adoption
  release:
    - clean worktree only
    - no force
    - no branch deletion
    - no unmanaged delete
  recovery:
    - pending operation before side effect
    - interrupted prepare recoverable
    - interrupted release recoverable
    - idempotent retry
  cli:
    - prepare
    - status
    - release
    - recover
    - preview and JSON
  handoff:
    - current Work Unit workspace facts
    - unprepared instruction
    - no agent execution claim
  compatibility:
    - M22 M23 M24 matrices green
    - schema 0.5.0 unless explicitly approved
  security:
    - no shell
    - no remote Git
    - no arbitrary delete
    - no provider network
    - no agent or scheduler
  validation:
    - typecheck
    - lint
    - tests
    - build
    - coverage
    - clean clone
    - disposable Git lifecycle
    - real CI
  governance:
    - every Work Unit committed and tagged
    - version and final tags consistent
    - residual risk <= 15
  boundary:
    - M26 not started
```

---

## 31. Required Agent Output

For every numbered Work Unit:

```yaml
work_unit_result:
  work_unit_id: required
  baseline_verified: required
  objective: required
  summary: required
  files_changed: required
  canonical_owners_reused: required
  side_effects_added_or_changed: required
  path_and_git_safety_evidence: required
  recovery_evidence: required
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

Final M25 report must include:

1. Gate E audit;
2. exact baseline;
3. Work Unit completion table;
4. final provider registry;
5. workspace-root and path policy;
6. workspace series, generation, instance identity, and branch policy;
7. canonical state shapes;
8. Git runner allowlist;
9. shared provider behavior;
10. isolated worktree prepare behavior;
11. inspection matrix;
12. release matrix;
13. pending-operation and recovery protocol;
14. CLI human/JSON evidence;
15. handoff and parallel-status evidence;
16. concurrency-lock evidence;
17. failure-injection and idempotency evidence;
18. historical compatibility matrix;
19. execution-boundary scan;
20. full validation and real-CI results;
21. files, commits, tags, PRs, and package version;
22. hazard-by-hazard residual risk;
23. exact final merge residual risk;
24. Gate F readiness;
25. confirmation that M26 was not started.

---

## 32. Gate F Readiness

M25 may declare Gate F open only when:

- M24 modes map deterministically to static providers;
- shared assignments resolve without physical creation;
- isolated assignments create verified Git worktrees;
- branch and path identity are deterministic per generated instance;
- reprepare after release allocates a new generation without mutating history;
- no unrelated branch/path is adopted;
- dirty worktrees cannot be released;
- release preserves branches;
- interrupted prepare and release are recoverable;
- preview/status are side-effect free;
- handoff packets identify prepared workspace without starting agents;
- no remote Git, provider network, shell, scheduler, or agent execution exists;
- all compatibility fixtures pass;
- real CI is green;
- final merge residual risk is `<=15`.

Gate F output:

```yaml
gate_f_handoff:
  workspace_provider_registry:
    - shared-repository@1
    - git-worktree@1
  physical_workspace_state: implemented
  logical_parallel_eligibility: preserved
  agent_execution: none
  validation_execution: none
  remote_git_surface: none
  provider_network_surface: none
  recovery_protocol: pending_operation_and_reconciliation
  next_milestone:
    id: M26
    title: Long-Running Execution Protocol
```

M25 must not implement M26.

---

## 33. Review Questions

1. Are exactly two static providers implemented?
2. Can project state or CLI input select an arbitrary provider?
3. Is the workspace root outside and not equal to the implementation root?
4. Can symlinks redirect a managed path outside the trusted root?
5. Is the physical path derived from the generated canonical workspace ID rather than the assignment key?
6. Does reprepare after release allocate a new generation instead of reactivating the released record?
7. Are active and pending generations reused idempotently?
8. Are branch names provider-owned, deterministic, bounded, and validated?
9. Can arbitrary user input become a Git option?
10. Is every Git invocation `shell: false` with a fixed allowlist?
11. Can M25 execute fetch, pull, push, clone, reset, merge, rebase, cherry-pick, or branch deletion?
12. Does shared mode avoid filesystem and mutating Git side effects?
13. Does isolated prepare require a clean committed baseline?
14. Can an unrelated existing branch or path be adopted?
15. Is a pending operation persisted before every mutating provider side effect?
16. Can prepare recover when the worktree exists but final canonical state does not?
17. Can release recover when the worktree was removed but final state was not written?
18. Can recovery remove or adopt an unrelated path?
19. Can a dirty or untracked worktree be removed?
20. Is `--force` absent from every release path?
21. Is the workspace branch preserved after release?
22. Are preview and status byte-identical with respect to canonical state and runlog?
23. Are repeated prepare, release, and recovery idempotent?
24. Does the local operation lock prevent concurrent mutation without replacing canonical recovery state?
25. Does the packet identify the prepared workspace without claiming an agent was started?
26. Does M24 logical parallel eligibility remain unchanged?
27. Are physical paths and raw Git output excluded from broad exports and bounded in local output?
28. Does M25 preserve historical M22–M24 projects and schema version `0.5.0`?
29. Is every canonical Work Unit status classified, with `planned` explicitly prohibited from prepare?
30. Is controlled risk `30`, entry risk `<=30`, and residual risk `<=15` evidenced?
31. Is Gate F prepared without starting M26?

Approval threshold:

```yaml
approval:
  overall_score_minimum: 95
  unresolved_critical_findings: 0
  unresolved_high_findings: 0
  implementation_entry_risk_maximum: 30
  merge_residual_risk_maximum: 15
  shell_surfaces: 0
  remote_git_surfaces: 0
  arbitrary_provider_surfaces: 0
  force_removal_paths: 0
  branch_deletion_paths: 0
  unmanaged_directory_deletion_paths: 0
  agent_execution_surfaces: 0
  historical_fixture_regressions: 0
```
