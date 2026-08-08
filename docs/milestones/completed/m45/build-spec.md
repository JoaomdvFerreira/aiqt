# AIQT Milestone 45 Build Specification v0.1

## Background Maintenance Scheduling

**Product:** AIQT CLI
**Milestone:** M45
**Status:** Review candidate before build handoff
**Risk classification:** Medium
**Protocol:** Lean Milestone Protocol v0.3
**Planned Work Units:** 5
**Primary objective:** Add operator-controlled, persistent scheduling for bounded AIQT maintenance workflows in managed projects, using deterministic due-time selection, existing M42/M43/M36-M39 execution owners, cancellation/evidence, and strict non-escalation of authority. No arbitrary cron executor, no automatic merge/deploy/release, and no AIQT self-management.

---

## 1. Source Alignment and Entry Gate

M45 follows M44 — **Historical Release Reconstruction**.

The roadmap intent for background maintenance is:

```text
operator-controlled schedules
→ bounded maintenance/review workflow
→ existing queue/governance owner
→ evidence-backed result
→ next scheduled occurrence
```

not:

```text
arbitrary command string
→ unattended shell
→ recursive autonomous repair
→ automatic integration/deployment
```

M45 extends the current architecture rather than creating a parallel scheduler/executor. The Technical Architecture v0.4 explicitly reserves background maintenance scheduling as a forward capability and requires future work to extend existing state/evidence/governance owners rather than bypass them.

### 1.1 Required live baseline

Before WU45-01 implementation, verify from live `main`:

- PR #15 / M44 is merged;
- the post-merge `main` Validate run is green;
- Product Specification v0.7 and Technical Architecture Specification v0.4 remain active;
- current governance documents and `repository-owner-map.json` are valid/current;
- M42 defect queue/discovery/remediation owners still exist;
- M43 structural-review owners still exist;
- M36-M39 controlled execution, sandbox, budgets, cancellation, evidence, and execution-guidance owners still exist;
- M44 release-reconstruction behavior remains read-only and is not pulled into scheduled publication;
- package version and `AIQT_SCHEMA_VERSION` are read from live source;
- working tree is clean;
- no `.aiqt/` self-management state exists in the AIQT repository.

Planning baseline from M44 closure is package `0.38.0`, schema `0.6.0`, but live source is authoritative.

If the post-merge M44 Validate run is not green, M45 documentation work may continue but implementation must not begin.

### 1.2 Documentation lifecycle transition

At M45 start:

1. keep M43 and M44 as the two hot completed milestones;
2. archive M42 from `docs/milestones/completed/m42/` to `docs/archive/milestones/m42/` if still present;
3. repair only tracked references made stale by that move;
4. place this specification at:

```text
docs/milestones/active/m45/build-spec.md
```

At closure:

```text
docs/milestones/completed/m45/
├── build-spec.md
└── closure-report.md
```

No permanent WU prompt/log documents.

### 1.3 Branch

After entry verification:

```text
milestone/m45-background-maintenance-scheduling
```

Do not implement directly on `main`.

---

## 2. Product Boundary

M45 is a **product capability for projects managed by AIQT**.

It is not a scheduler for developing the AIQT repository itself.

During M45:

```text
Implement scheduler capability in the AIQT product repository           ✅
Dogfood against disposable/non-AIQT managed projects                    ✅
Persist schedules in managed-project canonical state                    ✅
Use existing bounded AIQT maintenance/execution owners                  ✅

Create .aiqt/ in the AIQT product repository                            ❌
Schedule maintenance against the AIQT product repository                ❌
Install an unrestricted system daemon/service                           ❌
Schedule arbitrary shell/CLI command strings                            ❌
Auto-merge, auto-deploy, or auto-publish Releases                       ❌
```

The capability must be inert until an operator explicitly creates and enables a schedule.

`aiqt init` must not silently create active default schedules.

---

## 3. Architectural Decision: Scheduler Semantics, Not a Cross-Platform Daemon

M45 owns:

- canonical schedule definitions;
- deterministic due-time calculation;
- safe claiming of one due occurrence;
- typed dispatch into existing AIQT maintenance owners;
- occurrence evidence;
- cancellation/status/history;
- bounded recovery after interruption.

M45 does **not** own operating-system service installation or daemonization.

The background-host model is:

```text
OS scheduler / CI timer / operator automation
        ↓
aiqt maintenance run-due
        ↓
AIQT selects at most one due occurrence
        ↓
typed existing maintenance workflow
        ↓
evidence + canonical schedule advancement
```

Examples of possible host mechanisms outside AIQT core:

- cron;
- systemd timer;
- Windows Task Scheduler;
- CI scheduled workflow.

M45 may document the stable command to invoke, but it must not install/configure these host schedulers.

This keeps the core local-first, provider-neutral, testable, and cross-platform.

---

## 4. Problem to Solve

AIQT already has bounded capabilities that are useful periodically:

- structural review;
- concrete defect discovery;
- defect queue triage/remediation;
- controlled execution;
- validation/evidence/cancellation.

Today, an operator must invoke them manually.

M45 must allow an operator to declare:

```text
what bounded maintenance workflow
+ how often
+ conservative policy restrictions
→ persistent schedule
```

and later allow a host invocation to ask:

```text
what is due now?
```

AIQT must then:

1. deterministically choose at most one due schedule occurrence;
2. prove that the schedule is still enabled and valid;
3. execute only its typed, pre-approved workflow kind;
4. reuse existing task-specific risk/approval/sandbox/network/validation owners;
5. record evidence;
6. advance the schedule without replay storms;
7. stop.

A schedule is **timing intent**, not execution authority.

---

## 5. Scope

M45 includes:

- persistent maintenance schedule records;
- canonical schema/version migration for schedule state;
- bounded cadence syntax normalized to deterministic UTC schedule state;
- schedule create/list/inspect/enable/disable/update/remove;
- due-time calculation using an injectable/testable clock;
- deterministic due-schedule selection;
- one occurrence maximum per `run-due` invocation;
- typed maintenance-task registry, not free-form commands;
- initial task kinds:
  - structural review;
  - concrete defect discovery;
  - bounded queued defect remediation;
- optional conservative per-schedule policy that can only restrict existing authority;
- occurrence identity/idempotency;
- missed-occurrence skip accounting;
- no automatic backlog replay;
- delegation to existing M42/M43/M36-M39 owners;
- cancellation and interruption behavior;
- runlog/audit evidence;
- maintenance status/history;
- human/JSON parity;
- disposable/non-AIQT dogfood;
- host-invocation documentation.

### 5.1 Initial task-kind contract

Prefer a discriminated typed contract equivalent to:

```text
structural_review
defect_discovery
defect_remediation
```

Exact identifiers may follow live naming conventions.

#### `structural_review`

- reuses M43 structural-review owner;
- read-only;
- does not automatically convert findings to defects;
- result evidence may record counts/keys/digests, but findings remain subject to M43/M42 intake boundaries.

#### `defect_discovery`

- reuses M42 discovery/dedup/freshness owners;
- may add/update supported concrete defect candidates in canonical state;
- does not authorize remediation.

#### `defect_remediation`

- selects at most one eligible queued defect using M42 deterministic queue/triage ownership;
- reuses existing remediation risk, approval, execution, sandbox, budget, validation, cancellation, and evidence owners;
- may proceed unattended only when existing governance already permits it;
- schedule configuration cannot raise the authority boundary;
- no merge/PR/deploy/release side effect.

No other task kind is added merely for convenience.

---

## 6. Out of Scope

M45 must not implement:

- arbitrary shell-command scheduling;
- user-supplied command strings/argv as schedule payloads;
- unrestricted AIQT-command scheduling;
- background OS daemon/service installation;
- machine startup registration;
- multi-repository scheduling (M46);
- PR creation/merge/integration (M47);
- automatic GitHub Release creation/publication;
- automatic deployment;
- automatic schema/database migration in target applications;
- recursive "fix until green" loops;
- multi-defect remediation in one occurrence;
- parallel scheduled maintenance;
- catch-up replay of every missed historical occurrence;
- generic alerting/notification providers;
- generic remote queue/broker infrastructure;
- cloud scheduler SaaS integration;
- hidden credential discovery;
- new network authority independent from existing task owners;
- automatic schedule creation from findings/defects;
- AIQT self-management.

---

## 7. Canonical Schedule Model

Scheduling is persistent operator intent and must be represented in canonical structured state.

Do not create:

```text
.aiqt/schedules.json
.aiqt/maintenance.json
.aiqt/cron.json
```

or another parallel database.

### 7.1 Expected schema evolution

M45 is expected to require an additive canonical schema change because schedules must survive process restarts.

Planning expectation:

```text
0.6.0 → 0.7.0
```

The live schema version must be read before implementation. WU45-01 owns:

- exact shape;
- additive/defaulting behavior;
- migration/compatibility tests;
- `AIQT_SCHEMA_VERSION` change;
- old-state fixture validation;
- forward/backward safety under current versioning policy.

Package minor bump is also expected for the new public capability, but `pnpm version:check` is authoritative.

### 7.2 MaintenanceSchedule

The final live shape may adapt to existing schema conventions, but semantically requires:

```text
id
taskKind
enabled
scheduleSpec
anchorAt
nextDueAt
createdAt
updatedAt
lastOccurrenceAt?
lastOccurrenceId?
lastResultStatus?
policy
```

`policy` is task-kind-specific and may only make existing execution more conservative.

Example:

```text
maxAutomaticRisk: 35
```

is valid if the existing owner allows automation below 50.

A schedule must never permit:

```text
maxAutomaticRisk: 60
```

to override the global human boundary.

### 7.3 ScheduleSpec

M45 should use a **bounded interval/cadence model**, not full arbitrary cron grammar.

Public UX may accept concise values such as:

```text
1h
6h
1d
7d
```

but canonical state must normalize the cadence into one deterministic representation.

Requirements:

- positive bounded cadence;
- UTC-based `anchorAt` / `nextDueAt`;
- no local-timezone-dependent due calculation;
- no seconds-level high-frequency execution by default;
- no cron expressions with arbitrary complexity;
- deterministic calculation under an injected clock.

WU45-01 must choose exact bounds from live product conventions and test/runtime cost.

### 7.4 No implicit schedules

Existing pre-M45 state migrates/defaults to:

```text
maintenance schedules = []
```

No schedule is created or enabled during migration.

---

## 8. Occurrence Identity and Deterministic Due Selection

A schedule occurrence requires deterministic identity.

Conceptually:

```text
occurrenceId =
digest(scheduleId + scheduleRevision/configDigest + dueAt)
```

Reuse existing canonical JSON/hash owners if an identity digest is needed.

### 8.1 Selection

When multiple schedules are due:

1. enabled schedules only;
2. earliest `nextDueAt`;
3. stable schedule-ID tie-break.

`aiqt maintenance run-due` executes **at most one occurrence** in M45.

This is deliberate boundedness, not a performance limitation to optimize away.

### 8.2 Idempotency

The same occurrence must not execute twice after a cleanly persisted claim/result.

A repeated host invocation against an already-recorded occurrence returns a non-mutating/no-duplicate outcome.

WU45-02 must inspect live state-store/concurrency primitives. If safe duplicate prevention requires new generic locking/transaction authority, stop and report before inventing it.

### 8.3 Overlap

M45 does not support parallel scheduled runs.

If another maintenance occurrence is active for the project:

```text
run-due
→ no second execution
→ explicit busy/blocked result
```

Do not launch parallel maintenance to improve throughput.

---

## 9. Missed Occurrences and Retry Policy

Background hosts may be offline.

M45 must not replay an unbounded backlog.

If a schedule was due multiple times:

1. run at most one occurrence;
2. record the selected due time;
3. after the result, advance `nextDueAt` to the first cadence point strictly after the current evaluation time;
4. report the number of skipped/missed occurrences where practical.

Example:

```text
daily schedule
host offline for 5 days
→ one bounded occurrence
→ four missed occurrences reported/skipped
→ next due is the next future cadence point
```

### 9.1 No automatic immediate retry

A failed/blocked/cancelled occurrence must not enter a tight retry loop.

The occurrence result is recorded and the schedule advances according to its cadence.

Human/operator action may run the underlying AIQT workflow explicitly if immediate intervention is required.

M45 does not add recursive retry-until-success behavior.

---

## 10. Schedule Mutation Semantics

Expected capability family:

```text
aiqt maintenance schedule add ...
aiqt maintenance schedule list
aiqt maintenance schedule inspect <scheduleId>
aiqt maintenance schedule update <scheduleId> ...
aiqt maintenance schedule enable <scheduleId>
aiqt maintenance schedule disable <scheduleId>
aiqt maintenance schedule remove <scheduleId>

aiqt maintenance run-due
aiqt maintenance status
aiqt maintenance history
aiqt maintenance cancel <runId>
```

Exact syntax should be reconciled with the current CLI registration style in WU45-01.

Rules:

- `add/update/enable/disable/remove` mutate only scheduling state and append matching runlog evidence;
- none of those commands executes maintenance as a side effect;
- `remove` must not erase historical runlog evidence;
- removing a schedule with an active occurrence must fail closed or require prior cancellation;
- disabling a schedule prevents future selection but does not silently kill an already-running occurrence;
- read-only list/inspect/status/history commands do not append runlog events.

---

## 11. Typed Dispatch, Not Shell Re-Execution

The scheduler must not implement maintenance by constructing strings such as:

```text
"aiqt defects remediate ..."
```

and spawning them through a shell.

Use typed internal dispatch/adapter ownership:

```text
MaintenanceTaskKind
→ registered typed handler
→ existing M42/M43/M36-M39 service/decision owner
→ CommandResult-compatible outcome
```

Benefits:

- no command-injection surface;
- no duplicate CLI parsing;
- same decision owners;
- easier deterministic tests;
- no hidden widening of shell authority.

If a task cannot be invoked safely without spawning arbitrary command text, that task is out of M45.

---

## 12. Authority and Risk Boundary

A schedule is not an approval.

The effective authority is:

```text
schedule policy
INTERSECT
existing task policy
INTERSECT
current evidence/freshness
INTERSECT
risk/approval state
INTERSECT
sandbox/network/command/resource policy
```

The intersection can only be equal or more restrictive than the underlying workflow.

### 12.1 Risk bands remain unchanged

```text
0–24   Green
25–49  Yellow
50–74  Orange
75–100 Red
```

Existing authority remains:

- `<50`: automation may proceed only when all other gates permit;
- `50–74`: human approval/intervention required;
- `75–100`: human approval plus the stricter waiver/blocking governance.

Per-schedule configuration may set a lower automatic-risk ceiling, but never a higher one.

### 12.2 Human gate behavior

If scheduled remediation reaches a current human gate:

- no side effect beyond safe evidence/state bookkeeping;
- return `needs_input`/existing equivalent;
- preserve the defect/queue state consistently;
- record why human input is required;
- advance schedule cadence without immediate retry.

Do not treat the existence of the schedule as historical human approval.

---

## 13. Cancellation and Interruption

M45 must reuse existing cancellation owners where a scheduled task delegates into controlled execution.

### 13.1 Cancellation

`aiqt maintenance cancel <runId>` must:

- identify the active scheduled occurrence;
- request cancellation through the existing underlying execution/session owner when applicable;
- never kill unrelated processes;
- record cancellation evidence;
- leave canonical schedule/run state recoverable.

### 13.2 Process interruption

A background host can terminate unexpectedly.

On the next invocation AIQT must distinguish:

```text
completed occurrence
active/recoverable underlying run
stale/interrupted occurrence
unknown/corrupt state
```

Do not blindly resume an in-memory process.

Reuse current M36-M39 execution/session recovery semantics.

A stale scheduled occurrence may be reconciled to failed/cancelled/blocked only with evidence; do not mark success without the delegated workflow's success evidence.

---

## 14. Evidence and Runlog

Schedule configuration and background execution are auditable mutations.

Use the existing runlog owner.

At minimum, event families should cover semantically:

```text
maintenance.schedule_created
maintenance.schedule_updated
maintenance.schedule_enabled
maintenance.schedule_disabled
maintenance.schedule_removed

maintenance.run_started
maintenance.run_completed
maintenance.run_failed
maintenance.run_cancelled
```

Exact event names should follow repository conventions and avoid redundant events if a delegated owner already records detailed execution events.

Occurrence evidence should bind, where applicable:

```text
scheduleId
occurrenceId
taskKind
dueAt
startedAt
finishedAt
project/repository identity
base/current commit
delegated run/session/candidate/defect ids
result status
risk/approval decision
validation/evidence refs
missed occurrence count
nextDueAt
```

Do not copy large subordinate evidence packets into runlog if stable IDs/digests suffice.

Secrets must not appear in schedule records or runlog.

---

## 15. Status and History

`aiqt maintenance status` should provide a compact operator view:

- schedules total/enabled/disabled;
- next due schedule/time;
- active occurrence if any;
- last occurrence outcome;
- blocked/needs-input indication.

`aiqt maintenance history` should derive auditable completed history from runlog or the existing history owner rather than requiring an unbounded completed-run array in `state.json`.

Canonical state should preserve only what is required for:

- current schedules;
- next due calculation;
- active/recovery-safe occurrence state;
- compact last-result pointers/metadata.

Avoid unbounded canonical state growth.

---

## 16. Failure and Exit Semantics

Reuse the current CLI machine contract.

Important cases:

### No schedule due

Normal, non-error outcome.

```text
status: passed
exitCode: 0
summary: no maintenance schedule is currently due
```

No state/runlog mutation.

### Invalid schedule input

```text
failed
exit 3
```

No mutation.

### Human approval required

```text
needs_input
exit 10
requiresHumanInput: true
```

Preserve the existing exit-10 invariant.

### Missing local dependency

Use existing exit code `4` where the delegated owner classifies it that way.

### External integration unavailable/failure

Use existing exit code `5` semantics where applicable.

### Underlying validation/review failure

Use the delegated workflow's existing failure semantics.

Do not flatten all scheduled failures into a generic scheduler error.

---

## 17. Version and Schema Expectations

Expected planning delta:

```text
package: 0.38.0 → next minor
schema:  0.6.0 → next additive minor (expected 0.7.0)
```

Live source and repository versioning policy are authoritative.

Because M45 persists new canonical scheduling state, WU45-01 must own deliberate schema evolution and compatibility.

`pnpm version:check` owns package bump governance; it does not own schema evolution.

No GitHub Release is implied by either version change.

---

## 18. Work Units

## WU45-01 — Maintenance Schedule Contract, Canonical State, and Ownership

**Implementation risk target:** 20/100
**Objective:** Define persistent schedule/occurrence contracts, evolve canonical state safely, and establish one decision owner for scheduling semantics.

### Scope

- verify live owners;
- schedule/task-kind/status schemas;
- interval/cadence normalization;
- UTC anchor/next-due model;
- schedule policy restriction contract;
- canonical state integration;
- schema bump/migration/defaulting;
- old-state fixtures;
- runlog event contracts;
- owner-map updates;
- exact CLI family decision.

### Acceptance criteria

- no side schedule file/database;
- old 0.6.x state loads/migrates/defaults safely under current compatibility policy;
- no default enabled schedules;
- schedule policy cannot widen existing authority;
- deterministic normalized cadence;
- schedule identity stable;
- human/JSON contract planned from shared data;
- AIQT repo remains without `.aiqt/`.

### Expected tag

```text
m45-wu01-maintenance-schedule-contract-state
```

---

## WU45-02 — Deterministic Due Engine, Occurrence Identity, and Schedule CLI

**Implementation risk target:** 24/100
**Objective:** Implement operator schedule management and a pure/testable due engine without executing maintenance yet.

### Scope

- add/list/inspect/update/enable/disable/remove;
- due calculation with injected clock;
- occurrence identity;
- deterministic earliest-due selection;
- one-occurrence maximum;
- missed-occurrence skip calculation;
- no-backlog semantics;
- active-run overlap guard contract;
- status/history read models.

### Acceptance criteria

- identical state/time produces identical selection;
- disabled schedules are never selected;
- multiple due schedules select by `nextDueAt`, then stable ID;
- no due work returns success with zero mutation;
- missed intervals do not create N catch-up runs;
- schedule mutation does not execute task;
- removing schedule does not erase history;
- no arbitrary command payload exists.

### Expected tag

```text
m45-wu02-due-engine-schedule-cli
```

---

## WU45-03 — Typed Maintenance Dispatch and Read/Discovery Workflows

**Implementation risk target:** 25/100
**Objective:** Execute one due occurrence through typed internal handlers for safe periodic review/discovery workflows.

### Scope

- typed maintenance-task registry;
- M43 structural-review delegation;
- M42 defect-discovery delegation;
- occurrence lifecycle bookkeeping;
- runlog evidence;
- result/exit/human/JSON parity;
- no shell command construction;
- no Graphify requirement;
- no structural-finding auto-intake.

### Acceptance criteria

- structural review remains read-only;
- structural findings do not become defects automatically;
- defect discovery may update M42 queue only through existing discovery owner;
- discovery does not authorize remediation;
- one host invocation executes at most one occurrence;
- exact occurrence cannot execute twice after persisted completion;
- existing delegated errors retain their classifications;
- no new network authority.

### Expected tag

```text
m45-wu03-typed-dispatch-review-discovery
```

---

## WU45-04 — Scheduled Defect Remediation, Human Gates, Cancellation, and Recovery

**Implementation risk target:** 38/100
**Objective:** Allow explicitly configured scheduled processing of one eligible M42 remediation item while preserving all existing execution authority, safety, validation, and human gates.

### Scope

- deterministic one-defect selection from existing M42 queue;
- explicit `defect_remediation` schedule kind;
- optional lower per-schedule automation ceiling;
- M42 remediation decision owner reuse;
- M36-M39 execution/sandbox/budget/command/network owner reuse;
- M41 validation selection where already used by remediation;
- risk 49/50 and 74/75 boundary proof;
- cancellation delegation;
- interruption/recovery;
- no immediate retry;
- no merge/PR/deploy/release.

### Acceptance criteria

- schedule never counts as approval;
- risk 49 may proceed only if all existing gates pass;
- risk 50 requires human intervention;
- Red governance remains stricter and cannot be bypassed;
- schedule ceiling can lower but not raise global authority;
- at most one defect is remediated per occurrence;
- failed validation cannot close a defect;
- cancellation is scoped to the delegated run;
- interrupted run is never assumed successful;
- no integration side effect exists.

### Stop condition

If scheduled remediation requires materially widening existing Git/filesystem/network/sandbox authority rather than reusing it, stop and reclassify before implementation.

### Expected tag

```text
m45-wu04-scheduled-remediation-cancel-recovery
```

---

## WU45-05 — Background Host Dogfood, Safety Regression, Closure, and Pre-PR Audit

**Implementation risk target:** 20/100
**Objective:** Prove scheduling behavior over restart/time boundaries and close M45 without introducing an uncontrolled daemon or authority escalation.

### Required dogfood

Use disposable/non-AIQT managed projects and deterministic/fake clock control.

Prove at least:

1. pre-M45 canonical state loads with zero schedules;
2. create/list/inspect an enabled structural-review schedule;
3. disabled schedule is never selected;
4. no-due run returns success with zero mutation;
5. one due structural review runs read-only and records evidence;
6. structural review does not auto-intake defects;
7. due defect discovery reuses M42 discovery and does not authorize remediation;
8. multiple due schedules select earliest due deterministically;
9. tie on due time resolves by stable schedule ID;
10. host offline across multiple intervals causes one run, not backlog replay;
11. same completed occurrence cannot execute twice;
12. active occurrence prevents overlapping scheduled execution;
13. schedule update affects future occurrence identity/due calculation only;
14. disable prevents future runs and does not silently kill active work;
15. schedule removal preserves runlog history;
16. low-risk eligible scheduled remediation reuses existing controlled path;
17. schedule policy lower risk ceiling blocks a task the global policy might otherwise permit;
18. risk 49/50 authority boundary is preserved;
19. risk 74/75 stricter governance remains preserved where applicable;
20. scheduled remediation affects at most one defect;
21. failed validation leaves/reopens defect correctly;
22. explicit cancellation records evidence and does not kill unrelated processes;
23. interrupted/stale occurrence is reconciled without fabricated success;
24. missing dependency/external integration preserves existing exit classification;
25. repeated failed/blocked occurrence does not enter immediate retry loop;
26. human and JSON outputs are substantively equivalent;
27. no arbitrary shell command can be stored as a task;
28. no OS daemon/service is installed;
29. no auto merge/PR/deploy/release path exists;
30. no `.aiqt/` self-management appears in the AIQT repository;
31. M36-M44 critical safety/governance regression suites remain green.

### Quality gate

- 100% deterministic seeded due selection;
- zero duplicate completed occurrence execution;
- zero unauthorized remediation;
- zero arbitrary shell scheduling surface;
- zero parallel scheduled runs;
- zero backlog replay storm;
- zero fabricated success after interruption;
- zero automatic merge/deploy/release;
- schema migration/defaulting proven with real old-state fixture;
- no weakening of M42/M43/M36-M39 owners;
- no M46/M47 scope pulled forward.

### Closure

Run focused/impacted validation per current protocol, then authoritative closure validation and pre-PR audit.

When package/schema versions change, run the focused version/schema tests and current repository version checks.

Known environment-specific full-suite failures must be isolated and reconciled honestly; do not rerun until lucky.

Create:

```text
docs/milestones/completed/m45/build-spec.md
docs/milestones/completed/m45/closure-report.md
```

### Expected tags

```text
m45-wu05-background-scheduling-dogfood-closure
m45-background-maintenance-scheduling
```

---

## 19. Cross-Work-Unit Invariants

Every M45 Work Unit must preserve:

1. AIQT does not self-manage its own product repository.
2. No schedule exists unless an operator explicitly creates it.
3. A schedule expresses timing intent, not execution/approval authority.
4. Schedule policy may restrict but never widen underlying authority.
5. No arbitrary shell/command-string scheduler exists.
6. No OS daemon/service installation exists.
7. One `run-due` invocation executes at most one occurrence.
8. Scheduled occurrences do not run in parallel.
9. Missed intervals do not trigger unbounded catch-up.
10. No automatic immediate retry loop.
11. Occurrence identity is deterministic/idempotent.
12. Structural review remains M43-owned and read-only.
13. Structural findings do not auto-become defects.
14. Defect discovery remains M42-owned and does not authorize remediation.
15. Defect remediation remains M42-owned and bounded to one defect.
16. M36-M39 continue owning controlled execution/sandbox/budgets/cancellation/evidence.
17. Existing risk/human/waiver boundaries are unchanged.
18. Validation evidence remains required for remediation resolution.
19. No automatic merge.
20. No automatic PR creation/integration.
21. No production deployment.
22. No automatic GitHub Release draft/publication.
23. No generic new network authority.
24. No secrets in schedule/run evidence.
25. Canonical structured state remains source of truth.
26. Runlog remains append-only historical evidence.
27. Human/JSON outcomes derive from the same command data.
28. M46 multi-repository portfolio governance is not started.
29. M47 controlled PR integration is not started.

---

## 20. Definition of Done

M45 is complete when:

1. Managed projects can persist explicit maintenance schedules in canonical state.
2. Pre-M45 state safely defaults/migrates with no active schedules.
3. Schedule cadence and due selection are deterministic under UTC/injected time.
4. Operators can create, inspect, update, enable, disable, and remove schedules.
5. `run-due` deterministically executes at most one due occurrence.
6. No due schedule produces a clean zero-mutation success.
7. Missed intervals skip backlog rather than replaying every occurrence.
8. Completed occurrence identity prevents duplicate execution.
9. Overlapping scheduled maintenance is blocked.
10. Typed handlers reuse M43 structural review and M42 defect discovery.
11. Structural review remains read-only and does not auto-intake findings.
12. Scheduled defect discovery cannot authorize remediation.
13. Explicit scheduled remediation can process at most one eligible M42 defect.
14. Existing risk/approval/sandbox/network/validation owners remain authoritative.
15. Per-schedule policy can only reduce automation authority.
16. Human gates remain effective at 50+ and stricter Red governance remains intact.
17. Cancellation and interrupted-run recovery are evidence-backed.
18. No automatic retry loop exists.
19. Schedule/run mutations are auditable through runlog.
20. Status/history are available without an unbounded completed-run state array.
21. No arbitrary command scheduler or OS daemon/service is added.
22. No automatic merge/PR/deploy/release path exists.
23. No AIQT self-management occurs.
24. Required dogfood passes deterministically.
25. M36-M44 critical regression/safety coverage remains intact.
26. Documentation/archive/version/tag discipline is complete.
27. Branch is PR-ready.
28. No GitHub Release is created automatically.

---

## 21. Closure Report Minimum Content

The M45 closure report should remain concise and include:

- verified live entry baseline, including M44 post-merge CI;
- package/schema version outcome and migration evidence;
- M42 archive housekeeping result;
- WU commit/tag/risk table;
- canonical schedule/occurrence contract;
- supported task kinds;
- host/background invocation model;
- due-selection/idempotency/missed-occurrence rules;
- authority-intersection proof;
- scheduled remediation and human-gate evidence;
- cancellation/recovery evidence;
- dogfood scenario results;
- defects found/fixed during M45;
- validation and regression evidence;
- known limitations;
- final milestone risk;
- PR readiness;
- explicit confirmation of:
  - no arbitrary shell scheduling;
  - no daemon/service installation;
  - no parallel runs;
  - no auto merge/PR/deploy/release;
  - no AIQT self-management.

---

## 22. Key Milestone Decision

M45 is an **operator-controlled scheduling layer over existing bounded AIQT workflows**.

Prioritize:

```text
explicit schedule
→ deterministic due occurrence
→ typed existing workflow owner
→ existing risk/approval/sandbox policy
→ evidence-backed result
→ deterministic next due
```

Reject:

```text
cron string
→ arbitrary shell
→ unattended broad agent
→ recursive fixes
→ automatic integration/deployment
```
