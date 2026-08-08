# AIQT Milestone 43 Build Specification v0.1

**Project Structural Review and Issue Discovery**

| Field | Value |
|---|---|
| Product | AIQT CLI |
| Milestone | M43 |
| Specification | Build Specification |
| Version | v0.1 |
| Classification | Medium risk / 5 Work Units |
| Active Product Baseline | Product Specification v0.7 |
| Active Architecture Baseline | Technical Architecture Specification v0.4 |
| Required Delta Baseline | M41 Adaptive Test Selection + M42 Defect Discovery/Triage/Remediation + post-M42 Governance Baseline Reconciliation |
| Primary Pillars | Deterministic Governance & Evidence; Bounded Work & Context; Efficient Feedback |
| Status | Draft for final revalidation after Governance Baseline Reconciliation merges |

## 1. Objective

M43 adds a bounded, deterministic **project structural review** capability to AIQT. It inspects repository-local evidence for architecture, ownership, dependency, contract, validation, test-infrastructure, and safety-boundary problems; consolidates those observations into explainable structural findings; and allows an explicit, governed subset to enter the M42 defect lifecycle.

The intended loop is:

```text
repository-local evidence
  -> bounded structural review domains
  -> deterministic structural findings
  -> consolidate / explain / classify confidence
  -> explicit human/agent intake decision
  -> M42 defect lifecycle when justified
  -> separate remediation authority
```

M43 must not turn broad review output directly into code changes or canonical defects.

Core invariants:

```text
structural finding != canonical defect
structural review != permission to remediate
possible code smell != proven defect
```

## 2. Product Boundary

M42 intentionally stopped at **concrete defect evidence** and explicitly reserved repository-wide structural/code-smell discovery for M43. M43 owns that broader read-only discovery boundary while reusing M42 for any durable defect intake and later remediation.

### In scope

- repository structure and ownership drift;
- duplicated or divergent decision ownership;
- dependency direction, cycles, and inappropriate coupling;
- responsibility concentration / oversized structural hotspots when evidence is measurable;
- orphaned, dead, unreachable, or stale structural paths where deterministically provable;
- CLI/public-contract consistency checks;
- canonical-state/schema ownership drift;
- test architecture and process-heavy reliability hotspots;
- validation-selection/inventory consistency where M41 evidence is available;
- execution/sandbox/Git/filesystem/network safety-boundary duplication or drift;
- documentation-to-implementation ownership drift using current live governance sources;
- deterministic consolidation of equivalent findings;
- explicit conversion of selected findings into the existing M42 defect lifecycle;
- optional read-only structural-evidence providers behind a provider-neutral contract.

### Out of scope

- automatic code modification from structural findings;
- recursive “review and fix until green” loops;
- automatic creation of a canonical `DefectRecord` for every finding;
- a generic static-analysis, SAST, or vulnerability-scanning platform;
- LLM judgment as the sole owner of structural findings, priority, defect intake, or approval authority;
- new generic execution/sandbox engines;
- automatic Pull Request creation/merge (M47);
- background recurring structural scans (M45);
- cross-repository structural portfolios (M46);
- historical Release reconstruction (M44);
- automatic deployment or GitHub Release publication.

## 3. Governing Decisions

### 3.1 Structural review is read-only by default

The structural-review engine must not mutate canonical workflow state, source files, Git history, runlog, or generated exports merely because a review was executed.

A review may return rich structured findings through the normal `CommandResult.data` contract, but read-only review findings are not a second canonical database.

Any durable mutation happens only through an explicit downstream action, primarily M42 defect intake.

### 3.2 Structural findings are transient evidence objects

M43 introduces or reuses a logical contract equivalent to:

```text
StructuralReview
StructuralReviewDomain
StructuralFinding
StructuralFindingEvidence
StructuralFindingConfidence
StructuralFindingFingerprint
StructuralFindingDisposition
StructuralEvidenceProvider
```

Exact names follow live repository conventions.

A `StructuralFinding` is an observation about repository structure. It is not automatically a `DefectRecord`.

Required finding semantics should include equivalents of:

- deterministic finding key/fingerprint;
- review domain and rule ID;
- concise title and explanation;
- repository commit / review target binding;
- affected files/modules/owners when known;
- evidence items and evidence source;
- confidence;
- significance/impact classification appropriate to structural review;
- reason codes;
- evidence gaps;
- whether the finding is eligible for explicit defect intake;
- recommended next action.

Do not store raw chat history or opaque model reasoning.

### 3.3 M42 remains the defect owner

M43 must not create a parallel canonical issue lifecycle.

When a structural finding is explicitly accepted for defect intake:

```text
StructuralFinding
  -> bounded defect evidence adapter
  -> existing M42 discovery/fingerprint/triage owners
  -> existing canonical StateModel.defects queue
```

M42 owns durable defect status, triage, queue ordering, remediation risk/authority, validation-bound closure, and reopen behavior.

M43 may provide structural evidence and an intake recommendation; it must not duplicate those decisions.

### 3.4 Freshness is commit-bound

Structural findings must be bound to the repository state they were derived from, normally by the reviewed commit/base identity and deterministic evidence inputs.

If the repository changes before defect intake, AIQT must either:

- re-evaluate the finding against the current state; or
- explicitly report that the finding is stale and require re-review.

A stale finding must not silently become a current canonical defect.

### 3.5 Deterministic rules before model judgment

Where structural governance matters, findings should be produced by deterministic repository-local rules and evidence.

Examples include:

- duplicate decision-owner implementations;
- invalid owner-map references;
- dependency cycles;
- import-direction violations against known boundaries;
- duplicated constants/contracts that are supposed to have one owner;
- dead tracked paths with no supported references where the rule can prove that condition;
- process-heavy test concentration using measured inventory/runtime evidence;
- stale documentation owner paths;
- mismatches between declared and live runtime/CI/tooling contracts.

A coding model or optional specialist agent may help summarize or investigate a finding only when explicitly invoked and bounded. It must not become the only evidence source for a canonical defect or remediation authority.

### 3.6 Provider-neutral optional evidence

M43 may define a narrow `StructuralEvidenceProvider` abstraction for optional read-only evidence sources.

Repository-local deterministic evidence is sufficient for the milestone to function. No optional provider may become required for core structural review.

Graphify may be evaluated as an optional local, read-only pilot only if the live repository and operator environment make that practical. It must remain outside required runtime behavior unless a separately justified optional-provider integration is explicitly implemented and tested.

Provider evidence must:

- identify its source/provider;
- remain read-only;
- be bounded to the review target;
- never override stronger repository-local evidence silently;
- degrade explicitly to unavailable/unsupported when absent;
- never introduce hidden network or credential requirements.

### 3.7 Risk domains remain separate

Keep separate:

```text
structural finding significance
structural finding confidence
defect severity after M42 intake
remediation implementation risk
release risk
```

A high-impact structural concern can still require more evidence before becoming a defect. A confirmed defect can still have a low-risk remediation. M43 must not collapse these concepts.

## 4. Structural Review Domains

M43 should implement a bounded domain registry rather than one generic “code smell” scanner.

The initial domain set should cover the following where deterministically supportable by the live repository.

### 4.1 Ownership and decision divergence

Detect evidence such as:

- multiple modules independently implementing a decision that governance says has one owner;
- stale or missing owner-map entries;
- owner-map primary/supporting paths that no longer exist;
- new governed domains without an owner;
- compatibility adapters that have become independent decision engines instead of delegating.

The owner map is an index, not source authority. Review must verify live source before claiming drift.

### 4.2 Dependency and coupling structure

Detect deterministically provable concerns such as:

- dependency cycles;
- prohibited or suspicious layer direction;
- broad fan-in/fan-out hotspots;
- domain modules importing provider-specific implementation where the architecture requires a provider-neutral boundary;
- repeated cross-layer shortcuts around established orchestration owners.

Metrics alone are evidence signals, not automatic defects.

### 4.3 Responsibility concentration and module hotspots

Identify measurable hotspots such as very large modules, high exported-surface concentration, repeated unrelated responsibilities, or command modules accumulating domain logic.

Thresholds must be repository-relative and explicit. File length alone must not produce a high-confidence defect.

### 4.4 Orphaned / stale / dead structural paths

Detect only cases that can be supported from bounded repository evidence, for example:

- tracked modules with no reachable/imported/reference path where the repository model can prove that condition;
- obsolete compatibility shims contradicted by the current supported compatibility range;
- stale generated/configuration/reference paths that point to missing owners;
- unreachable command registration or dead command-family wiring where deterministically provable.

Naming age or milestone age alone is never evidence of obsolescence.

### 4.5 Public contract and documentation drift

Compare durable governance/public contracts against live implementation where deterministic ownership exists, including:

- CLI machine contract owner paths;
- command-result/exit semantics;
- Node/runtime and CI declarations;
- versioning/release invariants;
- current owner-map references;
- command-family registration versus documented capability families.

Do not use old archived milestone documents as current authority.

### 4.6 Validation and test-infrastructure architecture

Use M35/M41 owners and live test evidence to identify structural reliability concerns, including:

- process-heavy suite concentration;
- repeated load-related timeout/failure classes;
- duplicated expensive setup;
- test selection/inventory ownership drift;
- critical-test manifest/inventory inconsistencies where currently implemented;
- shared test helpers that create broad hidden coupling.

The recurring Windows process/load-related full-suite failures seen across M39-M42 are an explicit dogfood target: M43 should be able to identify the structural test-infrastructure hotspot class without treating every timeout as a product defect.

Adaptive test selection determines what to run now; it is not evidence that a test is obsolete or removable.

### 4.7 Execution and safety-boundary drift

Review architectural safety invariants without attempting exploitation or broad security scanning, including:

- bypasses around established sandbox/command/network/budget owners;
- duplicate execution-authority paths;
- live-execution entry points that do not reuse required approval/freshness gates;
- filesystem/Git mutation helpers outside established owners where that is deterministically discoverable;
- provider-specific behavior leaking into provider-neutral contracts.

This domain reports architecture drift; it does not perform remediation.

## 5. Evidence Collection

### 5.1 Repository-local evidence

Use the smallest bounded evidence set needed for each domain. Potential evidence owners include:

- tracked file tree and Git metadata;
- TypeScript imports/exports and module graph evidence;
- package scripts/configuration;
- command registration;
- repository owner map;
- canonical schema/result/exit-code owners;
- test inventory and measured runtime metadata where available;
- validation-selection metadata from M41 where available;
- current governance paths;
- existing architecture boundary tests/guards.

M43 must not begin with an unbounded “read the whole repository and reason about it” agent prompt.

### 5.2 Evidence quality

Each finding must distinguish:

```text
proven structural condition
strong deterministic signal
weak/ambiguous signal
unsupported / unavailable evidence
```

Low-confidence evidence should result in a conservative finding, evidence-gap recommendation, or no finding—not fabricated certainty.

### 5.3 No hidden provider dependence

Core review must work offline from repository-local state. Optional provider failure/unavailability must not make the core review fail when local review remains valid.

## 6. Finding Consolidation and False-Positive Control

### 6.1 Deterministic consolidation

Equivalent findings from multiple rules/providers should collapse to one structural finding when their structural identity is demonstrably equivalent.

New evidence may enrich a finding but must preserve provenance.

Do not collapse findings only because human-readable titles look similar.

### 6.2 False-positive controls

M43 must explicitly test benign patterns that must not be promoted to actionable findings, including examples such as:

- intentional compatibility adapters delegating to the canonical owner;
- large fixture/data files with narrow responsibility;
- optional provider adapters that are isolated by design;
- old historical tests retained specifically for compatibility;
- capability-dependent Docker test skips that follow current test policy;
- archived milestone documents referencing historical paths.

### 6.3 Explainability

Every actionable finding should expose:

- rule/domain;
- evidence;
- confidence;
- why it matters;
- why it was or was not considered defect-intake eligible;
- what additional evidence would change the decision.

## 7. CLI Surface

Prefer reuse of existing coherent command families rather than a new unrelated top-level command.

The implementation should first evaluate whether the current `review` family can own structural review cleanly. A likely surface is equivalent to:

```text
aiqt review structural
aiqt review structural --json
aiqt review structural --domain <domain>
aiqt review structural explain <finding-key>
```

Exact syntax must follow the live CLI architecture and must not break existing `aiqt review --mode development|release` semantics.

Defect intake should reuse the existing `defects` family, for example through an equivalent explicit operation such as:

```text
aiqt defects ... <structural-finding-key>
```

The exact subcommand is an implementation decision after inspecting the M42 family; do not create a second issue lifecycle merely to match this example.

Read-only review/explain operations:

- must not mutate canonical state;
- must not append runlog events;
- must preserve human/`--json` substantive parity;
- must report unsupported domains/providers explicitly.

Explicit defect intake is a mutation and must use M42 mutation/runlog semantics.

## 8. Defect Intake Boundary

A structural finding becomes eligible for M42 intake only when the structural evidence is strong enough to state a bounded defect claim or reproducible governance/integrity violation.

Required intake properties should include equivalents of:

```text
findingKey
reviewCommit
reviewDomain
ruleId
evidenceRefs / evidence summary
affected areas
bounded defect statement
reproduction / validation contract when applicable
confidence
```

On intake:

1. verify finding freshness against the current repository state;
2. re-evaluate or reject stale findings;
3. adapt the finding into the existing M42 supported evidence contract;
4. reuse M42 fingerprint/dedup logic;
5. reuse M42 triage and queue decisions;
6. do not authorize remediation automatically.

A structural finding that is architectural debt, optimization advice, or an ambiguous smell may remain a non-canonical review finding and never enter the defect queue.

## 9. Optional Specialist/Provider Review

M43 does **not** require routine subagents.

If a specialist review mechanism is implemented, it must be explicitly bounded to one review domain and treated as an optional evidence source. Its output must pass through the same finding evidence/confidence/consolidation rules as any other provider.

No specialist agent may:

- mutate repository state;
- create canonical defects directly;
- authorize remediation;
- bypass M42 risk/approval governance;
- broaden the review scope beyond the explicitly selected domain.

Graphify, if piloted, follows this same provider boundary.

## 10. Work Units

### WU43-01 — Structural Review Contract, Domains, and Ownership

**Objective:** Establish the read-only structural-review contract and one shared owner for domains, findings, confidence, fingerprints, and provider boundaries.

Scope:

- inspect the live post-reconciliation owner map and M42 defect owners;
- define structural review/finding/domain/provider contracts;
- define finding key/fingerprint and commit-freshness semantics;
- define initial domain registry and reason codes;
- define structural-finding versus `DefectRecord` boundary;
- define read-only mutation/runlog invariant;
- add contract/determinism/round-trip tests;
- avoid canonical schema evolution unless implementation proves a durable state change is genuinely required.

Acceptance criteria:

- structural findings are not canonical defects;
- review execution is read-only;
- finding identity is deterministic for the same commit/evidence;
- provider absence is explicit and non-fatal to local review;
- M42 remains the sole durable defect/remediation owner;
- no new `.aiqt` canonical file is introduced.

### WU43-02 — Bounded Repository Evidence Collection and Structural Analysis

**Objective:** Implement repository-local evidence collection and deterministic review rules for the initial domain set.

Scope:

- bounded tracked-file/module/import evidence;
- owner-map/live-path validation;
- dependency/cycle/coupling signals;
- decision-owner divergence checks;
- public-contract/documentation drift checks;
- validation/test-infrastructure hotspot evidence;
- execution/safety-boundary drift checks where deterministically supportable;
- explicit unsupported evidence behavior;
- no model-required broad repository reasoning.

Acceptance criteria:

- each supported rule produces evidence-backed findings only;
- identical repository state produces identical raw findings;
- weak metrics alone do not become high-confidence defects;
- archived/historical content does not create false live-governance drift;
- review remains read-only and offline-capable.

### WU43-03 — Finding Consolidation, Explainability, and Review CLI

**Objective:** Turn raw domain signals into stable, explainable structural review output through the existing CLI/result architecture.

Scope:

- deterministic finding consolidation/fingerprints;
- confidence and evidence-gap classification;
- false-positive suppression rules;
- review summary and explain output;
- selective domain review;
- integrate with the most appropriate existing `review` CLI family;
- human/JSON parity;
- compact success output with detailed finding evidence on request/failure.

Acceptance criteria:

- equivalent findings consolidate without provenance loss;
- unrelated findings are not textually over-deduplicated;
- explain output identifies rule, evidence, confidence, and intake eligibility;
- read-only commands do not mutate state/runlog;
- existing development/release review semantics remain unchanged.

### WU43-04 — M42 Defect Intake and Optional Structural-Evidence Provider

**Objective:** Add an explicit, freshness-bound path from selected structural findings into the existing M42 defect lifecycle, and prove optional-provider isolation.

Scope:

- explicit structural-finding intake through the current `defects` family;
- current-commit freshness/revalidation gate;
- structural-finding-to-M42 evidence adapter;
- reuse M42 dedup/fingerprint/triage/queue owners;
- no remediation authorization from review/intake alone;
- define and test optional provider contract;
- evaluate a Graphify read-only pilot only if practical without making it required;
- if Graphify is unavailable or unsuitable, provide deterministic provider-unavailable evidence and close the WU without fabricating integration.

Acceptance criteria:

- only explicitly selected eligible findings can enter durable defect state;
- stale findings cannot silently enter the queue;
- M42 duplicate handling is reused rather than reimplemented;
- defect severity/priority are decided by M42 after intake;
- provider failure/unavailability does not break local structural review;
- no new network/credential requirement is introduced for core M43 behavior;
- no code remediation is launched by structural review or intake.

### WU43-05 — Dogfood, False-Positive Control, Safety Regression, and Closure

**Objective:** Prove M43 finds seeded structural issues without converting benign patterns into defects or bypassing M42 governance.

Required dogfood scenarios:

1. duplicated/divergent decision-owner implementation is detected;
2. stale/missing owner-map path is detected;
3. deterministic dependency cycle or direction violation is detected;
4. measurable responsibility/coupling hotspot is reported conservatively;
5. stale/dead structural path is detected where evidence can prove it;
6. documentation/public-contract drift is detected;
7. process-heavy/test-infrastructure reliability hotspot is detected, including the known Windows load/timeout class without misclassifying it as a product defect;
8. intentional compatibility adapter is not falsely reported as divergent ownership;
9. legitimate capability-dependent Docker skip is not treated as test debt merely for being skipped;
10. equivalent findings from two evidence paths collapse deterministically;
11. ambiguous/weak structural evidence remains low-confidence or non-actionable;
12. repeated review of identical repository state produces identical finding identities/order;
13. structural review creates zero canonical defects automatically;
14. explicit eligible finding intake creates or deduplicates through M42 correctly;
15. stale finding intake is rejected or requires re-review;
16. intake does not authorize remediation and preserves the risk-50 human boundary;
17. optional provider unavailable does not break local review;
18. no M36–M42 critical/high safety regression.

Closure scope:

- full authoritative validation;
- focused structural-review/defect-integration suites;
- package/schema version checks;
- owner-map update if M43 establishes new durable owners;
- documentation lifecycle/archive housekeeping;
- one pre-PR closure audit;
- final milestone risk assessment;
- no GitHub Release unless separately requested after merge/main validation.

## 11. Quality Gates

M43 closes only when all applicable gates hold:

- 100% capture of supported seeded deterministic structural findings;
- zero missed supported seeded high-confidence findings in dogfood;
- zero duplicate consolidated records for equivalent finding identity;
- zero automatic `DefectRecord` creation from review alone;
- zero unauthorized remediation execution;
- zero false positives across the required benign-control scenarios;
- deterministic finding identity/order on repeated same-commit review;
- stale-review intake fails closed or revalidates explicitly;
- local review succeeds without optional provider availability;
- no M36–M42 critical/high safety regression;
- authoritative PR/main CI remains the clean-environment confidence gate.

The goal is **precision and evidence quality**, not maximizing finding count.

## 12. Validation Strategy

Follow the current Lean Milestone Protocol and M41 adaptive-selection owners.

Per Work Unit:

- focused tests for the changed domain;
- impacted tests selected by current validation owners where appropriate;
- typecheck/lint/build as required by current governance;
- no routine full-suite rerun after every WU.

At closure:

- full authoritative validation;
- package-version checks;
- structural-review dogfood suite;
- M42 defect lifecycle regression suite;
- relevant M36–M41 execution/safety/validation regression suites;
- classify local process/load-related failures instead of rerunning until lucky;
- PR/main Node 24 CI is the clean-environment authority.

Adaptive selection may reduce iteration cost; it may not weaken the closure or PR/main confidence boundary.

## 13. Versioning and Persistence

Expected entry state after M42 + Governance Baseline Reconciliation is merged must be read from the live repository, not assumed from this draft.

Known current direction before final entry revalidation:

- M42 introduced `StateModel.defects` and advanced `AIQT_SCHEMA_VERSION` to `0.6.0`;
- the governance reconciliation proposes package `0.36.1`;
- M43 should not require another canonical schema change if structural findings remain transient and defect persistence is delegated to M42.

If implementation unexpectedly requires new durable canonical state, stop and reassess the WU/classification before changing `AIQT_SCHEMA_VERSION`.

Package version changes follow the live `versioning.md` policy. Package version, schema version, milestone identity, and GitHub Release remain independent.

## 14. Entry Gates

M43 implementation may begin only after:

1. Governance Baseline Reconciliation PR is MERGED.
2. Post-merge `main` Validate is GREEN.
3. Local `main` is synchronized to that validated merge commit and working tree is clean.
4. Product Specification v0.7 and Technical Architecture v0.4 remain active baselines.
5. Live governance baseline includes `milestone-protocol.md` v0.3, prompt template v0.3, owner map `@2`, current versioning/recovery/test policy, and revalidated CLI machine contract.
6. M42 remains completed and its defect owners are verified against live source.
7. `AIQT_SCHEMA_VERSION`, package version, and latest GitHub Release are read live and recorded independently.
8. No `.aiqt/` self-management state exists in the AIQT repository.
9. M40 is archived according to the rolling completed-milestone policy so only M41 and M42 remain hot completed when M43 starts.
10. Branch is created from latest validated `main`, using a milestone name equivalent to:

```text
milestone/m43-project-structural-review
```

## 15. Stop Conditions

Stop and request human review if any Work Unit requires:

- automatic conversion of all structural findings into canonical defects;
- structural review to mutate source/Git/canonical state as part of ordinary review;
- a new generic code-execution engine;
- a required external/network provider for core review;
- broad credential access;
- LLM-only decision ownership for finding validity, defect intake, or remediation authority;
- weakening M42 defect dedup/triage/risk boundaries;
- implementation/remediation risk >=50;
- a second durable issue database or new canonical side file;
- unplanned canonical schema evolution;
- M45 background scheduling, M46 portfolio governance, M47 PR integration, or M44 release reconstruction scope;
- unexplained authoritative CI failure or critical/high safety regression.

## 16. Documentation and Process

M43 follows the current Lean Milestone Protocol:

- one continuous run, continue by default and stop on exception;
- no routine subagents;
- targeted context, not broad repository reinvestigation by an agent;
- focused/impacted validation per WU;
- full authoritative validation at closure;
- one commit + annotated tag + risk score per Work Unit;
- compact success reports, detailed exception/failure evidence;
- one pre-PR closure audit;
- no `.aiqt/` self-management of AIQT;
- only `build-spec.md` while active, then `build-spec.md` + `closure-report.md` when completed.

Milestone completion does not authorize a GitHub Release.

## 17. Definition of Done

M43 is complete when AIQT can, against a real repository fixture/dogfood target:

- perform deterministic bounded structural review across the supported domains;
- show evidence-backed structural findings with stable keys, confidence, and reason codes;
- consolidate equivalent findings without losing provenance;
- suppress required benign false-positive controls;
- explain why a finding is or is not eligible for defect intake;
- keep structural review read-only;
- explicitly intake selected fresh findings through M42 rather than a parallel issue lifecycle;
- preserve M42 triage/remediation authority and the risk-50 human boundary;
- operate without any optional structural-evidence provider;
- demonstrate optional-provider isolation if a provider pilot is feasible;
- identify the known test-infrastructure reliability hotspot class without converting every timeout into a defect;
- pass the M43 dogfood and safety-regression gates;
- close with authoritative validation and a reviewable pre-PR audit.
