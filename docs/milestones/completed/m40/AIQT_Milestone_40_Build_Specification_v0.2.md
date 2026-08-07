# AIQT Milestone 40 Build Specification v0.2

## Release Governance, Risk Assessment, and Provenance

**Product:** AIQT CLI  
**Milestone:** M40  
**Status:** Planning-ready; implementation blocked until the M39 post-merge gate and release decision are complete  
**Risk classification:** Medium-risk  
**Protocol:** Lean Milestone Protocol  
**Planned Work Units:** 5  
**Primary objective:** Add a deterministic, evidence-backed release-governance workflow that separates milestone completion from release publication, evaluates release readiness and risk, binds provenance to the exact release candidate, generates reviewable release notes, and can create a GitHub Release draft without automatic publication.

**v0.2 governance delta:** Risk presentation now uses four bands — Green `0–24`, Yellow `25–49`, Orange `50–74`, Red `75–100`. Orange is the first band requiring human intervention; scores below `50` remain eligible for automated/agent approval when all other gates pass.

---

## 1. Source Alignment and Entry Gate

M40 follows M39 — **Agent Execution Efficiency and Context Control**.

M40 planning may be prepared while the M39 post-merge CI is still running, but implementation must not begin until all entry conditions are verified from the live repository.

### 1.1 Required M39 baseline

Before implementation, verify:

- M39 PR is merged to `main`.
- M39 integrated `main` commit is authoritative and post-merge `Validate` CI is green.
- M39 completed documentation exists under:

```text
docs/milestones/completed/m39/build-spec.md
docs/milestones/completed/m39/closure-report.md
```

- M39 milestone tag exists and is not moved or rewritten.
- M39 release decision has been completed explicitly:
  - if `v0.33.0` was published, record the release/tag/commit as baseline evidence;
  - if publication was deliberately deferred, record that decision honestly and continue without fabricating a release.
- package version and canonical schema version are read from the live repository rather than assumed from this planning document.
- `main` working tree is clean before branch creation.
- product `.aiqt/` self-management state is absent from the AIQT repository.

### 1.2 Documentation lifecycle transition

The repository milestone-document layout is:

```text
docs/
└── milestones/
    ├── active/
    │   └── m40/
    │       └── build-spec.md
    └── completed/
        └── m39/
            ├── build-spec.md
            └── closure-report.md
```

At M40 start:

1. verify all durable M39 milestone documents are under `completed/m39/`;
2. if tracked M39 milestone documents remain under `active/m39/`, move them to `completed/m39/` without creating duplicates or deleting unique evidence;
3. repair only links made stale by that move;
4. do not reorganize unrelated historical documentation;
5. place this M40 specification at `docs/milestones/active/m40/build-spec.md`;
6. `active/` represents only currently active milestone documentation.

At M40 closure, move the M40 build specification from `active/m40/` to `completed/m40/` and add only the concise closure report required by the documentation budget.

### 1.3 Branch

After the entry gate passes, create:

```text
milestone/m40-release-governance
```

Do not implement directly on `main`.

---

## 2. Product Objective

M40 formalizes a distinction that is now part of AIQT governance:

```text
milestone completion != product release
```

Completing a milestone must never automatically create, require, or imply a GitHub Release.

The intended lifecycle is:

```text
one or more milestones complete
        ↓
explicit release intent
        ↓
release candidate selected
        ↓
provenance + evidence collected
        ↓
readiness validated
        ↓
risk assessed
        ↓
release notes generated
        ↓
approval authority determined
        ↓
optional GitHub draft created
        ↓
publication performed outside M40 by an authorized actor
```

A release may aggregate multiple completed milestones. A completed milestone may also remain unreleased until a later product checkpoint.

Core invariants:

```text
No milestone automatically becomes a release.
No release is assessed without an explicit candidate.
No missing evidence is presented as verified.
No release is automatically published by M40.
```

---

## 3. Scope

M40 covers:

- explicit release intent and one-or-more-milestone candidate selection;
- candidate identity, commit, milestone/tag/closure, version, CI, and security provenance;
- evidence completeness/trust states and fail-closed readiness;
- deterministic explainable 0–100 risk scoring plus approval authority;
- package-version vs canonical-schema-version handling;
- breaking-change, migration, rollback, compatibility, and limitation declarations;
- deterministic human/JSON release notes with risk near the top;
- local release-evidence preparation;
- bounded GitHub Release **draft** creation/status with safe credential placeholders;
- controlled disposable/non-AIQT dogfood.

---

## 4. Out of Scope

M40 must not implement:

- automatic release publication, merge, deployment, scheduling, version bumping, waiver approval, or security remediation;
- PR creation/merge/approval automation or product use of the AIQT repository's `approved-for-merge` label;
- fabricated human approval evidence;
- arbitrary GitHub API access, generic shell/network execution, or provider billing/quota APIs;
- adaptive test selection (M41), defect remediation (M42), structural review (M43), historical release reconstruction (M44), background scheduling (M45), portfolio governance (M46), or controlled PR integration (M47);
- AIQT self-management of the AIQT repository.

M40 may inspect historical evidence only when required to validate the currently selected release candidate. It must not reconstruct missing historical releases; that belongs to M44.

---

## 5. Governing Decisions

### 5.1 Explicit release intent

A release workflow begins only because an operator explicitly requests release assessment/preparation for a candidate.

No command that completes, checkpoints, reviews, or closes a milestone may implicitly create a release candidate.

The candidate must identify at least:

- repository/project identity;
- intended package release version;
- intended release tag;
- candidate commit/ref;
- one or more included completed milestone IDs;
- included milestone tags/closure commits where available;
- base release/version when available.

If required identity cannot be established, assessment fails closed.

### 5.2 Milestone/release decoupling

The system must support all of these valid states:

```text
milestone complete, no release requested
multiple milestones complete, one combined release requested
release candidate prepared, publication deferred
release candidate blocked by evidence/risk
release draft created, publication pending authorized actor
```

A missing GitHub Release for a completed milestone is not itself an error.

### 5.3 Evidence honesty

Release evidence states must distinguish at least:

```text
verified
reconstructed
partial
missing
waived
```

`reconstructed` is evidence quality, not permission to perform M44 historical release reconstruction.

Missing or partial evidence must never silently become verified.

### 5.4 Package version vs schema version

M40 must preserve the existing architectural distinction:

```text
package.json.version != AIQT_SCHEMA_VERSION
```

A package release may change without a canonical schema change. Release assessment must not assume they advance together.

### 5.5 Approval authority is separate from traffic-light status

Traffic-light status:

| Score | Status | Meaning |
|---:|---|---|
| `0–24` | 🟢 Green | Low release risk |
| `25–49` | 🟡 Yellow | Controlled release risk; automation remains permitted |
| `50–74` | 🟠 Orange | Elevated release risk; human intervention required |
| `75–100` | 🔴 Red | High release risk; human intervention and explicit waiver required |

Approval authority:

| Score | Required approval authority |
|---:|---|
| `0–49` | Agent approval permitted |
| `50–74` | Human approval required |
| `75–100` | Human approval + explicit waiver required |

Important boundary examples:

```text
24 → Green, agent approval permitted
25 → Yellow, agent approval permitted
49 → Yellow, agent approval permitted
50 → Orange, human approval required
74 → Orange, human approval required
75 → Red, human approval + waiver required
```

The traffic-light status must never be used as a substitute for approval authority.

### 5.6 Publication boundary

M40 may:

- assess;
- validate;
- generate notes;
- prepare bounded local evidence;
- determine required approval authority;
- create an explicit GitHub Release draft;
- inspect that draft.

M40 must not publish a GitHub Release.

Final publication remains an explicit external step performed by an actor satisfying the authority returned by M40.

This keeps M40 bounded while still making approval policy machine-readable and auditable.

### 5.7 Candidate integrity vs publication authority

M40 must keep two questions separate:

```text
Is this candidate internally/provenance-ready?
Who is authorized to approve publication?
```

Candidate-integrity outcomes must include equivalents of:

```text
ready
ready_with_warnings
blocked
insufficient_evidence
```

Publication-authority outcomes must include equivalents of:

```text
agent_approval_permitted
human_approval_required
human_waiver_required
```

A candidate may be integrity-ready while still requiring human approval or a waiver before publication. Approval requirements must not be misreported as provenance failures.

GitHub draft creation may be allowed for an integrity-ready candidate that still needs human publication approval/waiver, provided the draft prominently reports that requirement and no publication occurs.

### 5.8 No reuse of PR approval as release approval

The AIQT repository currently uses `approved-for-merge` as a human merge gate for its own development workflow.

M40 must not treat that label as release-publication approval.

PR approval and release approval are separate governance decisions and must remain separate in product contracts.

---

## 6. Release Candidate and Provenance Contract

M40 must define or reuse one release-governance contract owner.

The exact implementation should reuse current M22/M23 evidence trust, M33 result, Git/version, CI, runlog, digest, and external-execution owners rather than duplicate them.

At minimum the logical contract must cover equivalents of:

```text
ReleaseCandidate
ReleaseIdentity
ReleaseMilestoneRef
ReleaseEvidence
ReleaseEvidenceItem
ReleaseEvidenceStatus
ReleaseProvenance
ReleaseReadinessAssessment
ReleaseDecision
ReleaseBlockingFinding
ReleaseWarning
ReleaseRiskAssessment
ReleaseApprovalAuthority
ReleaseApprovalEvidence
ReleaseWaiver
ReleaseDraftState
```

### 6.1 Required provenance binding

Bind a release candidate to the exact evidence available for:

- repository/project identity;
- package version;
- canonical schema version where applicable;
- intended release tag;
- candidate commit;
- base release/tag when available;
- included milestone IDs;
- included milestone tags;
- included milestone closure commits;
- closure-report digests where available;
- final candidate CI run identity;
- CI commit SHA;
- directly relevant validation evidence;
- security/supply-chain evidence status;
- release-notes digest;
- risk-assessment version;
- approval-authority decision.

The candidate/provenance digest must be deterministic for identical canonical inputs.

A mismatch between candidate commit, CI commit, milestone provenance, or intended release identity must fail closed or produce an explicit blocking finding according to the contract.

### 6.2 Candidate scope must be bounded

Do not recursively ingest Git history, documentation, or repository contents.

Use existing structured state, bounded evidence references, explicit milestone selections, Git metadata, and current CI/security facts.

---

## 7. Deterministic Release Risk Model

### 7.1 Required properties

The release-risk score must be:

- deterministic;
- bounded `0–100`;
- explainable;
- versioned;
- testable;
- evidence-backed;
- independent from arbitrary caller-provided final scores.

An existing milestone implementation-risk score may be an input signal, but must not automatically become the release-risk score.

### 7.2 Required categories

Use the following maximum contributions unless live architecture evidence requires an equivalent normalization that preserves the same 100-point contract:

| Category | Maximum |
|---|---:|
| Security and supply chain | 20 |
| Regression exposure | 15 |
| Architectural/change blast radius | 15 |
| Test confidence | 15 |
| Operational complexity | 10 |
| Compatibility and migration | 10 |
| Rollback and recovery | 5 |
| Pilot/dogfood maturity | 5 |
| Known limitations | 5 |
| **Total** | **100** |

WU40-02 must define a concrete deterministic mapping from available evidence states/signals to category contributions. The implementation must not accept a free-form authoritative total from the caller.

### 7.3 Required output

Every assessment must expose:

- total score;
- 🟢/🟠/🔴 status;
- category contributions;
- major risk contributors;
- mitigations;
- residual risks;
- blockers;
- operational recommendation;
- required approval authority;
- waiver requirement;
- assessment version;
- evidence gaps affecting confidence.

---

## 8. Release Readiness Rules

Readiness must evaluate, where applicable to the selected candidate:

- explicit release intent/candidate exists;
- candidate includes at least one completed milestone;
- candidate commit exists and is unambiguous;
- included milestones are completed;
- included milestone tags/closure commits agree where required by repository governance;
- package release version is valid under current version policy;
- intended release tag is valid and not conflicting;
- package/schema relationship is declared correctly;
- candidate CI is authoritative and green;
- CI commit matches candidate commit;
- directly relevant validation evidence is present;
- security/supply-chain findings are triaged;
- breaking changes are declared;
- migration requirements are declared;
- rollback/recovery is declared;
- known limitations are declared;
- risk assessment exists;
- approval authority is derived from the score;
- publication approval/waiver state is reported separately from candidate integrity;
- GitHub draft side effect is not attempted from stale provenance.

A missing human approval or waiver may prevent **publication readiness** without making an otherwise valid candidate's provenance/integrity invalid. The result contract must expose both dimensions clearly.

Not every release requires every optional artifact. The decision owner must distinguish `not_applicable` from `missing` rather than treating them as the same state.

---

## 9. Human and Machine Release Notes

Release notes must be deterministic from the same candidate/evidence snapshot.

Human and JSON outputs must carry substantively equivalent release findings under the M33 result contract.

### 9.1 Human release-note layout

Risk/readiness must be visible near the top rather than buried at the end.

Recommended structure:

```markdown
# AIQT vX.Y.Z — Release Title

> 🟡 **RISK: 30/100 — YELLOW**
> **Candidate integrity:** READY | READY WITH WARNINGS | BLOCKED
> **Approval authority:** Agent permitted | Human required | Human + waiver required

## At a Glance
| Included milestones | Candidate commit | CI | Breaking changes |
|---|---|---|---|
| ... | ... | ✅/❌ | Yes/No |

## Summary

## Delivered Capabilities

## Included Milestones

## Important Fixes

## Validation Evidence

## Risk / Potential Risks
### Main Risk Contributors
### Mitigations
### Residual Risks
### Operational Recommendation

## Security and Supply Chain

## Breaking Changes

## Upgrade / Migration Notes

## Known Limitations

## Rollback and Recovery

## Provenance
```

The exact wording may follow existing repository style, but the risk status must remain immediately scannable.

Do not rely on externally hosted badge images for correctness or status representation.

---

## 10. Public CLI Surface

Prefer one cohesive `release` command family rather than unrelated top-level commands.

Expected surface, subject to live command-registration conventions:

```text
aiqt release assess
aiqt release validate
aiqt release notes
aiqt release prepare
aiqt release draft
aiqt release status
```

### 10.1 Semantics

- `assess`: read-only evidence/risk assessment;
- `validate`: read-only readiness/provenance gate;
- `notes`: render deterministic release notes;
- `prepare`: produce bounded local release evidence/artifacts without remote publication;
- `draft`: explicit GitHub Release draft side effect;
- `status`: read current candidate/draft readiness without mutation where possible.

All supported commands must follow M33 human/JSON/exit-code conventions.

No release command may implicitly close milestones, merge branches, deploy, or publish a release.

---

## 11. GitHub Draft Integration Boundary

GitHub integration is the highest-risk M40 side effect and must remain narrow.

### 11.1 Required behavior

Before creating a draft:

- explicit operator intent is present;
- candidate provenance is current;
- candidate integrity/readiness is not blocked;
- intended release tag/version/commit are consistent;
- required publication approval/waiver status is visible;
- GitHub repository identity matches the candidate;
- credentials/permissions are available through existing safe configuration patterns.

Draft creation must return a bounded identifier/URL and must not publish.

### 11.2 Credentials and setup

For user-side GitHub setup, follow the existing placeholder/configuration policy:

- environment-variable/config wiring;
- least-privilege permission guidance;
- no secret persistence in canonical state;
- no token logging;
- clear operator action list when credentials are missing;
- safe failure when repository/permission identity is ambiguous.

### 11.3 Execution safety

Reuse existing bounded external-command/network/process owners where possible.

Do not introduce:

- generic shell execution;
- arbitrary `gh` arguments from untrusted input;
- unrestricted network clients;
- credential echoing;
- automatic retry loops that can duplicate side effects.

Draft creation must be replay/idempotency-aware enough to avoid duplicate drafts from the same candidate when the existing GitHub state can be identified safely.

---

## 12. Work Units

## WU40-01 — Release Intent, Candidate, and Provenance Contract

**Implementation risk target:** 30/100  
**Objective:** Establish the single release-governance contract owner, explicit candidate model, evidence states, and provenance binding without GitHub writes.

### Scope

- targeted live-owner inventory;
- candidate identity and explicit release-intent model;
- multi-milestone candidate support;
- evidence states;
- provenance digest;
- readiness skeleton;
- approval-authority/waiver shapes;
- M33 result mapping;
- no GitHub side effect.

### Acceptance criteria

- milestone completion alone cannot create a release candidate;
- candidate may contain one or more completed milestones;
- missing identity/evidence fails closed;
- package and schema versions remain distinct;
- provenance digest deterministic;
- current evidence owners reused rather than duplicated;
- no publication/draft/network path exists in WU40-01;
- architecture tests protect the boundary.

### Tag

```text
m40-wu01-release-candidate-provenance
```

---

## WU40-02 — Explainable Risk Scoring and Approval Authority

**Implementation risk target:** 35/100  
**Objective:** Implement deterministic release-risk scoring, traffic-light classification, approval authority, and waiver requirements.

### Scope

- evidence-to-category scoring;
- category caps totaling 100;
- deterministic total;
- Green/Yellow/Orange/Red status;
- independent approval-authority boundary;
- blockers, mitigations, residual risks;
- assessment version.

### Acceptance criteria

- same canonical evidence produces same score;
- score always `0–100`;
- `0–24` green;
- `25–49` yellow;
- `50–74` orange;
- `75–100` red;
- `0–49` agent approval permitted;
- `50–74` human approval required;
- `75–100` human approval plus explicit waiver required;
- boundary tests cover 24/25/49/50/74/75;
- no caller-supplied arbitrary final score can override the assessor;
- risk explanation includes category contributions and evidence gaps.

### Tag

```text
m40-wu02-release-risk-approval-authority
```

---

## WU40-03 — Release Readiness CLI and Visual Release Notes

**Implementation risk target:** 35/100  
**Objective:** Expose assessment/validation/notes/prepare/status through the established CLI/result contract and make human release reviews fast to scan.

### Scope

- `release assess`;
- `release validate`;
- `release notes`;
- `release prepare`;
- `release status`;
- human/JSON parity;
- deterministic note generation;
- risk block near the top;
- local evidence/artifact preparation only.

### Acceptance criteria

- all new command outcomes use M33 result/exit/stream conventions;
- no automatic candidate creation on milestone closure;
- notes prominently show risk score/status/approval authority;
- missing evidence is explicit;
- multi-milestone candidates render correctly;
- local preparation does not create/publish a GitHub Release;
- generated outputs are deterministic for the same evidence snapshot;
- no raw-output bypass.

### Tag

```text
m40-wu03-release-readiness-cli-notes
```

---

## WU40-04 — Controlled GitHub Release Draft Integration

**Implementation risk target:** 45/100  
**Objective:** Add one explicit, bounded GitHub draft side effect without publication, merge, deploy, or generic network execution.

### Scope

- `release draft`;
- safe credential/config placeholders;
- repository identity verification;
- candidate freshness/provenance checks;
- draft creation;
- existing-draft detection/idempotency behavior;
- bounded draft status response;
- secret redaction;
- failure mapping through M33.

### Acceptance criteria

- draft creation requires explicit command intent;
- stale candidate or CI mismatch blocks;
- repository identity mismatch blocks;
- no secret appears in output/evidence;
- missing credentials return a clear operator action list;
- duplicate side effects are prevented or surfaced deterministically;
- draft URL/ID returned on success;
- no publication endpoint/path is introduced;
- no automatic merge/deploy/version bump;
- approval authority remains visible but does not get fabricated by draft creation;
- an integrity-ready draft may exist while human approval/waiver is still pending, but publication remains impossible in M40.

### Tag

```text
m40-wu04-github-release-draft
```

---

## WU40-05 — Integration Dogfood, Closure, and Release-Decision Proof

**Implementation risk target:** 40/100  
**Objective:** Prove the complete release-governance flow, confirm milestone/release decoupling, validate safety boundaries, and close M40.

### Required scenarios

Use controlled disposable repositories/fixtures and, where practical, at least one non-AIQT project flow. Do not use AIQT to self-manage AIQT development.

Prove at least:

1. completed milestone with **no release requested** remains valid and unchanged;
2. one-milestone release candidate reaches deterministic assessment/notes;
3. multi-milestone release candidate preserves each included milestone's provenance;
4. score 49 permits agent approval authority;
5. score 50 requires human approval authority;
6. score 76 requires human approval + waiver;
7. stale CI/candidate mismatch blocks draft creation;
8. missing GitHub credentials fail safely with operator guidance;
9. controlled draft creation works in an authorized disposable/non-production repository when credentials are available;
10. no publication occurs;
11. human and JSON outputs remain substantively aligned;
12. M37/M38 safety controls are not weakened.

If real GitHub draft dogfood cannot be performed because credentials/setup are unavailable, do not fabricate success. Record the blocked external-setup state and validate the safe placeholder path. Whether this blocks M40 closure must be decided from the live repository's existing external-integration governance and documented explicitly.

### Closure validation

Run:

- focused/impacted validation accumulated through WU40;
- typecheck;
- lint;
- build;
- version check;
- `git diff --check`;
- authoritative Node 24 full validation/CI gate at milestone closure;
- directly relevant security/architecture boundary tests.

### Closure documentation

Create only:

```text
docs/milestones/completed/m40/build-spec.md
docs/milestones/completed/m40/closure-report.md
```

plus any genuinely reusable durable governance/contract document justified by repository documentation policy.

Move the build specification out of `active/m40/` only after closure criteria pass.

### Tags

```text
m40-wu05-release-governance-dogfood-closure
m40-release-governance-risk-provenance
```

The milestone tag is created on the final closure commit according to repository governance.

---

## 13. Cross-Work-Unit Invariants

Every WU must preserve:

1. No AIQT self-management; `main` remains default and M40 work stays on its milestone branch.
2. Milestone completion never implies release; explicit candidate selection is required and may aggregate multiple completed milestones.
3. Package and schema versions remain independent.
4. Missing evidence is never fabricated or silently upgraded to verified.
5. Release risk is deterministic/explainable: Green `0–24`, Yellow `25–49`, Orange `50–74`, Red `75–100`.
6. Approval authority is separate: `<50` agent permitted; `50–74` human required; `75–100` human + waiver.
7. Candidate integrity and publication authority remain separate decisions.
8. No automatic waiver, version bump, merge, deployment, scheduling, or GitHub Release publication.
9. `approved-for-merge` is never release-approval evidence.
10. M33 result/JSON/human contract and M37/M38 safety boundaries remain authoritative.
11. M41/M44/M47 scope is not pulled forward and no generic shell/network surface is introduced.
12. Success output stays compact; failures retain detailed evidence; subagents are not default.
13. Each numbered WU gets one detailed commit, unique tag, focused validation, and `Risk: N/100`.
14. Full suite is not the normal per-WU default; authoritative full validation is required at closure.
15. Documentation stays lean: active build spec + closure report, plus only genuinely reusable durable policy/contracts.

---

## 14. Validation Strategy

M40 adopts the efficiency policy proven by M39.

### Per Work Unit

Run:

- tests added/changed for that WU;
- directly impacted regressions;
- cheap type/lint/build/version/diff gates appropriate to the touched surface.

Do not run the full suite after every WU by default.

Escalate validation only when blast radius or live evidence requires it, and record the reason.

### Milestone closure

WU40-05 must execute the authoritative broad/full validation required by current repository governance and use real CI as the clean-environment authority.

Do not hide flaky/time-out outcomes. Classify and reproduce them honestly.

---

## 15. Source-Control and PR Discipline

For AIQT's own implementation of M40:

```text
clean main
→ milestone/m40-release-governance
→ WU implementation
→ focused/impacted validation
→ detailed WU commit + WU tag
→ continue by default
→ closure validation
→ closure report + docs active→completed
→ milestone tag
→ PR to main
→ human review
→ approved-for-merge label
→ merge commit
→ post-merge main CI
→ separate explicit release decision
```

`approved-for-merge` is repository-development governance only. It is not part of the product release-approval contract.

If tracked PR content changes after human approval, current repository governance requires the approval label to be invalidated and re-applied after review.

M40 itself must not automate this PR lifecycle; controlled PR integration remains M47 scope.

---

## 16. Stop Conditions

Stop and request human review if implementation requires any of the following:

- automatic GitHub Release publication;
- generic shell/network execution;
- a new credential store or secret persistence in canonical state;
- weakening M37/M38 safety controls;
- weakening M33 result/JSON guarantees;
- treating `approved-for-merge` as release approval;
- historical release reconstruction beyond current-candidate evidence;
- adaptive test-selection behavior belonging to M41;
- PR merge behavior belonging to M47;
- an incompatible canonical schema migration;
- a significant dependency whose security/maintenance impact cannot be bounded;
- inability to distinguish package version from schema version;
- inability to bind CI to the exact candidate commit;
- an implementation-risk score of `50/100` or higher for a WU without explicit human review before continuing;
- more than one unplanned stabilization WU being required.

One narrowly scoped stabilization WU may be created only when necessary to close an integration defect discovered during M40 integrated review. If further stabilization is required, stop for human decision.

---

## 17. Definition of Done

M40 is complete only when:

- explicit release intent is required;
- milestone completion does not create releases;
- multi-milestone candidates are supported;
- one release-governance decision owner exists;
- provenance binds the exact candidate commit, CI, versions, and included milestone evidence;
- package/schema distinction is preserved;
- deterministic 0–100 scoring exists;
- Green/Yellow/Orange/Red thresholds are exact;
- `<50` vs `>=50` approval authority is enforced in the decision model;
- `>=76` yields human + waiver publication authority;
- candidate integrity and publication authority remain separate outputs;
- release readiness fails closed on material evidence/provenance mismatch;
- CLI human/JSON outputs follow M33;
- release notes put risk/readiness near the top;
- GitHub draft creation is explicit, bounded, secret-safe, and non-publishing;
- no merge/deploy/background scheduling surface is added;
- M41/M44/M47 scope is not pulled forward;
- disposable/non-AIQT dogfood proves the release-decision model and safety boundaries;
- authoritative Node 24 closure validation/CI is green or any non-product infrastructure exception is explicitly reconciled under repository governance;
- M40 WU commits/tags exist;
- documentation is moved from `active/m40/` to `completed/m40/` at closure;
- closure report is concise and complete;
- final working tree is clean;
- M41 does not begin until M40 is merged and formally closed.

---

## 18. Closure Report Requirements

Keep the closure report concise and evidence-oriented. Record:

- verified M39 entry/release-decision baseline and M40 start/end versions/commits;
- WU commit/tag/risk table;
- explicit-intent and multi-milestone candidate behavior;
- provenance/digest owner and risk-scoring version/categories;
- 24/25/49/50/74/75 boundary evidence and approval-authority behavior;
- CLI/human-JSON behavior and top-of-release risk presentation;
- GitHub draft/credential boundary and dogfood results;
- full validation/CI, defects, limitations, final risk, PR/release status, and M41 entry decision.

Do not reproduce raw logs or restate the full build specification.

---

## 19. Planned Milestone Tag

```text
m40-release-governance-risk-provenance
```

A semantic product release tag is a separate decision. Completing M40 does not automatically require or create one.
