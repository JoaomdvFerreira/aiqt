# AIQT Milestone 44 Build Specification v0.1

## Historical Release Reconstruction

**Product:** AIQT CLI
**Milestone:** M44
**Status:** Review candidate before build handoff
**Risk classification:** Medium
**Protocol:** Lean Milestone Protocol v0.3
**Planned Work Units:** 5
**Primary objective:** Add deterministic, evidence-backed historical release reconstruction for AIQT-managed projects by reconstructing a bounded release candidate from immutable Git/project evidence, classifying evidence quality honestly, reusing the existing M40 release-governance owners for readiness/risk/notes, and preserving publication as a separate explicit decision.

---

## 1. Source Alignment and Entry Gate

M44 follows M43 — Project Structural Review and Issue Discovery.

M44 strengthens the **Deterministic Governance and Evidence** pillar of AIQT Product Specification v0.7. It extends the release domain already established by M40 rather than introducing a second release engine.

The governing product model remains:

```text
milestone completion != product release
package version != automatic GitHub Release
```

M40 established explicit release intent, release candidates, provenance, readiness, deterministic risk, approval authority, release notes, local preparation, and bounded GitHub Release draft creation. Historical release reconstruction was explicitly deferred to M44.

M44 adds:

```text
historical immutable evidence
        →
bounded reconstruction
        →
evidence-quality classification
        →
M40-compatible release candidate
        →
M40 readiness + risk + notes
        →
explicit later draft/publication decision
```

It must never become:

```text
historical tag
→ assumed release
→ fabricated evidence
→ automatic GitHub publication
```

### 1.1 Required live baseline

Before implementation, verify from the live repository:

- M43 PR is merged to `main`;
- post-merge `main` Validate is green;
- Product Specification v0.7 and Technical Architecture v0.4 remain active;
- current governance documents and `repository-owner-map.json` are valid and current;
- package version and `AIQT_SCHEMA_VERSION` are read from live `main`, not assumed from this document;
- M40 release-governance owners still exist and are verified against source;
- M43 completed documentation exists under `docs/milestones/completed/m43/`;
- working tree is clean;
- no `.aiqt/` self-management state exists in the AIQT repository.

If a material baseline mismatch exists, stop before WU44-01 and reconcile it.

### 1.2 Documentation lifecycle transition

At M44 start:

1. keep M42 and M43 as the two hot completed milestones;
2. archive M41 from `docs/milestones/completed/m41/` to `docs/archive/milestones/m41/` if still present;
3. repair only tracked references made stale by that move;
4. place this specification at:

```text
docs/milestones/active/m44/build-spec.md
```

At closure:

```text
docs/milestones/completed/m44/
├── build-spec.md
└── closure-report.md
```

No permanent WU prompt/log documents are created.

### 1.3 Branch

After entry verification:

```text
milestone/m44-historical-release-reconstruction
```

Do not implement directly on `main`.

---

## 2. Product Boundary

M44 is a **product capability for AIQT-managed projects**.

It is not authorization to use AIQT to manage or reconstruct the AIQT CLI repository itself.

During M44:

```text
Implement historical reconstruction in the AIQT product repository        ✓
Dogfood against disposable/non-AIQT repositories                          ✓
Use historical AIQT patterns as requirements/fixtures when non-canonical  ✓
Initialize the AIQT repository with .aiqt/                                ✗
Run M44 against AIQT as a managed project                                 ✗
Create/publish missing AIQT GitHub Releases automatically                 ✗
```

A future decision may separately authorize using the completed capability against AIQT's own historical release record. That decision is outside M44.

---

## 3. Problem to Solve

M40 governs a release when an operator can already identify the intended candidate and current evidence.

Existing projects may instead contain historical states such as:

```text
Git version tag exists
+ historical commit exists
+ package version can be recovered
+ milestone provenance may exist
+ CI/release metadata may be partial
+ GitHub Release may be missing
```

The current release subsystem must not infer a complete release from that state.

M44 must answer, deterministically:

1. What historical release targets exist?
2. Does the requested target already have an existing release?
3. What repository-local evidence can be proven for that target?
4. What externally verifiable evidence is available?
5. Which evidence is verified, reconstructed, partial, missing, conflicting, or not applicable?
6. Is there enough evidence to construct an M40-compatible release candidate?
7. What remains unknown and what operator action is needed next?
8. Can the existing M40 release-governance flow assess the reconstructed candidate without special-case divergence?

---

## 4. Scope

M44 includes:

- deterministic historical release-target discovery from bounded Git/project evidence;
- release-version/tag/commit/package provenance reconstruction;
- milestone and closure provenance reconstruction where evidence exists;
- base-release determination where unambiguous;
- evidence-quality classification using the existing M40 evidence-honesty model;
- existing-release/draft detection where the existing bounded GitHub integration supports read-only lookup;
- explicit handling when GitHub/CI evidence cannot be externally verified;
- conversion of a reconstructable historical target into the existing M40 release-candidate/provenance model;
- deterministic retrospective release-note content that is visibly marked as reconstructed;
- a cohesive CLI surface under the existing `release` family;
- human/JSON parity under the machine-facing contract;
- controlled disposable/non-AIQT dogfood.

### 4.1 Expected public surface

Subject to live command-registration conventions, prefer:

```text
aiqt release history
aiqt release history --json

aiqt release reconstruct <release-tag>
aiqt release reconstruct <release-tag> --json
```

The exact option shape may be adjusted in WU44-01 if live M40 command/service conventions make a more compatible surface clearly preferable.

The semantic requirements are stable:

- `release history` is read-only inventory/discovery;
- `release reconstruct <tag>` is explicit-target, read-only reconstruction and assessment;
- reconstruction must expose an M40-compatible candidate when evidence permits;
- reconstruction must not publish, draft, tag, merge, deploy, or rewrite history.

M44 must not create unrelated top-level commands.

---

## 5. Out of Scope

M44 must not implement:

- automatic GitHub Release publication;
- automatic GitHub Release draft creation as a side effect of reconstruction;
- automatic semantic-version tag creation;
- tag movement, deletion, rewriting, or normalization by mutation;
- Git history rewrite, rebase, reset, or force-push;
- package version bumping for the historical target;
- retroactive mutation of historical canonical `.aiqt/` state;
- fabricated CI, approval, security, closure, milestone, or release evidence;
- generic remote Git/GitHub exploration;
- generic network/provider clients;
- new release-risk scoring independent from M40;
- new approval/waiver authority independent from M40;
- automatic release publication based only on a low risk score;
- background scheduling (M45);
- portfolio/multi-repository governance (M46);
- controlled PR integration (M47);
- AIQT self-management.

---

## 6. Core Reconstruction Model

### 6.1 Historical target is not a release

The following are separate concepts:

```text
HistoricalReleaseTarget
ReconstructionEvidence
ReconstructionAssessment
ReleaseCandidate
ExistingGitHubRelease
GitHubReleaseDraft
PublishedRelease
```

A Git tag is evidence of a historical target. It is not proof that a GitHub Release existed or should exist.

A package version is evidence. It is not publication authorization.

A reconstructed candidate is a candidate for the existing M40 release-governance flow. It is not a publication decision.

### 6.2 HistoricalReleaseTarget

A target should identify, where deterministically available:

```text
repository identity
requested release tag
resolved target commit
normalized package version
package version at target commit
base release/tag where unambiguous
candidate milestone refs where evidenced
target date/commit time as Git metadata only
```

Do not infer milestone membership from title similarity.

Do not infer a release tag from a package version when no corresponding tag exists.

### 6.3 Evidence states

Reuse M40's evidence-honesty vocabulary wherever live source permits:

```text
verified
reconstructed
partial
missing
waived
```

M44 may introduce a conflict/inconsistency finding if the live M40 model does not already provide one, but it must not redefine the meaning of existing M40 evidence states.

Examples:

- tag resolves to an exact local commit: `verified` repository-local evidence;
- package version recovered from `package.json` at the tagged commit: `reconstructed` historical evidence unless an existing owner classifies it more strongly;
- closure report found but milestone tag cannot be matched: `partial`;
- CI run cannot be queried or bound to the candidate commit: `missing`/externally unverifiable, never `verified`;
- tag says `v1.4.0` but package at target says `1.3.2`: explicit conflict/blocker.

`waived` remains a governance action, never an automatic reconstruction result.

### 6.4 Reconstruction status

M44 may expose a derived reconstruction outcome equivalent to:

```text
existing_release
reconstructable
reconstructable_with_warnings
partial
conflicting
insufficient_evidence
```

This is a reconstruction-quality outcome, not release approval authority.

### 6.5 Deterministic identity

For identical repository history and identical bounded external evidence, reconstruction output must be deterministic.

Any reconstruction digest/fingerprint must exclude volatile presentation data and include only the canonical target/evidence inputs necessary to detect material drift.

---

## 7. Evidence Sources and Precedence

M44 must use bounded evidence, not broad repository archaeology.

### 7.1 Repository-local evidence

Potential sources include, where live owners support them:

- semantic-version Git tags;
- milestone/WU tags;
- tag target commit;
- commit ancestry;
- `package.json` at the target commit;
- schema-version file at the target commit where relevant;
- tracked milestone build/closure reports;
- tracked release artifacts generated by existing AIQT release preparation;
- canonical/runlog evidence only when it belongs to the managed project and is available under the current schema;
- existing owner-map-guided paths.

### 7.2 Optional externally verified evidence

Where existing M40 GitHub/CI adapters already support bounded read access, M44 may reuse them for:

- existing GitHub Release lookup;
- existing draft lookup;
- release tag/commit verification;
- candidate-commit CI/check evidence.

Rules:

- reuse existing adapter/auth/config owners;
- no new generic HTTP client;
- no credential discovery;
- no secrets in output;
- unavailable credentials/service access is an explicit evidence gap;
- reconstruction must remain useful with repository-local evidence only;
- remote unavailability never becomes remote success.

### 7.3 Evidence precedence

When evidence disagrees, prefer stronger directly bound evidence over weaker inferred evidence, but do not silently discard the conflict.

Examples:

```text
tag → exact commit                          stronger than filename/title inference
package.json at tagged commit              stronger than current package.json
CI bound to exact candidate SHA            stronger than "CI was green around that time"
existing GitHub Release bound to tag       stronger than missing local release artifact
```

Conflicts remain visible even if a stronger source determines the candidate identity.

---

## 8. Base Release and Milestone Range

Historical reconstruction commonly needs to determine what changed since the previous product release.

Rules:

1. Prefer an explicit M40-compatible base release when supplied or already represented by trusted evidence.
2. Otherwise, identify the nearest prior semantic release tag reachable in ancestry when unambiguous.
3. Do not choose a base solely by semantic-version ordering if Git ancestry disagrees.
4. Divergent branches or multiple equally plausible base tags produce ambiguity rather than arbitrary selection.
5. Milestones between base and target may be included only when their provenance can be bound to commits/tags/closure evidence.
6. Missing milestone documentation does not invalidate Git evidence, but lowers completeness and must be reported.
7. A target may be reconstructable with no milestone metadata if release identity/provenance is otherwise sufficient; do not fabricate milestone records.

---

## 9. M40 Reuse Contract

M44 must not implement a second:

- release candidate model;
- provenance authority;
- readiness engine;
- release risk model;
- approval authority model;
- release note risk logic;
- draft-publication boundary.

The required integration is:

```text
M44 historical evidence collector
        →
M44 reconstruction assessment
        →
existing M40-compatible ReleaseCandidate / ReleaseProvenance
        →
existing M40 readiness
        →
existing M40 risk
        →
existing M40 notes/preparation
```

If live source has moved these owners since M40, use the current owner map and source as authority.

Any incompatible gap between historical reconstruction needs and the existing release candidate contract must be surfaced in WU44-01 before creating parallel contracts.

---

## 10. Retrospective Release Notes

When reconstruction can produce notes, the output must be visibly retrospective.

Near the top, include equivalents of:

```text
Historical reconstruction: YES
Reconstruction quality: <status>
Target tag: <tag>
Target commit: <sha>
Evidence gaps: <count>
Existing GitHub Release: yes | no | unverified
```

Then reuse the existing M40 release-note structure/risk block rather than inventing a second note format.

Historical notes must distinguish:

- delivered capabilities proven by historical evidence;
- inferred/reconstructed facts;
- evidence gaps;
- known incompatibilities/conflicts;
- current risk assessment based on the reconstructed candidate/evidence, where M40 can legitimately assess it.

Do not rewrite history as though the notes had existed at the historical date.

---

## 11. Existing Release and Duplicate Safety

A historical target may already have:

- a published GitHub Release;
- a draft;
- only a version tag;
- no remotely verifiable release state.

Required behavior:

### Published release exists

Report it as existing. Reconstruction may explain/compare evidence but must not propose duplicate publication as the default next action.

### Draft exists

Report the draft identity/status when externally verified. Do not create another draft.

### No release exists and absence is externally verified

A reconstructable candidate may be prepared for later explicit M40 draft/publication workflow.

### Remote state unavailable

Report `unverified`/equivalent. Do not claim the release is absent.

This distinction is mandatory:

```text
release not found after authoritative lookup
!=
release existence could not be verified
```

---

## 12. Read/Write and Side-Effect Boundary

`aiqt release history` and `aiqt release reconstruct` are read-only by default.

They must not:

- mutate canonical state;
- append runlog events merely for inspection;
- create Git tags;
- change package files;
- change Git branches;
- create GitHub drafts/releases;
- invoke deployment;
- invoke M42 remediation;
- trigger controlled execution.

If local generated output is later justified, it must reuse existing M40 `prepare`/export ownership rather than turning reconstruction into a parallel writer.

---

## 13. Version and Schema Expectations

M44 adds public capability, so a package minor increment is expected under current policy unless live `version:check`/governance evidence requires otherwise.

Do not hard-code the target package version in this specification.

No canonical schema change is expected because reconstruction is transient/read-only and should reuse existing release/evidence contracts.

If implementation appears to require persistent historical reconstruction state or an `AIQT_SCHEMA_VERSION` change:

**stop before making that change** and report why the existing M40/transient model cannot satisfy the requirement.

Schema evolution is not owned by `pnpm version:check`.

---

## 14. Work Units

## WU44-01 — Historical Reconstruction Contract, Ownership, and Compatibility

**Implementation risk target:** 12/100
**Objective:** Define the bounded reconstruction contract and verify it can map into the existing M40 release domain without canonical-state duplication.

### Scope

- verify live M40/release owners;
- define `HistoricalReleaseTarget` and reconstruction assessment/output contracts;
- define evidence-source types and reconstruction-quality outcomes;
- define deterministic target/base identity rules;
- define conflict/ambiguity behavior;
- prove reconstruction objects are transient;
- decide exact CLI surface from live conventions;
- add/update owner-map entries only for genuinely new M44 owners.

### Acceptance criteria

- historical target != ReleaseCandidate != published Release is explicit;
- existing M40 release candidate/provenance/risk/authority remain authoritative;
- same input yields same reconstruction identity;
- ambiguous base/tag/milestone evidence fails conservative;
- no canonical state field is introduced;
- no network/write behavior exists in this WU;
- schema remains unchanged unless a hard stop is raised.

### Expected tag

```text
m44-wu01-historical-release-contract-ownership
```

---

## WU44-02 — Bounded Historical Evidence Discovery and Provenance Reconstruction

**Implementation risk target:** 18/100
**Objective:** Reconstruct historical release provenance from bounded repository-local Git/project evidence.

### Scope

- semantic release tag discovery;
- target commit resolution;
- package version at historical commit;
- schema version at historical commit when relevant;
- ancestry-aware base release selection;
- milestone/tag/closure provenance where available;
- deterministic evidence ledger;
- missing/partial/conflicting evidence;
- read-only `release history` inventory.

### Acceptance criteria

- no broad source-code scan is required;
- target package version is read from the historical commit, not current working tree;
- Git ancestry outranks semantic ordering for base selection;
- ambiguous branch history is reported, not guessed;
- missing milestone metadata does not become fabricated metadata;
- inventory is deterministic;
- no Git mutation occurs.

### Expected tag

```text
m44-wu02-historical-evidence-provenance
```

---

## WU44-03 — Reconstruction Engine and M40 Release-Governance Integration

**Implementation risk target:** 20/100
**Objective:** Convert sufficiently evidenced historical targets into existing M40-compatible candidates and reuse the established readiness/risk/notes owners.

### Scope

- `release reconstruct <tag>`;
- reconstruction-quality decision;
- M40 candidate/provenance mapping;
- M40 readiness reuse;
- M40 release risk reuse;
- M40 approval-authority reuse;
- retrospective note generation using existing note owner/layout;
- compact human output + deterministic JSON.

### Acceptance criteria

- no second release-risk implementation;
- no second approval model;
- incomplete evidence remains incomplete;
- retrospective notes visibly identify reconstructed status;
- existing risk/authority boundary remains:
  - `0–24` Green;
  - `25–49` Yellow;
  - `50–74` Orange;
  - `75–100` Red;
  - `<50` automation permitted when other gates pass;
  - `50–74` human approval required;
  - `75–100` human approval + waiver required;
- reconstruction never constitutes approval or publication.

### Expected tag

```text
m44-wu03-reconstruction-m40-integration
```

---

## WU44-04 — Existing-Release Verification and External Evidence Boundary

**Implementation risk target:** 25/100
**Objective:** Reuse bounded existing GitHub/CI read capability to distinguish existing, missing, and externally unverifiable release state without widening network authority.

### Scope

- verify available M40 GitHub adapter/read owners;
- existing published Release lookup;
- existing draft lookup where supported;
- candidate tag/commit remote verification;
- candidate CI evidence lookup where supported;
- unavailable credential/service behavior;
- duplicate-release/draft safety;
- explicit external-verification gaps.

### Acceptance criteria

- no generic HTTP/network client;
- no new publication/write endpoint;
- no secret discovery/logging;
- existing release prevents duplicate-default workflow;
- "not found" and "could not verify" are distinct;
- remote unavailability does not block repository-local reconstruction, but does block claims requiring remote verification;
- external failures use existing result/exit semantics;
- if a new network authority would be required, stop instead of widening scope silently.

### Expected tag

```text
m44-wu04-existing-release-external-evidence
```

---

## WU44-05 — Historical Dogfood, Safety Regression, Closure, and Pre-PR Audit

**Implementation risk target:** 15/100
**Objective:** Prove reconstruction correctness and safety across representative historical repository states and close M44.

### Required dogfood

Use disposable/non-AIQT Git repositories/fixtures. Do not initialize or reconstruct the AIQT repository itself.

Prove at least:

1. version tag + complete local provenance + no existing release -> reconstructable;
2. published release already exists -> existing-release result, no duplicate action;
3. existing draft -> surfaced, no duplicate draft;
4. package version at target matches tag;
5. package version/tag mismatch -> conflict/block;
6. missing closure report -> explicit partial evidence;
7. missing CI evidence -> never presented as verified;
8. external GitHub/CI unavailable -> explicit unverifiable state;
9. ancestry-aware base release selection;
10. semver ordering and ancestry disagree -> ancestry wins or ambiguity blocks;
11. divergent history with ambiguous base -> no arbitrary selection;
12. multi-milestone range preserves only evidenced milestone provenance;
13. pre-AIQT/legacy-style target with limited metadata -> partial/insufficient, not fabricated;
14. same repository state run twice -> deterministic equivalent output;
15. reconstructed candidate flows through M40 risk/readiness without a second decision owner;
16. risk 49/50/74/75 authority boundaries remain unchanged;
17. reconstruction causes zero tag/history/canonical-state mutation;
18. AIQT self-management remains absent;
19. M40–M43 critical release/evidence/safety regression suites remain green.

### Quality gate

- 100% correct classification of seeded historical scenarios;
- zero fabricated `verified` evidence;
- zero duplicate remote release/draft side effects;
- zero Git/history mutation;
- deterministic repeatability;
- no schema change unless separately approved;
- no weakening of M40 release governance;
- no M45/M46/M47 scope pulled forward.

### Closure

Run the current protocol-required focused/impacted validation accumulated across WUs, then authoritative closure validation and pre-PR audit.

When package version changes, include the focused package-version test and both version checks required by repository governance.

Reconcile known environment-specific full-suite failures honestly; do not rerun until lucky.

Create:

```text
docs/milestones/completed/m44/build-spec.md
docs/milestones/completed/m44/closure-report.md
```

### Expected tags

```text
m44-wu05-historical-reconstruction-dogfood-closure
m44-historical-release-reconstruction
```

---

## 15. Cross-Work-Unit Invariants

Every M44 Work Unit must preserve:

1. AIQT does not self-manage its own product repository.
2. Historical reconstruction targets AIQT-managed/disposable external projects.
3. A Git tag is evidence, not a published-release assertion.
4. Missing evidence is never fabricated.
5. Unverifiable external state is never reported as absent/passed/verified.
6. Reconstruction output is deterministic for identical bounded evidence.
7. M40 remains the sole release-candidate/readiness/risk/approval-authority owner.
8. Release risk and implementation risk remain separate contracts.
9. Reconstruction never grants approval or waiver.
10. No automatic Release draft/publication.
11. No Git tag/history mutation.
12. No automatic package/version mutation for the historical target.
13. No new canonical historical-release database.
14. No generic network/GitHub client.
15. Human/JSON substantive parity is preserved.
16. Existing releases/drafts are not duplicated.
17. Package/schema/milestone/release identities remain independent.
18. M45 background scheduling is not started.
19. M46 portfolio governance is not started.
20. M47 controlled PR integration is not started.

---

## 16. Definition of Done

M44 is complete when:

1. AIQT can deterministically inventory bounded historical release targets.
2. AIQT can reconstruct target tag/commit/package provenance from historical Git evidence.
3. Base release selection is ancestry-aware and fail-closed on ambiguity.
4. Historical milestone provenance is included only when evidenced.
5. Evidence quality distinguishes verified/reconstructed/partial/missing and conflict/unverifiable conditions honestly.
6. A sufficiently evidenced target can map into the existing M40 release-candidate/provenance model.
7. Existing M40 readiness, release risk, approval authority, and release-note owners are reused.
8. Retrospective output is visibly marked as reconstructed.
9. Existing GitHub Release/draft state is distinguished from missing and unverifiable state where bounded external lookup is available.
10. Reconstruction is read-only and introduces no release publication path.
11. No Git/history/package/canonical-state mutation is performed by reconstruction.
12. No AIQT self-management occurs.
13. Required dogfood scenarios pass deterministically with zero fabricated verified evidence.
14. Existing M40–M43 critical safety/governance invariants remain intact.
15. Closure validation is honestly reconciled.
16. Documentation/archive lifecycle and WU commit/tag discipline are complete.
17. Branch is ready for PR.
18. No GitHub Release is created automatically.

---

## 17. Closure Report Minimum Content

The M44 closure report should remain concise and include:

- verified live baseline;
- package/schema version outcome;
- M41 archive housekeeping result;
- WU commit/tag/risk table;
- final historical reconstruction contract;
- evidence sources and precedence;
- reconstruction-status model;
- base-release algorithm;
- M40 reuse proof;
- CLI surface;
- external-verification/duplicate-release boundary;
- dogfood scenario results;
- defects found/fixed during M44;
- validation and safety-regression evidence;
- known limitations;
- final milestone risk;
- PR readiness;
- explicit confirmation that no AIQT self-management, Git history mutation, automatic draft, or Release publication occurred.

---

## 18. Key Milestone Decision

M44 is a **historical evidence reconstruction layer over M40**, not a retroactive publishing engine.

Prioritize:

```text
historical immutable evidence
→ deterministic reconstruction
→ honest evidence quality
→ M40-compatible candidate
→ existing M40 governance
→ explicit later publication decision
```

Reject:

```text
tag exists
→ infer complete release
→ manufacture missing provenance
→ create duplicate draft/release
→ rewrite historical tags
→ self-authorize publication
```
