# AIQT Milestone 32 Build Specification

## Authoritative Workflow Assessment and Recommendation Engine

**Product:** AIQT CLI
**Milestone:** M32
**Status:** Ready for implementation review
**Risk classification:** High-risk
**Protocol:** Lean Milestone Protocol
**Work Units:** 5
**Primary objective:** Replace fragmented workflow-position and next-action logic with one authoritative assessment engine that all commands and mutation services use consistently.

---

## 1. Source Alignment

M32 follows the formal closure of M31 at:

- Closure commit: `6cdf06cb64fefe73384eab85b1996735ac23ebbe`
- Closure tag: `m31-canonical-state-preview-integrity`
- Package version: `0.18.0`
- Canonical schema version: `0.5.0`

M31 restored canonical-state and preview integrity. M32 addresses the next highest-risk cluster identified by the consolidated audit: workflow guidance, terminal-state routing, planning-readiness feedback, and corruption recovery are owned by multiple modules that can disagree for the same canonical state.

The governing AIQT model remains:

```text
state -> graph -> packet -> checkpoint -> review -> continue
```

The new authoritative decision flow must be:

```text
canonical state
    ↓
integrity assessment
    ↓
workflow position
    ↓
authoritative recommended action
    ↓
command-specific rendering
```

This milestone is development of AIQT itself. Do not use AIQT commands or create `.aiqt/` self-management state inside the AIQT repository.

---

## 2. Milestone Objective

M32 creates one authoritative workflow assessment and recommendation engine.

The milestone must establish that:

1. The same canonical state produces the same substantive next action across all relevant commands.
2. Read-only commands do not implement private workflow precedence.
3. Mutating services do not persist independently invented recommendations.
4. `needs_review` states have an actionable supported recovery path.
5. Planning-readiness failures identify the exact missing condition and an input path that can satisfy it.
6. Dangling current-work pointers are detected consistently and have a supported repair route.
7. Mutating commands consult the same integrity assessment used by review and graph validation before changing state.
8. Project-status computation has one authoritative owner.

M32 does not redesign the CLI result contract, parser-level JSON errors, review rendering, or test-timeout infrastructure.

---

## 3. Accepted Findings in Scope

### High priority

- **HIGH-001:** Five independent implementations compute conflicting next actions.
- **HIGH-002:** `needs_review` is effectively a workflow dead end.
- **HIGH-003:** `aiqt update` flags cannot satisfy or clearly explain the planning-readiness gate.
- **HIGH-010:** A dangling `currentWorkUnitId` has no supported recovery path.

### Supporting findings

- **MED-001:** `state.nextRecommendedCommand` behaves as a stale persisted cache.
- **MED-002:** Status precedence can recommend `aiqt next` while a work unit is already in progress.
- **MED-015:** Mutating commands do not consistently run the same integrity assessment used by review/graph validation.
- **MED-017:** `projectStatus` recomputation is duplicated and has drifted.

---

## 4. Out of Scope

M32 must not implement:

- Human review finding rendering.
- Parser-level JSON error normalization.
- Global `CommandResult` and exit-code consolidation.
- Test-timeout policy.
- README or `SECURITY.md` corrections except where a workflow command contract must be documented.
- Schema compatibility changes already completed in M31.
- Further canonical-write transactionality beyond M31.
- Autonomous execution, background scheduling, model invocation, or unattended code modification.
- Broad command-registration refactors unrelated to workflow assessment.
- New canonical files.
- AIQT self-dogfood for the AIQT repository.

Related findings may be recorded but must not be opportunistically fixed.

---

## 5. Governing Decisions

### 5.1 One authoritative assessment result

Introduce one internal assessment result representing the canonical workflow position.

It should include at least:

```ts
interface WorkflowAssessment {
  integrity: {
    status: "valid" | "warning" | "invalid";
    findings: WorkflowAssessmentFinding[];
  };
  workflowPosition: WorkflowPosition;
  projectStatus: ProjectStatus;
  currentMilestoneId: string | null;
  currentWorkUnitId: string | null;
  developmentComplete: boolean;
  productionReady: boolean | null;
  recommendedCommand: string | null;
  recommendationReason: string;
  canMutate: boolean;
}
```

Exact names may follow repository conventions, but these principles are mandatory:

- Workflow position is computed from canonical state.
- Recommendation precedence is centralized.
- Project status is centralized.
- Integrity findings are available to read-only and mutating consumers.
- Commands may format or contextualize the result but may not override the substantive next action without an explicit, tested exception.

### 5.2 Recommendation precedence

The engine must define and test one priority-ordered decision table covering:

1. Invalid canonical state or broken references.
2. Active in-progress work unit.
3. Work unit in `needs_review`.
4. Incomplete project context.
5. Planning-ready project with no graph.
6. Ready work.
7. Stale or effectively blocked ready work.
8. All development work complete.
9. Development complete but production not ready.
10. Terminal export/reporting state.
11. No actionable command.

The first matching rule wins.

### 5.3 Persisted `nextRecommendedCommand`

M32 must enforce one of these models:

#### Preferred model — Derived value

`nextRecommendedCommand` is computed on read and is not independently authoritative.

#### Compatible cache model

The field may remain persisted for compatibility, but:

- it is always recomputed by the shared engine;
- no service writes a hard-coded value;
- stale values are ignored or refreshed deterministically;
- tests prove parity between persisted and derived values.

Multiple services writing their own recommendation is prohibited.

### 5.4 `needs_review` recovery

A work unit in `needs_review` must route to a supported command.

The engine must distinguish:

- amendable latest checkpoint;
- external or user action required;
- invalid or missing checkpoint context.

Where supported, recommend `aiqt checkpoint amend` or the equivalent canonical recovery command.

Self-referential loops such as `aiqt review -> aiqt review` without a new actionable step are prohibited.

### 5.5 Planning-readiness guidance

Planning readiness must identify the missing conditions, including at least:

- objective;
- target user;
- one implementation-shaping context item;
- any other authoritative readiness requirement.

The recommendation must be capable of satisfying the missing condition. If direct flags cannot satisfy it, guidance must name the supported structured-input path.

### 5.6 Dangling-pointer recovery

A dangling pointer such as `currentWorkUnitId -> missing work unit` must:

- be detected by the authoritative integrity assessment;
- block unsafe mutation;
- appear consistently in status, review, manage, and graph validation;
- have a deterministic repair proposal where safe;
- never be treated as repaired through acknowledgment.

### 5.7 Mutation-gate reuse

Mutating commands that depend on a valid graph or pointer must use the same authoritative integrity assessment before mutation.

---

## 6. Work Units

## WU32-01 — Workflow Decision Inventory and Assessment Contract

**Risk:** 30/100
**Objective:** Establish the authoritative assessment contract and identify every current owner of workflow position, project status, and next-action computation.

### Scope

- Inventory current recommendation and project-status implementations.
- Map every command and service that reads or writes `nextRecommendedCommand`.
- Reproduce precedence differences with fixtures.
- Define the authoritative assessment contract.
- Define the priority-ordered recommendation table.
- Add characterization tests for current contradictions.
- Do not migrate all commands yet.

### Acceptance criteria

- One documented owner map exists.
- Every current recommendation owner is identified.
- Audit contradictions are reproduced in tests.
- New contract exists without broad public behavior changes.
- No schema-version change.
- No runtime dependency added.

### Required validation

- Assessment-contract unit tests.
- Characterization tests for all-done, in-progress, `needs_review`, planning-ready/no graph, stale/effectively blocked work, and dangling pointer.
- Typecheck, lint, build, and official full test command with timeout baseline disclosed.

### Commit and tag

- One Work Unit commit.
- Tag: `m32-wu01-workflow-assessment-contract`

---

## WU32-02 — Central Recommendation Engine and Read-Only Command Migration

**Risk:** 50/100
**Objective:** Implement the shared engine and migrate read-only workflow surfaces.

### Scope

Migrate at least:

- `aiqt status`
- `aiqt start`
- `aiqt continue`
- `aiqt review`
- `aiqt manage`

### Acceptance criteria

- Same state produces the same substantive recommendation across migrated commands.
- Presentation may differ, but command choice and reason align.
- Existing review and manager classifications remain intact.
- No migrated command owns private precedence.
- `projectStatus` comes from one owner.

### Commit and tag

- Tag: `m32-wu02-readonly-recommendation-migration`

---

## WU32-03 — Mutation-Service Migration and Persisted Recommendation Control

**Risk:** 55/100
**Objective:** Remove hard-coded or independently persisted next-action values from mutation services.

### Scope

Audit and migrate update, plan, next, checkpoint, checkpoint amendment, graph repair, and relevant evidence/execution mutation services.

### Acceptance criteria

- No mutation service writes a hard-coded recommendation.
- Persisted recommendation, if retained, comes only from the shared engine.
- Mutation results use post-mutation assessment.
- Status cannot recommend `aiqt next` while work is in progress.
- No stale cache survives a valid transition.

### Commit and tag

- Tag: `m32-wu03-mutation-recommendation-migration`

---

## WU32-04 — Recovery Paths and Integrity-Gated Mutation

**Risk:** 60/100
**Objective:** Correct `needs_review`, planning-readiness, dangling-pointer, and mutation-integrity gaps.

### Scope

- Add actionable `needs_review` routing.
- Make planning-readiness diagnostics exact and satisfiable.
- Add dangling-pointer repair support.
- Ensure invalid state blocks mutation through the authoritative assessment.
- Reuse graph repair mechanisms where possible.

### Acceptance criteria

- `needs_review` routes to a supported recovery command.
- No self-referential review loop remains without an actionable reason.
- Planning-readiness output names the missing condition.
- Recommended input path can satisfy the gate.
- Dangling pointers are detected consistently and safely repairable.
- Structural corruption blocks unsafe mutation.
- Acknowledgment cannot substitute for structural repair.

### Commit and tag

- Tag: `m32-wu04-workflow-recovery-and-integrity-gates`

---

## WU32-05 — Cross-Command Parity and Terminal-State Regression Suite

**Risk:** 35/100
**Objective:** Lock consolidated behavior with invariant tests and remove obsolete duplicate owners.

### Scope

- Add a parity matrix across relevant commands.
- Add terminal-state and corruption-recovery fixtures.
- Remove or deprecate obsolete recommendation helpers.
- Add architecture tests preventing new recommendation owners.
- Update focused documentation.

### Acceptance criteria

- One test matrix covers status, start, continue, review, manage, next, and relevant mutation results.
- No duplicate recommendation precedence remains.
- No duplicate project-status implementation remains without a documented adapter role.
- Architecture tests fail if new direct recommendation logic is introduced.
- Same state cannot produce materially conflicting next actions.

### Commit and tag

- Tag: `m32-wu05-workflow-parity-regression-suite`

---

## 7. Cross-Work-Unit Invariants

Every Work Unit must preserve:

1. No AIQT self-management state in the AIQT repository.
2. Default branch remains `main`.
3. One detailed commit and one tag per completed Work Unit.
4. Commit body includes scope, validation, residual risks, and a 0–100 risk score.
5. No unrelated cleanup.
6. No hidden baseline failures.
7. No schema-version bump unless unavoidable and approved.
8. No runtime dependency unless justified.
9. Temporary fixtures use established test temp directories or locations outside the repository.
10. Final report includes changed files, tests, commands, commit SHA, tag, and clean working-tree evidence.

---

## 8. Milestone Verification Gate

M32 is complete only when:

- One authoritative workflow assessment engine exists.
- One project-status computation exists.
- One recommendation precedence table exists.
- `status`, `start`, `continue`, `review`, and `manage` agree substantively.
- `next` and mutation results align with post-state assessment.
- `needs_review` has an actionable route.
- Planning-readiness failures are exact and satisfiable.
- Dangling pointers have a supported repair route.
- Structural corruption blocks unsafe mutation consistently.
- Persisted recommendation cannot become a stale independent authority.
- Targeted parity tests, typecheck, lint, build, version check, and diff check pass.
- Official full test result is reported honestly.
- All five commits and tags exist.
- Final working tree is clean.

---

## 9. Milestone Closure Report Requirements

The closure report must include:

- Starting and ending commits.
- Package and schema versions.
- Work Unit commit/tag table.
- Authoritative assessment contract.
- Recommendation precedence table.
- Migrated commands and services.
- Persisted recommendation decision.
- `needs_review` recovery behavior.
- Planning-readiness behavior.
- Dangling-pointer repair behavior.
- Integrity-gated mutation behavior.
- Findings closed or reduced.
- Validation results.
- Remaining workflow risks.
- Recommendation on whether CLI result-contract consolidation may begin.
- Explicit statement that autonomous execution remains deferred.

---

## 10. Residual Risks After M32

M32 does not make AIQT ready for unattended autonomous execution by itself.

Separate corrective work remains for:

- Unified human and JSON rendering.
- Parser-level structured errors.
- Exit-code and body-field consistency.
- Deterministic full-suite timeout policy.
- Documentation corrections.
- Autonomous maintenance runner safeguards.
