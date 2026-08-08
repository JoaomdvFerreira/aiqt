# AIQT Milestone 41 Build Specification v0.1

## Adaptive Test Selection and Feedback Acceleration

**Product:** AIQT CLI  
**Milestone:** M41  
**Status:** Planning-ready; implementation blocked until M40 is merged, post-merge `main` validation is green, and the explicit M40 release decision is recorded  
**Risk classification:** Medium-risk  
**Protocol:** Lean Milestone Protocol  
**Planned Work Units:** 5  
**Primary objective:** Extend M39 progressive validation with a deterministic, explainable test-impact selector that identifies the smallest defensible focused/impacted validation set for the current Work Unit, accelerates useful feedback, and escalates conservatively when evidence is weak—without skipping mandatory tests or weakening milestone/release confidence.

---

## 1. Source Alignment and Entry Gate

M41 follows M40 — **Release Governance, Risk Assessment, and Provenance** — and implements the scope explicitly deferred by M39:

```text
M39 → decides validation depth/tier and classifies explicit validation work
M41 → determines the exact focused/impacted tests automatically
```

Implementation must not begin until the live repository proves:

- M40 PR is merged to `main`;
- post-merge `Validate` CI on the integrated M40 `main` commit is green;
- M40 completed documentation exists under `docs/milestones/completed/m40/`;
- M40 milestone tag exists and is not rewritten;
- the explicit post-M40 product release decision is recorded as publish/defer/no-release; M41 must not infer a Release from package version alone;
- package version and canonical schema version are read from live `main` rather than assumed here;
- `main` is clean before branch creation;
- AIQT's own repository contains no `.aiqt/` self-management state.

Prepare this specification at:

```text
docs/milestones/active/m41/build-spec.md
```

Create the implementation branch:

```text
milestone/m41-adaptive-test-selection
```

Do not implement M41 directly on `main`.

---

## 2. Product Objective

M39 established progressive validation tiers and the rule that ordinary Work Units should not default to the full repository suite. M41 makes the focused/impacted part of that plan concrete.

The target flow is:

```text
current Work Unit
+ changed/scoped paths
+ explicit validation requirements
+ bounded repository test evidence
+ relevant prior validation feedback
        ↓
deterministic impact selection
        ↓
ordered focused/impacted targets
+ reason per target
+ confidence / evidence gaps
+ escalation recommendation
        ↓
M39 validation guidance / agent handoff
        ↓
fast feedback now
+ authoritative broad/full validation at milestone/release boundaries
```

M41 optimizes **which tests are selected and in what feedback order**. It does not redefine milestone/release validation policy.

Core invariant:

```text
faster feedback != weaker confidence
```

---

## 3. Scope

M41 covers:

- a bounded test/validation inventory derived from live repository evidence;
- deterministic changed-path / Work-Unit-scope → test-impact selection;
- explicit reason codes for every selected target;
- selection confidence and evidence-gap reporting;
- conservative escalation when impact cannot be bounded safely;
- reuse of M39 validation tiers and full-suite exception policy;
- reuse of existing Work Unit, checkpoint, Git diff, validation-command, and result/evidence owners;
- stable ordering that prioritizes high-signal feedback without suppressing required tests;
- optional use of trustworthy prior validation outcomes/durations only to prioritize or broaden, never to hide tests;
- shared integration into the current bounded Work Unit execution-guidance path;
- a small read-only inspection surface if live CLI architecture supports it cleanly;
- machine/human explainability through the existing result contract;
- controlled fixture/non-AIQT dogfood with measured feedback-efficiency evidence.

---

## 4. Out of Scope

M41 must not implement:

- removal, disablement, quarantine, or permanent skipping of tests for speed;
- weakening of authoritative milestone/release full validation;
- arbitrary mutation of test-runner configuration;
- ML/LLM/embedding/vector-based test selection;
- recursive whole-repository semantic ingestion;
- a universal build-system/dependency-graph engine;
- mandatory runtime coverage instrumentation or a new coverage platform;
- automatic code remediation (M42);
- structural/project issue discovery (M43);
- historical release reconstruction (M44);
- background scheduling (M45);
- multi-repository portfolio selection (M46);
- controlled PR integration (M47);
- automatic model/provider switching;
- replacing authoritative PR/`main` CI with a selector-only partial suite; M41 accelerates Work Unit feedback while PR/main confidence gates remain governed separately;
- generic shell/network execution;
- AIQT self-management of the AIQT repository.

Existing coverage/dependency metadata may be consumed when it already exists and is trustworthy, but M41 must not require a new heavyweight coverage pipeline to function.

---

## 5. Governing Decisions

### 5.1 M39 remains the validation-policy owner

M41 must reuse, not replace, M39 concepts equivalent to:

```text
T0 static
T1 focused
T2 impacted
T3 broad
T4 full
```

M41 primarily resolves exact targets for T1/T2 and may recommend escalation to T3/T4 when evidence or blast radius demands it.

M41 must not make ordinary Work Units default to T4.

### 5.2 Mandatory validation always wins

The selector must preserve explicit validation obligations from the Work Unit/plan/current contract.

At minimum:

- explicit required tests/commands are never removed by the selector;
- directly changed test files are included when runnable;
- unresolved prior relevant failures are retained/escalated rather than hidden;
- security/sandbox/schema/persistence/test-infrastructure and other M39 broad-blast-radius signals can force broader validation;
- milestone/release full validation remains authoritative regardless of WU-level selection.

### 5.3 Selection is deterministic and explainable

Identical canonical inputs must produce identical selection output and ordering.

Every selected test/target must carry one or more stable reason codes, such as equivalents of:

```text
explicit_requirement
changed_test
scoped_file_match
direct_dependency
mapped_dependency
prior_relevant_failure
shared_surface
broad_fallback
```

Names may follow live repository conventions, but the contract must remain machine-readable and human-explainable.

### 5.4 Unknown evidence broadens; it does not silently narrow

When dependency/impact evidence is ambiguous, dynamic, stale, unsupported, or incomplete, M41 must lower confidence and recommend a broader validation tier/command rather than pretending precision.

A selector result must never imply that an unselected test is proven irrelevant unless the evidence contract genuinely supports that conclusion.

### 5.5 Feedback history may prioritize, not suppress

Prior validation evidence may be used to:

- promote previously failing relevant tests;
- order fast/high-signal tests earlier;
- recognize repeated unchanged context and avoid unrelated reruns;
- broaden selection after an unexpected failure.

Prior passes/durations must not be used as an authoritative reason to suppress mandatory or structurally impacted tests.

### 5.6 Test execution remains bounded by existing owners

M41 is a selection/planning milestone, not a new generic test executor.

Where AIQT already has a bounded validation/execution owner, M41 may feed selected targets into that owner. Otherwise it must return an executable validation plan to the existing agent handoff without creating a new arbitrary shell surface.

### 5.7 Implementation risk governance

M41 uses the repository's current four-band risk model consistently:

| Score | Status | Governance |
|---:|---|---|
| `0–24` | 🟢 Green | agent/automation permitted when other gates pass |
| `25–49` | 🟡 Yellow | agent/automation permitted when other gates pass |
| `50–74` | 🟠 Orange | human intervention required |
| `75–100` | 🔴 Red | human intervention + explicit waiver required |

A WU implementation-risk score of `50/100` or higher is therefore a hard stop for human review during AIQT's own M41 development.

---

## 6. Test Inventory and Impact Contract

M41 must define or reuse one shared owner for the logical contract. Equivalent types should cover:

```text
TestInventory
TestTarget
TestTargetKind
TestImpactInput
TestImpactSelection
TestImpactReason
TestImpactConfidence
TestImpactEvidenceGap
TestSelectionSummary
TestEscalationRecommendation
ValidationFeedbackRef
```

The exact names may follow live code conventions.

### 6.1 Required inputs

The selector should consume only bounded/current evidence such as:

- current Work Unit ID and acceptance/validation requirements;
- Work Unit suggested/scoped files when available;
- changed files since the bounded WU/checkpoint baseline;
- direct prerequisite/checkpoint changed files where relevant;
- explicit `validationCommands` / structured validation metadata;
- bounded repository test inventory/configuration;
- repository-maintained path/test mappings when available;
- existing trustworthy dependency metadata when available;
- directly relevant prior validation outcomes/durations from canonical evidence/runlog/checkpoints.

Do not ingest raw conversation history.

### 6.2 Required output

A selection must expose equivalents of:

```text
selectionVersion
inputDigest
selectedTargets[]
priority/order
reasonCodes[] per target
recommendedTier
confidence
fallback/escalation
mandatoryTargets[]
evidenceGaps[]
fullSuiteDeferred boolean + reason when applicable
summary counts
```

The output must be bounded. Detailed candidate/exclusion diagnostics may be exposed only through an explicit explain/debug view if needed; normal success output stays compact.

### 6.3 Inventory constraints

Inventory/discovery must:

- be deterministic for the same repository snapshot;
- obey configured ignore/generated/archive boundaries;
- avoid recursively reading large file contents merely to enumerate tests;
- identify runnable test targets using existing test-runner/repository conventions where possible;
- fail clearly when runner/project structure is unsupported rather than fabricate mappings.

M41 may introduce a narrow configurable mapping contract if live architecture proves it necessary. Any mapping must be optional, deterministic, path-safe, and provider/test-runner neutral at the core contract level.

---

## 7. Selection and Escalation Rules

### 7.1 Selection precedence

The shared owner must preserve a precedence equivalent to:

1. mandatory explicit validation requirements;
2. directly changed/runnable tests;
3. tests with direct bounded dependency/path evidence;
4. configured/known mapped dependents;
5. unresolved prior relevant failures;
6. conservative shared-surface/broad fallback when confidence is insufficient.

Lower-priority evidence must never remove a higher-priority requirement.

### 7.2 Confidence

Use a small deterministic confidence contract, for example:

```text
high
medium
low
```

Confidence must be derived from evidence quality, not caller preference.

Examples:

- high: explicit/direct dependency evidence is complete for the bounded surface;
- medium: mapping/convention evidence is useful but incomplete;
- low: unsupported/dynamic/shared/global surface or missing impact evidence.

### 7.3 Conservative escalation

Equivalent outcomes should support:

```text
selected_focused
selected_impacted
broaden_required
full_required
insufficient_evidence
```

Exact names may follow existing result conventions.

Examples that should broaden or require full validation according to live M39 policy include changes to shared validation infrastructure, canonical schema/persistence, core result/workflow contracts, sandbox/security boundaries, runtime/toolchain/dependency infrastructure, or unknown-cause regressions that focused evidence cannot bound.

M41 must not independently weaken or override M39's T4 exception rules.

### 7.4 Ordering for faster feedback

Within an already-selected mandatory set, M41 may order targets so likely/high-signal feedback arrives earlier.

Safe ordering signals may include:

- directness of impact;
- prior relevant failure;
- explicit acceptance-criterion ownership;
- stable observed duration when already available.

Duration/history may break ties; it must not remove required coverage.

If timing evidence is absent, ordering must remain deterministic through stable structural/lexical rules.

---

## 8. Integration with Execution Guidance

M39's shared execution-guidance owner remains the policy composition point.

M41 should integrate the shared test-impact decision so that bounded Work Unit guidance can expose:

- selected focused/impacted targets;
- why they were selected;
- confidence/evidence gaps;
- whether broader/full validation is deferred or required;
- explicit fallback when automatic impact selection is insufficient.

`next` and `next --preview` must preserve parity where they expose execution guidance.

If prompt-driver or bounded autonomous surfaces consume M39 validation guidance, they should receive M41 selection through the same shared owner only where their current task model contains enough Work Unit/change evidence. Do not force partial/fabricated selection into surfaces that lack the necessary signals.

M37/M38 safety policy remains authoritative.

---

## 9. Public Inspection Surface

Prefer the smallest useful surface.

If live CLI architecture supports a cohesive validation namespace without duplication, expected read-only capability is equivalent to:

```text
aiqt validation select
aiqt validation explain
```

`select` returns the compact recommended validation selection for the current bounded Work Unit/change snapshot.

`explain` may expose richer reasons/evidence gaps without mutating workflow state.

If equivalent capability already exists naturally under another command family, reuse it rather than introducing redundant commands.

Do not add a new generic test-runner command merely to satisfy this section.

Human/JSON output must follow the existing M33 result/stream/exit-code contract.

---

## 10. Feedback Evidence

M41 must reuse existing checkpoint/runlog/evidence owners where possible rather than create a second validation-history database.

The selector may consume bounded prior evidence equivalent to:

```text
target/command
outcome
relevant WU/change identity
duration when already measured
failure category when available
evidence timestamp/source
```

Feedback use must remain explainable.

A prior result that is stale, from a mismatched commit/scope, or otherwise untrusted must not be treated as current verified evidence.

No raw test logs need to become permanent canonical state merely for M41.

---

## 11. Efficiency and Quality Metrics

M41 must measure whether selection actually improves the development feedback loop.

At minimum record, where available:

- candidate test count before selection;
- selected T1/T2 target count;
- repeated/unrelated validation targets avoided;
- selection-planning overhead;
- focused/impacted validation duration;
- time to first failing/high-signal result;
- confidence and escalation outcome;
- seeded/known regression detection outcome;
- full-suite frequency at ordinary WU boundaries;
- final broad/full validation outcome.

Target, not a quality override:

> Demonstrate at least a **30% reduction in repeated or unrelated focused/impacted test execution on at least one representative multi-WU flow**, or an equivalent measured feedback-time reduction, while detecting every intentionally seeded in-scope regression used by the dogfood scenarios.

If the target is not met, report honestly. Do not remove tests, manipulate fixtures, or weaken validation to obtain the metric.

---

## 12. Work Units

## WU41-01 — Test Inventory and Impact Contract

**Implementation risk target:** 30/100  
**Objective:** Establish the single shared test-impact contract and bounded inventory inputs without changing validation execution behavior.

### Scope

- targeted live-owner inventory;
- test target/inventory contract;
- impact input/output/reason/confidence shapes;
- bounded test discovery and canonical input digest;
- mandatory explicit-validation preservation;
- pure contract/inventory tests;
- no broad execution or selection integration yet.

### Acceptance criteria

- one shared contract owner exists;
- inventory is bounded/deterministic;
- explicit required validations can be represented as mandatory targets;
- unsupported/ambiguous inventory fails explicitly;
- raw chat history is not an input;
- no test is removed/skipped;
- M39 validation policy remains unchanged.

### Tag

```text
m41-wu01-test-impact-contract-inventory
```

---

## WU41-02 — Deterministic Impact Selection and Confidence

**Implementation risk target:** 40/100  
**Objective:** Implement deterministic focused/impacted target selection, reason codes, confidence, ordering, and conservative escalation.

### Scope

- selection precedence;
- changed-path / scoped-path evidence;
- direct/configured dependency mappings where available;
- changed-test inclusion;
- prior relevant failure promotion;
- stable ordering;
- confidence/evidence gaps;
- T2/T3/T4 escalation recommendation through M39 policy.

### Acceptance criteria

- identical inputs produce identical selection/order;
- mandatory targets cannot be removed;
- directly changed runnable tests are selected;
- each selected target has a stable reason;
- ambiguous evidence lowers confidence and broadens rather than silently narrows;
- shared/global/test-infrastructure cases escalate conservatively;
- timing/history cannot suppress required tests;
- no arbitrary caller-provided confidence/selection can override the owner.

### Tag

```text
m41-wu02-deterministic-impact-selection
```

---

## WU41-03 — Execution-Guidance Integration and Explainability

**Implementation risk target:** 40/100  
**Objective:** Feed the shared impact decision into M39 execution guidance and expose compact human/JSON inspection without creating a second policy owner.

### Scope

- M39 execution-guidance composition;
- `next` / `next --preview` parity;
- compact selected-target/reason/confidence rendering;
- read-only `validation select/explain` capability if live CLI architecture supports it cleanly;
- prompt/bounded-agent reuse only where sufficient evidence exists;
- M33 result contract.

### Acceptance criteria

- one selection owner is reused everywhere;
- preview/apply guidance parity preserved;
- human/JSON substantively aligned;
- normal success output is compact;
- explain output can show evidence gaps/reasons;
- no selection is fabricated on surfaces lacking required signals;
- no new generic shell/test-runner execution path is introduced.

### Tag

```text
m41-wu03-guidance-selection-explainability
```

---

## WU41-04 — Feedback Adaptation and Safe Escalation

**Implementation risk target:** 45/100  
**Objective:** Reuse trusted prior validation evidence to accelerate ordering and safely broaden subsequent validation when feedback indicates higher blast radius.

### Scope

- bounded checkpoint/runlog feedback references;
- stale/mismatched feedback rejection;
- prior relevant failure promotion;
- duration-based tie-breaking when trustworthy;
- deterministic escalation after unexpected/relevant failures;
- feedback metrics/evidence capture without raw-log persistence;
- no learned suppression of required tests.

### Acceptance criteria

- stale/mismatched feedback cannot influence current selection as verified evidence;
- prior relevant failures are promoted or broaden selection;
- duration/history only prioritizes selected targets;
- unexpected failure can trigger broader recommendation;
- successful historical tests do not become a reason to suppress structurally impacted mandatory tests;
- no new validation-history database is introduced unless live architecture proves it unavoidable and the change is explicitly justified.

### Tag

```text
m41-wu04-validation-feedback-escalation
```

---

## WU41-05 — Dogfood, Performance Proof, Closure, and Pre-PR Audit

**Implementation risk target:** 40/100  
**Objective:** Prove selection quality and feedback acceleration on controlled flows, run authoritative closure validation, normalize documentation, and finish with a single pre-PR closure audit.

### Required dogfood scenarios

Use disposable fixtures and, where practical, representative non-AIQT repositories. Do not use AIQT to self-manage AIQT development.

Prove at least:

1. localized source change selects the directly impacted focused test(s);
2. changed test file selects itself/its runnable target;
3. explicit required validation remains selected even if structural impact evidence would omit it;
4. direct/shared dependency change selects multiple impacted tests;
5. unsupported/dynamic/ambiguous dependency evidence lowers confidence and broadens;
6. test/validation infrastructure change escalates according to M39 broad/full policy;
7. prior relevant failure is promoted in the next bounded selection;
8. stale/mismatched prior feedback is ignored as verified evidence;
9. deterministic inputs produce identical selection digest/order;
10. human/JSON/execution-guidance surfaces agree substantively;
11. at least one multi-WU flow measures baseline vs M41 selected/repeated test count and validation feedback time;
12. intentionally seeded in-scope regressions used by dogfood are detected; no metric is accepted at the cost of a known missed regression.

### Closure validation

Run:

- all focused/impacted M41 validation accumulated through the milestone;
- typecheck;
- lint;
- build;
- version check;
- `git diff --check`;
- directly relevant architecture/safety tests;
- authoritative Node 24 full validation/CI-equivalent gate at closure.

Do not hide or repeatedly rerun flaky/time-out failures merely to obtain a green local result. Reproduce/classify honestly and use clean PR/main CI as authoritative where repository governance permits.

### Pre-PR closure audit

Before reporting `READY FOR PR`, verify in one pass:

- every M41 Definition of Done item against live implementation/evidence;
- exact milestone/WU names and tags;
- package/schema version policy;
- final risk/color using current four-band governance;
- canonical milestone doc paths;
- `active/m41/` removed after closure;
- `completed/m41/build-spec.md` and `closure-report.md` present;
- no stale versioned milestone-spec filename or stale direct reference remains;
- closure report matches live commits/tags/tests/limitations;
- working tree clean;
- no unrelated generated/untracked evidence remains;
- no PR is created until this audit is clean.

Routine post-closure documentation/path corrections should be resolved inside WU41-05 before `READY FOR PR`, not as a chain of separate follow-up prompts.

### Tags

```text
m41-wu05-adaptive-test-selection-dogfood-closure
m41-adaptive-test-selection-feedback
```

---

## 13. Cross-Work-Unit Invariants

Every WU must preserve:

1. AIQT does not self-manage AIQT; no `.aiqt/` product state in this repository.
2. M39 remains validation-tier/policy owner; M41 owns exact T1/T2 impact selection.
3. Explicit/mandatory validations cannot be removed by selection.
4. Unknown impact broadens or escalates; it never silently narrows.
5. Full validation remains mandatory at milestone/release confidence boundaries under repository governance; authoritative PR/`main` CI is not converted into selector-only partial CI by M41.
6. No test is deleted, skipped, disabled, quarantined, or rewritten merely to improve selection metrics.
7. Prior feedback can prioritize/broaden but not suppress structurally required tests.
8. One shared selection owner feeds all supported surfaces.
9. Human/JSON outputs derive from the same decision data.
10. No generic shell/network/test-runner execution surface is introduced.
11. M37/M38 sandbox/approval/resource safety remains intact.
12. Success output is compact; failure/deviation evidence is detailed.
13. Subagents are zero by default and require bounded justification.
14. Focused/impacted validation per WU; full suite is not the default per-WU action.
15. Each numbered WU gets one detailed commit, unique WU tag, focused validation, and `Risk: N/100`.
16. Documentation budget remains `build-spec.md` during active work plus `closure-report.md` at closure unless a genuinely durable reusable contract/policy warrants another file.
17. M42 scope is not pulled forward: selector findings may expose a failing test but M41 does not create/remediate a defect queue.

---

## 14. Validation Strategy

### Per Work Unit

Run only:

- new/changed tests;
- directly impacted regressions;
- cheap type/lint/build/version/diff gates appropriate to touched surfaces.

Do not run the full repository suite after every WU by default.

If a WU-level broad/full run is required by blast radius, record the reason explicitly.

### Milestone closure

WU41-05 runs authoritative broad/full validation. Selection efficiency never overrides closure confidence.

CI runtime reduction is desirable, but M41 must not remove high-value coverage merely to hit a runtime target.

---

## 15. Source-Control and Review Discipline

For AIQT's own implementation:

```text
clean validated main
→ milestone/m41-adaptive-test-selection
→ WU implementation
→ focused/impacted validation
→ detailed WU commit + WU tag
→ continue by default
→ WU41-05 dogfood + full closure validation
→ one pre-PR closure audit
→ docs active→completed
→ milestone tag
→ READY FOR PR
→ PR generated from branch evidence/template
→ human review
→ approved-for-merge
→ merge commit
→ post-merge main CI
→ separate explicit Release decision
```

The implementation run must stop before PR creation unless the user explicitly asks the same agent task to create it.

The agent must never add `approved-for-merge` itself.

Milestone completion and package version changes do not imply a GitHub Release.

---

## 16. Stop Conditions

Stop for human review if M41 requires:

- weakening/removing mandatory tests or closure full validation;
- a generic arbitrary shell/test execution surface;
- a new heavyweight coverage/instrumentation platform;
- ML/LLM/embedding-based selection;
- unsupported dependency evidence being treated as high-confidence exclusion;
- weakening M37/M38 safety controls or M33 result contracts;
- an incompatible canonical schema migration not already justified by the live design;
- a substantial new dependency whose security/maintenance impact cannot be bounded;
- M42 defect-remediation behavior;
- more than one unplanned stabilization WU;
- any WU implementation risk of `50/100` or higher under current governance.

One narrowly scoped stabilization WU may be created only for a bounded integration defect found during integrated review. If more is needed, stop.

---

## 17. Definition of Done

M41 is complete only when:

- one deterministic shared test-impact owner exists;
- bounded test inventory/inputs are defined;
- mandatory explicit validations survive selection;
- exact focused/impacted targets include stable reasons;
- confidence/evidence gaps are explicit;
- ambiguous/unsupported impact broadens or escalates conservatively;
- prior feedback can prioritize/broaden but cannot suppress required tests;
- M39 T0–T4 policy and T4 exception rules remain authoritative;
- supported execution-guidance surfaces consume the same selection decision;
- `next` / preview parity is preserved where guidance is exposed;
- human/JSON outputs are substantively aligned;
- no generic test execution or test-skipping path is introduced;
- dogfood covers the required scenarios and detects every intentionally seeded in-scope regression used for quality proof;
- efficiency metrics are measured honestly, including baseline vs selected/repeated test execution for a multi-WU flow;
- the target 30% improvement is reported as met/not met without gaming;
- authoritative closure validation is green or any non-product infrastructure exception is explicitly reconciled under repository governance;
- WU commits/tags and milestone tag exist;
- `docs/milestones/completed/m41/build-spec.md` and `docs/milestones/completed/m41/closure-report.md` are canonical;
- `docs/milestones/active/m41/` no longer remains after closure;
- the pre-PR closure audit passes without known stale paths/thresholds/provenance;
- final working tree is clean;
- final M41 risk uses the current four-band model;
- M42 does not begin until M41 is merged and formally closed.

---

## 18. Closure Report Requirements

Keep the closure report concise and evidence-oriented. Record:

- verified M40 entry baseline and M41 baseline/final commits;
- package/schema versions;
- WU commit/tag/risk table;
- shared impact owner and selection-version identifier;
- inventory/mapping/dependency evidence actually used;
- mandatory-selection, confidence, escalation, and feedback behavior;
- integration surfaces and parity evidence;
- dogfood scenarios and seeded-regression detection;
- measured baseline vs selected test counts, repeated-validation reduction, and feedback timing where available;
- full validation/CI evidence and any reconciled infrastructure failures;
- defects found/fixed;
- known limitations/residual risk;
- pre-PR audit result;
- final risk/status;
- PR readiness and M42 entry recommendation.

Do not reproduce raw logs or restate the full build specification.

---

## 19. Planned Milestone Tag

```text
m41-adaptive-test-selection-feedback
```

A semantic product Release tag remains a separate governed decision.
