# AIQT Milestone 42 Build Specification v0.1

**Defect Discovery, Triage, and Remediation Queue**

| Field | Value |
|---|---|
| Product | AIQT CLI |
| Milestone | M42 |
| Specification | Build Specification |
| Version | v0.1 |
| Classification | Medium risk / 5 Work Units |
| Active Product Baseline | Product Specification v0.7 |
| Active Architecture Baseline | Technical Architecture Specification v0.4 |
| Required Delta Baseline | M41 closure: Adaptive Test Selection and Feedback Acceleration |
| Primary Pillars | Deterministic Governance & Evidence; Controlled Agent Execution; Efficient Feedback |
| Status | Ready for implementation after entry gates pass |

## 1. Objective

M42 adds a deterministic defect lifecycle to AIQT so concrete defect signals can be discovered from bounded evidence, normalized into explainable defect records, triaged into a resumable remediation queue, and remediated through existing controlled execution paths without turning AIQT into a general-purpose static-analysis platform or an unconstrained auto-fixer.

The intended loop is:

```text
bounded defect evidence
  -> discover
  -> normalize / deduplicate
  -> triage
  -> remediation queue
  -> explicit remediation decision
  -> existing controlled execution
  -> validation evidence
  -> close / reopen / defer
```

M42 must strengthen the existing state/evidence/governance architecture rather than create a parallel issue database.

## 2. Product Boundary

M42 addresses **concrete defect evidence**. It does not perform broad structural project review.

In scope examples:

- failed validation/test evidence;
- checkpoint/review issues that assert an observable defect;
- imported bounded external evidence already supported by AIQT;
- autonomous execution failures/results;
- explicit human-reported defect input with bounded evidence;
- validation regressions discovered during a Work Unit.

Out of scope examples:

- repository-wide architecture/code-smell discovery without a concrete defect signal (M43);
- generic vulnerability scanning platform;
- LLM-based broad repository review;
- arbitrary issue-tracker replacement;
- automatic Pull Request creation/merge (M47);
- background recurring defect scans (M45);
- cross-repository defect portfolios (M46);
- unbounded automatic code modification;
- automatic release publication.

Core invariant:

```text
discovery != permission to remediate
```

A discovered defect may be queued, deferred, invalidated, or require human intervention. Discovery alone must never authorize a side effect.

## 3. Governing Decisions

### 3.1 Canonical state remains the source of truth

A resumable remediation queue is workflow state. If M42 requires new durable queue state, it must extend the schema-governed canonical model rather than add a new `.aiqt/defects.json`, markdown queue, SQLite database, or ad-hoc cache.

If canonical shape changes are required, WU42-01 owns the deliberate schema evolution, migration/defaulting strategy, compatibility tests, and `AIQT_SCHEMA_VERSION` bump. Package and schema versions remain independent.

### 3.2 Evidence over assertion

Every defect record must be traceable to bounded evidence. AIQT must not manufacture a defect merely because an agent states that one exists.

Equivalent evidence should include enough identity to answer:

- what failed or was observed;
- where it came from;
- repository/workflow state it applies to;
- affected Work Unit/files/validation target when known;
- whether the evidence is current or stale;
- whether the defect is reproduced/confirmed, suspected, invalid, or resolved.

### 3.3 Deterministic triage

Severity, confidence, duplicate detection, queue priority, remediation eligibility, and human-approval requirements must be explainable from canonical inputs and stable rules where governance matters.

LLM judgment may help produce human-facing summaries only where existing architecture permits it; it must not become the sole owner of queue ordering or approval authority.

### 3.4 Defect severity is not remediation risk

Keep separate:

```text
defect severity/confidence
remediation implementation risk
release risk
```

A critical defect can have a low-risk remediation. A low-severity defect can require a high-risk architectural change.

M42 remediation uses the repository four-band implementation-risk model:

| Score | Band | Authority |
|---:|---|---|
| 0–24 | 🟢 Green | agent/automation permitted when other gates pass |
| 25–49 | 🟡 Yellow | agent/automation permitted when other gates pass |
| 50–74 | 🟠 Orange | human intervention required |
| 75–100 | 🔴 Red | human intervention + explicit waiver required |

### 3.5 Reuse controlled execution

M42 must not create a second code-execution engine.

When remediation is authorized, reuse the narrowest existing M36–M38/M39 execution, sandbox, approval, budget, command/network, validation, cancellation, cleanup, and evidence owners that fit the bounded task.

If safe execution cannot be enforced, use the established request/import or external-handoff fallback rather than silently weakening isolation.

### 3.6 Validation determines closure

A remediation is not successful because an agent says it is complete.

A defect may transition to resolved/closed only from validation evidence that addresses its acceptance/reproduction contract. Failed or incomplete validation must preserve/reopen the defect with evidence.

M41 may select focused/impacted tests for remediation feedback. It must not replace authoritative PR/main confidence gates.

## 4. Defect Contract

M42 must define or reuse one shared owner for a logical contract equivalent to:

```text
DefectRecord
DefectSource
DefectSeverity
DefectConfidence
DefectStatus
DefectEvidenceRef
DefectFingerprint
DefectTriageDecision
RemediationQueueEntry
RemediationDecision
RemediationEvidence
```

Exact names may follow live repository conventions.

### 4.1 Required defect fields

Equivalent durable fields should cover:

- stable defect ID;
- concise title/summary;
- source kind and evidence references;
- deterministic fingerprint/dedup identity;
- severity;
- confidence/reproducibility state;
- affected Work Unit / milestone when known;
- affected files/areas/validation targets when known;
- status;
- queue priority or deterministic ordering basis;
- remediation eligibility/approval requirement;
- created/updated timestamps;
- resolution/validation evidence references when resolved;
- duplicate/superseded relation where applicable.

Do not store raw chat history in a defect record.

### 4.2 Status model

The implementation should support a bounded lifecycle equivalent to:

```text
candidate
triaged
queued
in_progress
needs_human
deferred
resolved
reopened
invalid
duplicate
```

Exact names may follow existing status conventions. Transitions must be validated and illegal transitions rejected.

### 4.3 Deduplication

Equivalent defect signals must not create an indefinitely growing duplicate queue.

Deduplication must be deterministic and evidence-based. A duplicate finding should link to the canonical existing defect and preserve new evidence rather than discard history.

Do not deduplicate unrelated failures merely because their summaries are textually similar.

## 5. Discovery Sources and Freshness

M42 discovery must consume bounded/current evidence through existing owners where possible.

Supported initial sources should include the narrowest practical subset of:

- current failed validation results;
- checkpoint issues / acceptance-criteria failures;
- review findings;
- autonomous execution failure/results;
- imported external execution/validation evidence;
- explicit human defect input.

Discovery must define freshness rules. Stale evidence must not be treated as a current confirmed defect without an explicit reason.

Unsupported evidence sources must be reported as unsupported rather than silently ignored or fabricated.

M42 must not recursively scan source files to invent potential defects. That belongs to M43 structural review.

## 6. Triage and Queue Ordering

### 6.1 Triage output

Each triage decision should expose equivalents of:

```text
severity
confidence
reproducibility
priority
queueDisposition
remediationRiskEstimate or required assessment state
approvalAuthority
reasonCodes[]
evidenceGaps[]
recommendedNextAction
```

Normal output should stay compact; explicit explain/JSON output may expose the full decision evidence.

### 6.2 Queue ordering

Queue ordering must be deterministic for the same canonical inputs.

Safe signals may include:

- blocking impact;
- defect severity;
- confirmed/reproducible evidence;
- active Work Unit/milestone relevance;
- unresolved regression status;
- explicit human priority;
- age as a lower-priority tie-breaker.

Do not let age or textual urgency override mandatory safety/approval boundaries.

### 6.3 Human authority

Equivalent conditions must force human intervention where required by existing governance, including:

- remediation implementation risk >=50;
- unavailable required sandbox/security capability;
- remediation would broaden scope beyond the bounded defect;
- destructive or externally impactful operation outside existing approved policy;
- ambiguous evidence where the requested side effect cannot be justified safely.

## 7. CLI Capability Family

Prefer one coherent top-level family, for example:

```text
aiqt defects ...
```

Do not create many unrelated top-level commands.

The exact subcommands must follow the live CLI architecture, but M42 should expose the minimum practical surfaces for:

- discovering/assessing defect evidence;
- explaining triage;
- viewing queue/status;
- explicitly queueing/defering/invalidating a defect where appropriate;
- preparing or requesting a bounded remediation;
- observing remediation/result evidence.

Human and `--json` output must derive from the same canonical decision data.

Read-only/preview surfaces must not mutate queue state.

No command may auto-merge a PR, deploy, or publish a Release.

## 8. Remediation Boundary

A queued defect may produce a bounded remediation request containing equivalents of:

```text
defect ID
evidence summary
objective
scope
out of scope
acceptance/reproduction contract
suggested files/areas
validation guidance
execution guidance
risk/approval requirement
```

Where a live controlled-execution path is applicable, remediation may delegate to it. Otherwise AIQT must emit a bounded external-agent handoff/request.

The remediation path must preserve:

- current candidate/workspace identity;
- approval freshness;
- sandbox/worktree requirements;
- command/network/resource policy;
- cancellation and cleanup;
- M39 execution guidance;
- M41 validation selection where applicable;
- detailed failure evidence.

M42 must not implement autonomous recursive “fix until green” loops.

## 9. Work Units

### WU42-01 — Defect Contract, Canonical Queue, and Compatibility

**Objective:** Establish one schema/domain owner for durable defect records and the remediation queue.

Scope:

- inspect existing canonical workflow/evidence owners;
- define defect/queue/status/transition contracts;
- add durable canonical queue state if required;
- own any required `AIQT_SCHEMA_VERSION` evolution and compatibility/defaulting behavior;
- deterministic IDs/fingerprints;
- schema/transition/round-trip tests;
- package version bump only as required by version governance.

Acceptance criteria:

- queue is resumable from canonical state;
- no parallel canonical defect file/database is introduced;
- identical evidence produces stable identity/fingerprint behavior;
- invalid transitions fail closed;
- old supported project state has explicit tested compatibility behavior;
- schema/package versions are treated independently.

### WU42-02 — Bounded Discovery, Deduplication, and Freshness

**Objective:** Convert supported concrete evidence sources into normalized defect candidates without broad repository scanning.

Scope:

- ingest bounded validation/checkpoint/review/autonomous/import/human evidence as supported by live architecture;
- evidence freshness/current-state binding;
- deterministic duplicate collapse/linking;
- unsupported-source and insufficient-evidence behavior;
- compact discovery/explain result contract.

Acceptance criteria:

- supported current failures become traceable candidates;
- duplicate evidence enriches one defect instead of creating queue spam;
- stale evidence is not silently treated as current confirmation;
- unsupported/ambiguous evidence is explicit;
- no M43-style broad structural scan is introduced.

### WU42-03 — Deterministic Triage and Remediation Queue

**Objective:** Turn defect candidates into explainable queue decisions and stable priority ordering.

Scope:

- severity/confidence/reproducibility contract;
- deterministic queue disposition and ordering;
- reason codes/evidence gaps;
- defect severity separated from remediation implementation risk;
- human approval boundaries;
- minimal `aiqt defects` inspect/status/triage/queue surface as justified by live CLI architecture;
- human/JSON parity.

Acceptance criteria:

- identical inputs produce identical ordering/decision outputs;
- risk 49/50 and 74/75 boundaries preserve current governance;
- no side effect is authorized by discovery alone;
- low confidence broadens evidence/requests human input instead of fabricating certainty;
- CLI remains one coherent capability family.

### WU42-04 — Controlled Remediation and Validation Closure

**Objective:** Connect queued defects to existing safe execution/handoff and evidence-based resolution.

Scope:

- bounded remediation request/packet;
- reuse existing execution guidance, autonomous/sandbox/request-import owners;
- approval freshness and remediation risk gate;
- M41 validation selection for focused feedback where applicable;
- defect resolution/reopen/defer transitions from validation evidence;
- failure/cancel/cleanup behavior;
- no merge/deploy/release side effects.

Acceptance criteria:

- low-risk eligible remediation can follow the existing controlled path without a second execution engine;
- risk >=50 stops for human intervention;
- required sandbox unavailability fails closed or uses the documented safer fallback;
- validation failure cannot close the defect;
- successful relevant validation records resolution evidence;
- remediation cannot recursively expand into unrelated fixes.

### WU42-05 — Dogfood, Safety Regression, Closure, and Pre-PR Audit

**Objective:** Prove the complete defect lifecycle, preserve safety boundaries, and close M42 cleanly.

Scope:

- fixture/non-AIQT dogfood across discovery → triage → queue → remediation decision → validation/resolution;
- seeded defect and duplicate scenarios;
- explicit human-gate scenarios;
- M36–M41 safety/regression coverage as directly impacted;
- authoritative milestone validation;
- documentation closure;
- pre-PR audit.

Acceptance criteria:

- all required dogfood scenarios pass;
- zero seeded supported defects are silently lost;
- zero duplicate canonical queue items for equivalent seeded evidence;
- zero remediation side effects occur without an explicit eligible queue/approval decision;
- existing autonomous/sandbox/release safety invariants remain intact;
- authoritative closure gate is reconciled honestly;
- canonical docs and Git state are ready for PR.

## 10. Required Dogfood Scenarios

At minimum prove these 12 scenarios using disposable fixture/non-AIQT repositories or deterministic fixtures:

1. current failed focused test -> defect candidate with evidence;
2. checkpoint/review acceptance failure -> defect candidate;
3. identical defect from two supported sources -> one canonical defect plus linked evidence;
4. stale prior failure -> not treated as current confirmed defect without explicit reason;
5. ambiguous evidence -> lower confidence/evidence gap, no unsafe remediation;
6. confirmed blocking/critical defect -> deterministic higher queue priority;
7. explicit false positive -> invalid disposition preserved with evidence;
8. queue persists/resumes correctly across canonical reload, including any schema compatibility path;
9. low-risk bounded remediation -> existing controlled execution or safe handoff path;
10. remediation risk 50+ -> human intervention required before side effect;
11. remediation validation failure -> defect remains open/reopens with failure evidence;
12. remediation validation success -> defect resolves with bound validation evidence.

Also include one boundary proof that a broad “possible code smell” without concrete supported defect evidence is **not** discovered by M42 and remains M43 scope.

## 11. Quality and Measurement Gate

M42 is primarily a reliability/governance milestone, not an optimization contest.

Required quality measures:

- 100% capture of seeded defects from the supported evidence sources used in dogfood;
- 0 missed seeded regression/defect in those supported scenarios;
- 0 duplicate canonical queue entries for equivalent seeded evidence;
- 0 unauthorized remediation executions;
- deterministic repeat of discovery/triage results for identical inputs;
- no critical/high regression in M36–M41 safety invariants attributable to M42.

Record queue size, duplicate-collapse evidence, human-gate count, remediation outcomes, and validation outcomes. Do not invent precision for unsupported evidence sources.

## 12. Validation Policy

Per WU:

- focused unit tests;
- directly impacted integration tests;
- typecheck/lint/build when affected;
- schema/version compatibility tests when canonical state changes;
- package-version focused test if package version changes;
- `pnpm version:check` and base comparison where required;
- no full suite by default.

At M42 closure:

- run the authoritative full Node 24 validation/CI-equivalent gate required by repository governance;
- reconcile environment/load anomalies with evidence rather than repeatedly rerunning until green;
- preserve PR/main CI as the authoritative merge confidence gate.

## 13. Documentation and Archive Lifecycle

At M42 start, maintain the rolling hot-completed policy:

```text
docs/milestones/completed/
  m40/
  m41/
```

Archive M39, if still present, to:

```text
docs/archive/milestones/m39/
```

Preserve all durable evidence and references. Do not alter `docs/archive/legacy-milestones/` or existing M35–M38 archives except for directly required link repairs.

During M42:

```text
docs/milestones/active/m42/build-spec.md
```

At closure:

```text
docs/milestones/completed/m42/
  build-spec.md
  closure-report.md
```

Remove the empty `active/m42/` directory. Do not create permanent WU prompt/log documents.

M40 and M41 remain hot during M42 closure; M40 is archived when M43 starts.

## 14. Pre-PR Closure Audit

Before reporting `READY FOR PR`, verify in one pass:

- every Definition of Done item;
- supported defect lifecycle/status transitions;
- canonical persistence and schema compatibility;
- package/schema version correctness;
- four-band risk boundaries and approval behavior;
- WU commits/tags and milestone tag;
- dogfood metrics and seeded-defect evidence;
- safety regressions;
- active -> completed documentation move;
- canonical filenames (`build-spec.md`, `closure-report.md`);
- stale references/duplicate milestone docs;
- clean working tree;
- untracked/generated evidence;
- package-version focused test when package version changed;
- `pnpm version:check` and `pnpm version:check -- --base main`;
- no automatic PR/merge/release behavior introduced.

Only then return `READY FOR PR`.

## 15. Definition of Done

M42 is complete when:

1. Supported bounded evidence can deterministically produce traceable defect candidates.
2. Equivalent evidence deduplicates without losing new evidence/history.
3. Defect records and remediation queue are resumable from canonical state.
4. Any required schema evolution is explicit, compatible, versioned, and tested.
5. Triage exposes severity, confidence, disposition, reason codes, evidence gaps, and next action.
6. Defect severity and remediation implementation risk are separate contracts.
7. Queue ordering is deterministic for identical inputs.
8. Discovery does not authorize remediation.
9. Risk <50 may proceed through existing automation when all other gates pass; risk >=50 stops at the defined human boundary.
10. Remediation reuses existing controlled execution/handoff rather than creating a second execution engine.
11. Validation evidence, not agent assertion, controls resolution/reopen behavior.
12. M41 focused/impacted selection may accelerate feedback without weakening PR/main authoritative gates.
13. M42 does not perform M43 broad structural review.
14. Required dogfood scenarios pass with zero missed seeded supported defects, zero duplicate queue items for equivalent evidence, and zero unauthorized remediation executions.
15. M36–M41 safety invariants remain intact.
16. Closure validation is honestly reconciled and PR/main CI remains authoritative.
17. M39 archive housekeeping and M42 documentation lifecycle are complete.
18. WU commits/tags, final milestone tag, and clean branch satisfy repository governance.
19. `docs/milestones/completed/m42/closure-report.md` records final evidence and residual risks concisely.
20. Branch is prepared for PR but not merged; no GitHub Release is created automatically.

## 16. Closure Report Minimum Content

The M42 closure report should remain concise and include:

- baseline/final commits;
- package/schema versions and any schema migration decision;
- WU commits/tags/risks;
- defect contract and persistence outcome;
- discovery/triage/dedup outcome;
- remediation integration outcome;
- dogfood scenario/measurement results;
- human-gate and unauthorized-side-effect proof;
- validation and safety-regression evidence;
- defects found/fixed during M42 itself;
- known limitations;
- final risk/status;
- documentation/archive status;
- PR readiness;
- M43 entry recommendation.

## 17. Entry Gate

M42 implementation may begin only after:

- PR #11 (PR review template governance) is merged;
- post-merge `main` Validate CI is green;
- Product Specification v0.7 and Technical Architecture Specification v0.4 are the active baselines in `docs/product/`;
- M41 is merged, post-merge CI green, and `v0.35.0` is published;
- package version/schema version are read from live `main` rather than assumed from this document;
- working tree is clean;
- no `.aiqt/` self-management state exists in the AIQT repository.

If these assumptions are false, stop and reconcile the baseline before WU42-01.

## 18. Key Milestone Decision

M42 is a **bounded defect lifecycle**, not a generic autonomous repair platform.

Prioritize:

```text
concrete evidence
-> deterministic defect
-> explainable triage
-> resumable queue
-> explicit remediation authority
-> existing safe execution/handoff
-> validation-bound resolution
```

Reject:

```text
broad repo scan
-> speculative issue
-> automatic patch loop
-> hidden side effects
-> self-approved remediation
-> automatic merge/release
```
