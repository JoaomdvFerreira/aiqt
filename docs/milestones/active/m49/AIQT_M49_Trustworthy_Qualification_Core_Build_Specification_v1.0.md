# AIQT M49 — Trustworthy Qualification Core
**Build Specification v1.0**

**Status:** Review-complete — ready for owner approval and implementation  
**Milestone:** M49  
**Classification:** Medium / core-correctness  
**Risk:** **64/100 — Orange**  
**Execution:** Sequential — 5 Work Units

---

## 1. Objective

M49 strengthens the existing AIQT core before any further product expansion.

The milestone must make AIQT:

1. truthful about implementation completion;
2. trustworthy about evidence;
3. reliable across interrupted/concurrent state mutations;
4. capable of deriving change qualification and project production readiness;
5. able to reconstruct a review/handoff context without depending on prior chat history.

M49 is a **correctness and simplification milestone**, not a feature-expansion milestone.

---

## 2. Source alignment and preflight

The technical reconnaissance used:

- AIQT `0.46.4`;
- schema `0.9.0`;
- repository HEAD `8df9b31`.

Before WU1 begins, the implementation agent must compare current `main` against that reviewed baseline.

If subsequent changes materially affect any of these areas:

- checkpoint completion;
- amendments;
- evidence;
- persistence/mutation;
- review/release qualification;
- context/handoff;

the agent must report the drift before implementation and reconcile this specification against current code.

Unrelated repository advancement does not block M49.

No new architecture review is required unless baseline drift invalidates a canonical M49 decision.

---

## 3. Canonical owner decisions

These decisions are fixed for M49.

| Decision | Canonical rule |
|---|---|
| `done` | Means implementation completion |
| Dependency progression | `done` continues to satisfy development dependencies |
| Historical `done` | Preserved |
| Historical qualification | `UNKNOWN` unless sufficient evidence exists |
| Qualification | Derived; not a new persisted WU status |
| Production verification | Separate from qualification |
| Runtime verification | Applicability-based |
| Legacy `productionReady` | Enters compatibility/deprecation transition |
| Storage | File-based model retained |
| Context | Existing machinery reused/consolidated |
| Trusted sources | Deliberately small initial trust surface |
| Advanced subsystems | Frozen during M49 |
| Maintenance scheduling | Strategically deprecated; no removal in M49 |

The existing WU statuses remain:

```text
ready
planned
in_progress
needs_review
done
replanned
cancelled
```

M49 must not add lifecycle statuses.

---

## 4. Canonical semantics

### 4.1 Implementation completion

Answers:

> Has the approved implementation work been completed sufficiently for downstream development to continue?

Existing WU lifecycle state owns this boundary.

`done` does **not** imply production qualification.

---

### 4.2 Production qualification

Answers:

> Does this exact revision satisfy all applicable requirements required before production progression?

Derived result:

```text
QUALIFIED
BLOCKED
UNKNOWN
```

Inputs may include:

```text
work contract
exact revision
applicable requirements
verification outcomes
evidence provenance/trust
evidence freshness
unresolved blockers
review requirements
decisions/exceptions
required authority
```

Qualification is recomputable and revision-specific.

---

### 4.3 Production verification

Answers:

> Has the qualified change reached its applicable target environment and passed the required post-delivery verification?

Derived result:

```text
VERIFIED
FAILED
UNKNOWN
NOT_APPLICABLE
```

Production verification must never be inferred from `done` or qualification.

---

### 4.4 Requirement outcome vs authority decision

Technical outcome and human authority must remain separate.

A requirement/evidence outcome may be:

```text
PASS
FAIL
UNKNOWN
NOT_APPLICABLE
```

A human decision may separately:

```text
accept an exception
accept residual risk
waive a requirement for a defined scope
```

A waiver/exception **does not transform `FAIL` into `PASS`**.

Qualification output must preserve both:

```text
underlying outcome
+
applicable authority decision
```

This preserves:

```text
CLAIM ≠ EVIDENCE ≠ DECISION
```

---

## 5. Project production readiness

M49 introduces a **minimal derived view**, not a new production-standard framework.

It answers:

> Which production-baseline requirements are applicable to this project, and which are currently satisfied, failed, unknown, not applicable, or covered by an explicit authority decision?

M49 may reuse existing facts relating to areas such as:

```text
build
CI
testing
repository protection
secrets/security
deployment
runtime/observability
migration/recovery
rollback/recovery
```

These examples are not a mandatory universal checklist.

M49 must **not** introduce:

- a standards-pack framework;
- a large policy library;
- new CI/security/deployment integrations merely to populate the view.

Where AIQT cannot establish a fact:

```text
UNKNOWN
```

must be preserved.

---

## 6. Work Unit sequence

```text
WU1 Honest Completion
        ↓
WU2 Revision-Bound Evidence
        ↓
WU3 Reliable Mutation Boundary
        ↓
WU4 Derived Qualification & Readiness
        ↓
WU5 Canonical Handoff / Context
```

Implementation is sequential.

No parallel M49 WUs.

---

## 7. WU1 — Honest Completion

### Objective

Make checkpoint and amendment completion semantics consistent without changing normal dependency sequencing.

### Required changes

Create one canonical completion evaluation used by equivalent checkpoint/amendment paths.

Evaluation must account for effective:

```text
validation claims/results
acceptance claims/results
unfinished work
blocking issues/findings
explicit applicability/exception decisions
```

Detailed results must map consistently to the WU contract.

Missing evaluation must remain distinguishable from successful evaluation.

Historical completion is not re-opened.

### Acceptance criteria

- Checkpoint and amendment promotion use equivalent completion semantics.
- Amendment overlays cannot bypass unresolved effective work/blockers.
- Required validation/acceptance items cannot silently disappear behind an aggregate success flag.
- `FAIL`, `UNKNOWN/not checked`, and `NOT_APPLICABLE` remain distinct.
- Human exception decisions remain distinct from verification outcomes.
- Existing `done` dependency behavior remains unchanged.
- Historical completed work remains completed.
- No qualification semantics are added to `done`.

### Explicitly out of scope

- Qualification engine.
- Evidence trust redesign.
- New WU statuses.

---

## 8. WU2 — Revision-Bound Evidence

### Objective

Make existing evidence safe to consume by qualification.

### Required changes

#### Outcome semantics

Rules requiring successful verification must inspect relevant evidence outcomes.

```text
evidence exists + outcome FAIL
≠
successful verification
```

Presence-only requirements may remain presence-only where explicitly intended.

#### Revision binding

Evidence qualifying a change must be comparable to the exact repository/revision under assessment.

```text
non-comparable identity
→ UNKNOWN
```

The presence of an arbitrary code identifier is insufficient.

#### Freshness

Distinguish trustworthy observation time from import/record time.

Re-importing evidence must not refresh the underlying observation.

Legacy evidence without sufficient observation-time/revision facts remains readable but must not gain unjustified trust.

#### Trust

Self-declared CI/security/review status remains self-reported unless an authenticated or independently controlled source establishes it.

#### Exception scope

Exceptions must apply only to their explicit project/work/rule/revision scope and validity window.

#### Resolution evidence

A reported successful remediation plus an artifact locator is not automatically independently verified resolution.

### Acceptance criteria

These invariants must be proven:

```text
FAIL cannot satisfy a PASS requirement
```

```text
wrong revision cannot qualify current revision
```

```text
re-import cannot make stale evidence fresh
```

```text
non-comparable revision → UNKNOWN
```

```text
self-reported ≠ trusted observation
```

```text
exception scope A cannot affect scope B
```

Existing append-only evidence history and trust ceilings must remain intact.

---

## 9. WU3 — Reliable Mutation Boundary

### Objective

Prevent silent divergence between canonical state and required history during interruption or concurrent mutation.

### Architectural constraint

Retain file-based persistence.

M49 must not introduce:

```text
database
event sourcing
message broker
distributed transaction system
```

### Required changes

Implement the smallest reliable project mutation boundary:

```text
per-project mutation serialization
+
complete candidate validation
+
durable pending-mutation identity
+
expected state revision
+
intended history/event effects
+
idempotent recovery
```

Existing remote-action intent/reconciliation patterns remain applicable to external side effects.

### Acceptance criteria

- Every canonical mutation validates the complete candidate before commit.
- Concurrent local writers cannot silently overwrite one another.
- Interrupted mutation is detectable.
- Recovery restores required state/history consistency.
- Recovery is idempotent.
- Recovery does not duplicate semantic events.
- Existing specialized recovery behavior does not regress.

No generalized transaction framework may be introduced.

---

## 10. WU4 — Derived Qualification & Readiness

### Objective

Create one canonical derivation for:

1. change production qualification;
2. project production-readiness assessment;
3. production-verification semantics.

No new persisted lifecycle state is introduced.

---

### 10.1 Change qualification

Qualification is evaluated for:

```text
work identity + exact revision
```

using the canonical facts available after WU1–WU3.

Derived output:

```text
QUALIFIED
BLOCKED
UNKNOWN
```

The evaluator must preserve explanatory reasons, including:

```text
failed requirement
missing evidence
stale evidence
revision mismatch
unresolved blocker
missing authority
accepted exception
unknown external fact
```

The same qualification derivation must feed all applicable surfaces.

There must not be contradictory qualification logic in:

```text
review
manage/status
exports
release assessment
```

---

### 10.2 Project production-readiness view

Implement only the minimal applicability/evidence view required to answer:

```text
Which baseline requirements apply?
What proves them?
What fails?
What remains unknown?
What explicit exceptions exist?
```

Reuse existing project facts, decisions and evidence.

Do not create a new broad policy framework.

An unknown external fact remains `UNKNOWN`.

---

### 10.3 Legacy `productionReady`

The existing `productionReady` output must enter an explicit transition.

M49 must:

- identify current public/machine consumers;
- introduce truthful replacement fields/views;
- document semantic differences;
- prevent legacy output from contradicting canonical qualification;
- preserve compatibility for the defined transition window.

Do not silently repurpose a legacy field with materially different semantics.

---

### 10.4 Production verification

Define and expose the semantic boundary only.

Where sufficient deployment/runtime observations already exist, derive:

```text
VERIFIED
FAILED
UNKNOWN
NOT_APPLICABLE
```

M49 does not add deployment or observability infrastructure.

---

### Acceptance criteria

```text
same canonical inputs
→ same qualification
```

```text
missing required evidence
→ BLOCKED or UNKNOWN
```

never implicit qualification.

```text
required FAIL
→ not QUALIFIED
```

unless an explicit applicable authority decision permits progression while preserving the failure.

```text
historical done + insufficient evidence
→ qualification UNKNOWN
```

```text
unknown project baseline fact
→ UNKNOWN
```

Qualification/readiness conclusions are derived, not stored as timeless truth.

---

## 11. WU5 — Canonical Handoff / Context

### Objective

Consolidate existing context/handoff machinery around one derived representation suitable for execution, continuation and review.

M49 must reuse existing mechanisms rather than build a new retrieval system.

### Retain/reuse

Where still appropriate:

```text
root resolution
project-record reference resolution
packet generation
context selection
continuation
validation/test-selection inputs
```

### Required corrections

Canonical handoff/context inputs must use:

- correct implementation repository/root;
- exact/current revision where applicable;
- actual Git diff where required;
- effective checkpoint/amendment state;
- consistent context-reference interpretation;
- WU2 evidence facts;
- WU4 qualification facts;
- unresolved findings;
- applicable decisions/exceptions.

Token/size reporting must distinguish:

```text
measured
estimated
provider-reported
```

An estimate must never be represented as a measured fact.

### Handoff contract

A reviewer must be able to request:

```text
work identity + revision
```

and obtain/resolve:

```text
work contract
objective/scope
acceptance criteria
revision/base/head
relevant changes
verification observations
evidence + trust
known limitations
unresolved blockers
applicable decisions/exceptions
qualification result
next required action/authority
```

The durable source remains canonical project/repository facts.

A rendered review package may exist as an export, but must not become a second source of truth.

### Acceptance criteria

- One canonical derived handoff/context model exists.
- Existing consumers converge on the same underlying facts.
- Separate control and implementation repositories work correctly.
- Effective amendments are represented.
- Relevant actual Git change facts are available where needed.
- Duplicate current-state summaries are reduced where safe.
- Review no longer depends on previous development-chat output.
- No embeddings, vector DB, knowledge graph or semantic-memory subsystem is introduced.

---

## 12. Compatibility contract

Backward compatibility is release-blocking for M49.

At minimum verify:

```text
historical AIQT project
        ↓
new binary
        ↓
loads safely
        ↓
historical done preserved
        ↓
qualification UNKNOWN where proof is insufficient
        ↓
no destructive rewrite
```

Special attention is required for:

```text
observation timestamps
revision identity
new evidence facts
nested checkpoint/evidence fields
unknown-field preservation
legacy productionReady consumers
historical checkpoint/amendment behavior
```

Persisted schema versions change only when the persisted contract requires it.

Derived output changes alone do not justify a schema bump.

Compatibility behavior promised to older compatible binaries must be explicitly tested where applicable.

---

## 13. Advanced subsystem policy

No major subsystem is removed or extracted in M49.

### Strategically deprecated

```text
Maintenance scheduling
```

No runtime removal during M49.

### Frozen / extraction candidates

```text
Night Audit
Managed workspaces
Sandbox execution
Autonomous runs
Structural analysis
Portfolio
PR integration
Provider-specific execution translators
```

### Future simplification candidates

```text
Execution/session tracking
Adaptive test selection
Issues/defects/remediation
Release governance/history
```

M49 may make only compatibility-preserving changes to these areas required by the five WUs.

No opportunistic refactor/extraction.

---

## 14. Explicit non-goals

M49 must not add:

```text
new WU lifecycle statuses
parallel active WUs
company-style agents
PM/Architect/Tester/Reviewer agents
multi-agent orchestration
model router
dashboard/control-plane UI
vector retrieval
embeddings
knowledge graph
semantic project memory
policy DSL
standards-pack framework
plugin marketplace
new CI platform
testing framework
security scanner
deployment platform
automatic deployment
observability platform
database persistence
event sourcing
major subsystem extraction
```

Any discovery apparently requiring one of these must be returned for owner review, not implemented implicitly.

---

## 15. Minimum validation matrix

### Completion

- Normal checkpoint → correct implementation-completion result.
- Amendment → same effective predicate.
- Unfinished work cannot be hidden by aggregate success.
- Blocking issue cannot be bypassed by amendment.
- Historical `done` remains `done`.
- Dependency behavior remains compatible.

### Evidence

- Failed evidence does not satisfy successful verification.
- Evidence for revision A does not qualify revision B.
- Non-comparable revision identity returns unknown.
- Re-importing an old observation does not renew freshness.
- Self-reported CI remains self-reported.
- Scoped exception cannot escape its scope.

### Mutation

- Failure after canonical write/before history completion recovers.
- Failure during history persistence recovers idempotently.
- Re-running recovery creates no duplicate semantic events.
- Competing local mutations cannot silently lose updates.
- Invalid candidate cannot commit.

### Qualification

- Same facts produce same result.
- Missing evidence cannot produce `QUALIFIED`.
- Required failure cannot disappear through presentation logic.
- Human exception preserves underlying failed/unknown fact.
- Historical completion without proof produces `UNKNOWN`.
- Review/manage/export/release surfaces agree.

### Production readiness

- Applicable verified requirement is represented correctly.
- Failed requirement remains failed.
- Unknown external requirement remains unknown.
- Not-applicable requirement does not block.
- Explicit exception is visible separately from verification outcome.

### Context/handoff

- Correct implementation root used.
- Control/implementation repository split works.
- Effective amendments are included.
- Relevant Git change facts resolve correctly.
- Reviewer view reconstructs without prior chat.
- Estimated token data is labelled as estimated.

### Compatibility

- Historical fixtures load.
- Historical completion preserved.
- Legacy output transition tested.
- No destructive nested-field rewrite.
- Existing canonical repository validation remains green.

---

## 16. Milestone close gate

M49 closes only when all five WUs satisfy their acceptance criteria and the complete milestone proves these invariants:

```text
done ≠ qualified
qualified ≠ production verified
claim ≠ evidence ≠ decision
FAIL cannot silently become PASS
qualification is revision-specific
UNKNOWN is preserved when proof is absent
historical completion remains historically valid
qualification/readiness are derived
mutation recovery is reliable
handoff does not require chat history
```

All current repository-required:

```text
type/lint validation
tests
build
schema/contract validation
```

must pass using the canonical commands defined by the repository at implementation time.

Do not hard-code obsolete command names from older milestone specifications.

---

## 17. Work Unit completion discipline

Each WU must:

1. remain within its declared scope;
2. add/update focused tests for its changed contract;
3. preserve compatibility unless this specification explicitly changes semantics;
4. record all intentional contract changes;
5. return unresolved findings instead of expanding scope;
6. complete repository-required validation before close;
7. be committed according to current canonical AIQT repository governance.

Do not combine adjacent WUs merely because implementation touches the same files.

---

## 18. Post-M49 activity

The default next activity is a **bounded real-project validation pilot**, not another feature milestone.

Start with approximately:

```text
5–10 representative Work Units
```

Measure where obtainable without excessive instrumentation:

```text
Qualification Lead Time
Production Lead Time when applicable
Human Middleware Time
AI Cost per qualified WU
First-Pass Acceptance
Context Misses
Rework reason
AIQT Process Tax
```

The question is:

```text
AI-assisted development with AIQT
vs
AI-assisted development without AIQT
```

Only after real evidence identifies a residual bottleneck should AIQT consider:

```text
additional orchestration
roles
parallel execution
richer integrations
UI
```

---

## 19. Milestone success condition

M49 succeeds when AIQT can truthfully and reproducibly answer, for the relevant project/change:

> What work was approved?

> What implementation was completed?

> Which exact revision is under assessment?

> Which requirements apply?

> What was actually observed?

> Which evidence is trusted, self-reported, stale, mismatched, or missing?

> What failed, passed, remains unknown, or is not applicable?

> Which exceptions or authority decisions exist without rewriting the underlying facts?

> Is this revision production-qualified?

> Which project production-baseline gaps remain?

> Has production been verified where applicable?

> What action or authority is required next?

AIQT must answer those questions from canonical project/repository facts **without depending on prior conversational history and without claiming stronger assurance than the evidence supports**.
