# AIQT Milestone 37 Build Specification

## Autonomous Runner CLI, Agent Adapter, and Controlled Pilot

**Product:** AIQT CLI  
**Milestone:** M37  
**Status:** Ready for implementation review  
**Risk classification:** High-risk  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 5  
**Primary objective:** Expose the bounded autonomous-run foundation created in M36 through a safe public CLI, add one controlled coding-agent adapter, preserve explicit human approval before integration, and validate the complete operator workflow through a limited pilot.

---

## 1. Source Alignment

M37 follows the formal closure of M36.

### M36 closure baseline

- Final commit: `d1ab8ab`
- Milestone tag: `m36-autonomous-maintenance-runner`
- Final CI run: `30928979871`
- CI result:
  - 250/250 files passed
  - 2637/2637 tests passed
  - 0 timeouts
  - 0 assertion failures
- Closure report: `docs/engineering/m36-closure-report.md`

M36 established candidate and safety contracts, fail-closed classification, isolated worktree execution, command policy, budgets, cancellation, validation, self-review, evidence binding, M33-compatible results, and dogfood scenarios.

M36 deliberately did not add a public autonomous-run CLI, a model-backed agent adapter, automatic merge, or AIQT self-management.

M37 adds the operator-facing layer and one bounded agent integration without weakening the M36 safety model.

---

## 2. Product Objective

M37 should allow an operator to run one bounded maintenance task through an explicit public flow such as:

```text
aiqt autonomous inspect
aiqt autonomous classify
aiqt autonomous approve
aiqt autonomous run
aiqt autonomous status
aiqt autonomous cancel
aiqt autonomous result
aiqt autonomous cleanup
```

Exact command names may be refined during WU37-01.

The intended end-to-end model is:

```text
candidate input
→ preflight
→ safety classification
→ human approval when required
→ isolated worktree
→ bounded agent execution
→ validation
→ self-review
→ evidence packet
→ human integration decision
```

Core invariant:

```text
The agent may inspect, propose, and prepare.
The human decides whether to integrate.
```

---

## 3. Entry Gate

M37 implementation may begin only when:

- M36 closure report exists;
- tag `m36-autonomous-maintenance-runner` exists;
- final M36 CI is green;
- M36 dogfood evidence exists;
- repository is clean;
- product `.aiqt/` is absent from the AIQT repository;
- no automatic merge or self-management path exists.

---

## 4. Scope

M37 covers:

- public autonomous-run CLI;
- operator configuration;
- candidate input through explicit local sources;
- one bounded coding-agent adapter;
- agent-process invocation;
- model/tool configuration;
- cancellation and timeout control;
- run status and resumability;
- human approval gates;
- result packet output;
- branch and patch handoff;
- operator documentation;
- controlled pilot on non-AIQT repositories;
- observability and audit evidence.

---

## 5. Out of Scope

M37 must not implement:

- automatic merge;
- automatic PR approval;
- production deployment;
- AIQT self-management;
- unrestricted background scheduling;
- recursive subagent swarms;
- multi-issue batching;
- unrestricted network access;
- arbitrary provider plugins;
- autonomous architecture redesign;
- destructive migrations;
- automatic public issue discovery;
- secret discovery or credential provisioning.

---

## 6. Governing Decisions

### 6.1 Public CLI

The CLI must expose separate phases rather than one opaque command.

Recommended phases:

```text
inspect
classify
approve
run
status
cancel
result
cleanup
```

The public contract must make candidate, safety classification, budgets, permissions, approval, execution state, and result evidence visible.

### 6.2 Agent adapter

M37 implements one bounded adapter first.

The adapter must:

- receive one candidate and one approved plan;
- operate only inside the isolated worktree;
- receive explicit command and network policy;
- receive explicit budgets;
- stream structured events;
- support cancellation;
- return deterministic execution results;
- expose no merge primitive;
- expose no AIQT self-targeting path.

Provider-specific behavior must remain behind an interface.

### 6.3 Approval

Approval is mandatory for:

- medium-risk candidates;
- network permission;
- repository writes beyond the isolated worktree;
- budget increases;
- command-policy expansion;
- retry after validation failure.

Low-risk unattended execution is allowed only if policy explicitly enables it.

### 6.4 Resumability

Safe resume points are limited to:

- awaiting approval;
- workspace prepared;
- cancelled before mutation;
- validation pending;
- review pending.

A partially executing model process must never be resumed blindly.

### 6.5 Handoff

A completed run must produce:

- M33-compatible JSON result;
- human summary;
- evidence packet;
- branch;
- base commit;
- final commit or patch;
- changed files;
- diff summary;
- validation;
- self-review findings;
- residual risk;
- recommended human action.

### 6.6 Human boundary

M37 may prepare:

- local branch;
- commit;
- patch file;
- PR draft text.

M37 must not:

- merge;
- approve;
- deploy;
- push without an explicit operator command.

### 6.7 Security and privacy

The adapter must not receive:

- repository secrets;
- unrelated environment variables;
- unapproved credentials;
- files outside approved context;
- unrestricted shell access;
- unrestricted network access.

Environment projection must be explicit and minimal.

---

## 7. Work Units

## WU37-01 — Public CLI and Operator Configuration Contract

**Risk:** 35/100  
**Objective:** Define and implement the public command surface, configuration contract, approval semantics, and result routing without invoking a coding agent.

### Scope

- define command tree;
- define candidate input;
- define operator configuration;
- define approval flags and interactive behavior;
- define JSON and human output;
- define persisted run IDs;
- define status/cancel/result/cleanup commands;
- wire to M36 services in simulation mode only;
- no model invocation;
- no autonomous code modification.

### Acceptance criteria

- CLI help complete;
- all commands support `--json`;
- M33 result contract preserved;
- classification, budgets, permissions, and approval visible;
- status/cancel/result work for simulated runs;
- no execution adapter wired;
- architecture guards prove no model path exists.

### Tag

```text
m37-wu01-public-cli-contract
```

---

## WU37-02 — Bounded Coding-Agent Adapter

**Risk:** 70/100  
**Objective:** Implement one provider-specific adapter behind a stable internal interface.

### Scope

- adapter interface;
- executable/provider configuration;
- bounded prompt/context;
- minimal environment projection;
- structured event streaming;
- cancellation;
- wall-clock and command budgets;
- safe stdout/stderr capture;
- failure classification;
- no merge or push capability.

### Acceptance criteria

- adapter cannot escape worktree;
- no unapproved secrets;
- command policy authoritative;
- child-process cancellation deterministic;
- timeout and budget exhaustion deterministic;
- provider errors map to M33 contract;
- adapter replaceable;
- no self-management path.

### Tag

```text
m37-wu02-bounded-agent-adapter
```

---

## WU37-03 — End-to-End CLI Orchestration and Resumability

**Risk:** 65/100  
**Objective:** Connect the public CLI to the M36 lifecycle and bounded adapter.

### Scope

- create run;
- classify candidate;
- request/record approval;
- prepare isolated worktree;
- invoke adapter;
- persist lifecycle events;
- expose status;
- safe cancellation;
- approved resume points;
- prevent duplicate concurrent execution.

### Acceptance criteria

- one candidate maps to one run;
- concurrent duplicate execution blocked;
- lifecycle transitions valid;
- cancellation safe;
- resume limited to approved states;
- cleanup deterministic;
- no default-branch mutation;
- no automatic merge.

### Tag

```text
m37-wu03-cli-run-orchestration
```

---

## WU37-04 — Human Approval and Branch/Patch Handoff

**Risk:** 55/100  
**Objective:** Add the operator decision boundary and integration handoff artifacts.

### Scope

- interactive and non-interactive approval;
- approval audit event;
- branch result;
- patch export;
- commit preparation;
- PR draft text;
- discard and cleanup;
- no automatic push;
- no merge.

### Acceptance criteria

- medium-risk execution blocked without approval;
- approval bound to candidate, base commit, budgets, and permissions;
- stale approval rejected;
- result branch/patch reviewable;
- discard safe;
- no merge/deploy path.

### Tag

```text
m37-wu04-human-approval-and-handoff
```

---

## WU37-05 — Controlled Pilot and Milestone Closure

**Risk:** 60/100  
**Objective:** Validate the complete operator workflow on non-AIQT repositories.

### Required scenarios

- successful low-risk repair;
- medium-risk task requiring approval;
- blocked prohibited task;
- cancelled agent run;
- budget-exhausted run;
- validation-failed run;
- stale approval rejection;
- resume from allowed state;
- patch handoff;
- discard and cleanup.

### Acceptance criteria

- full evidence for all scenarios;
- no default-branch mutation;
- no automatic merge;
- no self-management;
- no secret leakage;
- no unapproved network access;
- CI passes;
- operator workflow documented;
- closure report completed.

### Tags

```text
m37-wu05-controlled-autonomous-pilot
m37-autonomous-runner-cli
```

---

## 8. Cross-Work-Unit Invariants

1. AIQT never targets its own repository.
2. No automatic merge.
3. No production deployment.
4. One candidate per run.
5. One isolated worktree per run.
6. Budgets mandatory.
7. Command policy authoritative.
8. Network denied by default.
9. Validation required before success.
10. Human approval remains the integration boundary.
11. M33 result contract preserved.
12. Node 24 CI remains authoritative.
13. One commit and tag per Work Unit.
14. Every commit includes a 0–100 risk score.

---

## 9. Verification Gate

M37 is complete only when:

- public CLI exists;
- all commands support JSON;
- one bounded adapter exists;
- cancellation and timeout are deterministic;
- resumability is safe;
- medium-risk approval enforced;
- branch/patch handoff works;
- no automatic merge path exists;
- controlled pilot passes;
- no self-management path exists;
- CI green;
- all Work Unit commits/tags exist;
- final tree clean.

---

## 10. Closure Report Requirements

Include:

- M36 entry-gate evidence;
- starting/ending commits;
- package/schema versions;
- Work Unit table;
- public CLI contract;
- adapter contract;
- approval model;
- resumability model;
- command/network policy;
- pilot scenarios;
- validation evidence;
- blocked and failed cases;
- residual risks;
- statement that auto-merge remains disabled;
- recommendation on limited operator use.
