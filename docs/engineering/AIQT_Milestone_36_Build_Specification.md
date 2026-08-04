# AIQT Milestone 36 Build Specification

## Autonomous Maintenance Runner and Safety Controls

**Product:** AIQT CLI  
**Milestone:** M36  
**Status:** Planning draft — implementation blocked until M35 closes successfully  
**Risk classification:** High-risk  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 5  
**Primary objective:** Add a bounded autonomous maintenance runner that can inspect a repository, select one safe issue, execute one constrained repair in isolation, validate it, and return reviewable evidence without auto-merging.

---

## 1. Entry Gate

M36 implementation must not begin until all of the following are true:

- M31 canonical-state integrity remains green.
- M32 workflow assessment and recommendation parity remain green.
- M33 CLI machine contract remains green.
- M34 deterministic validation controls remain green.
- M35 test-suite rationalization and CI acceleration closes successfully.
- M35 closure evidence confirms critical regression coverage was preserved.
- Node 24 CI is authoritative and green.
- The repository is clean.
- No product `.aiqt/` self-management state exists in the AIQT repository.

Until these conditions are satisfied, M36 remains planning-only.

---

## 2. Product Objective

M36 introduces a controlled autonomous maintenance capability inspired by small-budget coding-agent patrol workflows.

The runner should be able to:

1. inspect a target repository;
2. identify one bounded candidate issue;
3. assess whether the issue is safe for autonomous handling;
4. create an isolated worktree or equivalent workspace;
5. perform one repair attempt;
6. run authoritative validation;
7. self-review the diff and evidence;
8. produce a reviewable result packet;
9. stop without merging.

The objective is not unrestricted coding autonomy.

The objective is:

```text
one bounded issue
one isolated attempt
one evidence-backed result
no automatic merge
```

---

## 3. Safety Model

The autonomous runner must operate under explicit limits.

### Mandatory defaults

- No direct work on the target repository's default branch.
- No force-push.
- No automatic merge.
- No production deployment.
- No secret discovery or exfiltration.
- No arbitrary shell access beyond an allowlisted command policy.
- No network access unless explicitly enabled for a task.
- One issue per run.
- One worktree per run.
- Fixed wall-clock budget.
- Fixed token/model budget.
- Fixed command-count budget.
- Fixed changed-file budget.
- Fixed diff-size budget.
- Fixed retry budget.
- Validation required before success.
- Human review required before integration.

### Fail-closed principle

If policy, repository state, validation, or evidence is ambiguous, the runner must stop with a blocked or needs-input result.

---

## 4. Scope

M36 should cover:

- autonomous-run configuration;
- issue candidate intake;
- candidate safety classification;
- isolated workspace creation;
- bounded agent execution;
- command allowlisting;
- budget enforcement;
- validation orchestration;
- diff and evidence capture;
- self-review;
- final result packet;
- audit/runlog integration;
- cancellation and timeout handling;
- resume/recovery semantics;
- human approval boundary.

---

## 5. Out of Scope

M36 must not implement:

- automatic merge;
- automatic pull-request approval;
- production deployment;
- secret or credential setup;
- unrestricted internet browsing;
- multi-issue batching;
- recursive subagent swarms;
- arbitrary long-running daemons;
- cross-repository dependency updates;
- autonomous architecture redesign;
- autonomous schema migrations;
- self-modification of the AIQT repository;
- autonomous execution before M35 closes.

---

## 6. Governing Decisions

### 6.1 Execution unit

One autonomous run handles one bounded issue.

A run may end as:

- `passed`;
- `failed`;
- `blocked`;
- `needs_input`;
- `cancelled`;
- `budget_exhausted`;
- `validation_failed`;
- `review_rejected`.

### 6.2 Isolation

Every run must execute in an isolated workspace.

Preferred implementation:

```text
git worktree add -b <run-branch> <isolated-path> <base-ref>
```

The runner must record:

- source repository;
- base ref;
- base commit;
- branch;
- worktree path;
- created files;
- cleanup status.

### 6.3 Candidate safety classification

Before execution, the runner must classify the issue.

At minimum:

- low-risk autonomous candidate;
- medium-risk requires explicit approval;
- high-risk prohibited;
- insufficient context;
- validation unavailable;
- repository dirty;
- unsupported operation.

Prohibited-by-default areas include:

- authentication;
- authorization;
- cryptography;
- secrets;
- billing;
- destructive migrations;
- production infrastructure;
- branch protection;
- dependency-chain upgrades;
- generated lockfile rewrites unless explicitly scoped.

### 6.4 Budgets

Every run requires explicit limits:

- max wall-clock duration;
- max model/token spend;
- max command executions;
- max retries;
- max changed files;
- max inserted/deleted lines;
- max validation duration.

Budget exhaustion must stop the run and preserve evidence.

### 6.5 Command policy

Commands must be validated against an allowlist or policy engine.

The policy must distinguish:

- read-only inspection;
- repository-local writes;
- Git operations;
- test/build commands;
- network commands;
- destructive commands;
- privileged commands.

Disallowed commands must be blocked before execution.

### 6.6 Validation

A run cannot pass unless:

- required targeted tests pass;
- authoritative repository validation passes or the task's approved subset passes;
- no unexpected files change;
- diff limits are respected;
- repository remains structurally valid;
- self-review does not identify unresolved critical findings.

### 6.7 Review packet

Every run must return a compact packet containing:

- issue;
- scope;
- safety classification;
- plan;
- commands executed;
- files changed;
- diff summary;
- validation;
- findings;
- residual risk;
- branch/worktree;
- recommended human action.

### 6.8 Human boundary

The runner may prepare a branch or patch.

It must not merge or deploy.

The final recommendation may be:

- review and merge;
- request changes;
- discard;
- provide missing input;
- rerun with modified budget.

---

## 7. Work Units

## WU36-01 — Autonomous Run Contract and Threat Model

**Risk:** 35/100  
**Objective:** Define the run lifecycle, policy boundaries, threat model, budget model, and result/evidence contract before any autonomous code execution is enabled.

### Scope

- inventory existing execution, workspace, evidence, issue, and review capabilities;
- define the autonomous-run lifecycle;
- define candidate safety classes;
- define prohibited operations;
- define budgets;
- define command-policy categories;
- define run result states;
- define evidence packet;
- define audit/runlog events;
- define cancellation and recovery semantics;
- add schemas/types only if needed for contract characterization;
- no model invocation;
- no autonomous code modification.

### Acceptance criteria

- threat model documented;
- run lifecycle documented;
- safety decision table documented;
- budgets documented;
- command-policy model documented;
- result/evidence contract documented;
- no execution path can modify a repository autonomously yet;
- architecture tests prevent accidental enablement.

### Tag

```text
m36-wu01-autonomous-run-contract
```

---

## WU36-02 — Candidate Intake and Safety Classifier

**Risk:** 50/100  
**Objective:** Accept one candidate issue and deterministically decide whether it may proceed.

### Scope

- candidate intake;
- issue normalization;
- repository preflight;
- dirty-tree detection;
- base-ref verification;
- risk classification;
- prohibited-area rules;
- approval requirements;
- dry-run classification output.

### Acceptance criteria

- unsafe candidates fail closed;
- repository state is validated;
- one issue per run is enforced;
- classification is deterministic;
- human approval is required for medium-risk classes;
- no workspace mutation occurs before approval.

### Tag

```text
m36-wu02-candidate-safety-classifier
```

---

## WU36-03 — Isolated Bounded Execution

**Risk:** 70/100  
**Objective:** Execute one approved repair attempt inside an isolated worktree under strict budgets and command policy.

### Scope

- worktree creation;
- branch naming;
- bounded agent adapter;
- command-policy enforcement;
- wall-clock and command budgets;
- cancellation;
- cleanup;
- no merge.

### Acceptance criteria

- default branch is never modified;
- disallowed commands are blocked;
- budgets are enforced;
- cancellation is safe;
- run evidence is preserved;
- cleanup is deterministic;
- no network access occurs unless explicitly permitted.

### Tag

```text
m36-wu03-isolated-bounded-execution
```

---

## WU36-04 — Validation, Self-Review, and Evidence Packet

**Risk:** 60/100  
**Objective:** Validate the attempted repair, review the diff, and produce a machine- and human-readable result packet.

### Scope

- targeted validation;
- authoritative validation integration;
- diff limits;
- changed-file checks;
- self-review;
- evidence binding;
- final recommendation;
- patch/branch handoff.

### Acceptance criteria

- no pass without validation;
- unexpected changes block the run;
- review findings are surfaced;
- evidence is bound to commit and diff;
- packet follows the M33 machine contract;
- no merge or deployment occurs.

### Tag

```text
m36-wu04-validation-review-evidence
```

---

## WU36-05 — Dogfood Pilot, Recovery, and Closure

**Risk:** 55/100  
**Objective:** Prove the bounded runner on a separate dogfood repository and close operational gaps.

### Scope

- select a non-AIQT dogfood repository;
- run low-risk maintenance scenarios;
- test cancellation;
- test budget exhaustion;
- test validation failure;
- test cleanup and recovery;
- document operator workflow;
- produce closure report.

### Acceptance criteria

- successful low-risk run;
- blocked unsafe run;
- cancelled run;
- budget-exhausted run;
- validation-failed run;
- no automatic merge;
- no default-branch mutation;
- full evidence for every scenario;
- AIQT repository never self-managed by the runner.

### Tags

```text
m36-wu05-autonomous-runner-dogfood
m36-autonomous-maintenance-runner
```

---

## 8. Cross-Work-Unit Invariants

1. AIQT does not self-manage its own repository.
2. No automatic merge or deployment.
3. One issue per run.
4. Isolation is mandatory.
5. Fail closed on ambiguity.
6. Budgets are mandatory.
7. Commands are policy-checked.
8. Validation is mandatory.
9. Evidence is preserved.
10. Human approval remains the integration boundary.
11. One commit and tag per Work Unit.
12. Every commit includes a 0–100 risk score.

---

## 9. Verification Gate

M36 is complete only when:

- M35 closure evidence exists;
- run contract and threat model are documented;
- unsafe candidates fail closed;
- isolated execution is enforced;
- budgets and command policy are enforced;
- validation and self-review are required;
- evidence packets are complete;
- no automatic merge path exists;
- dogfood scenarios pass;
- default branch remains untouched;
- cancellation and recovery are proven;
- all Work Unit commits and tags exist;
- final working tree is clean.

---

## 10. Closure Report Requirements

The closure report must include:

- entry-gate evidence;
- starting and ending commits;
- package and schema versions;
- Work Unit table;
- threat model;
- safety decision table;
- budgets;
- command policy;
- execution isolation;
- validation policy;
- dogfood scenarios;
- failures and blocked cases;
- residual risks;
- statement that auto-merge remains disabled;
- recommendation on whether broader pilot use may begin.
