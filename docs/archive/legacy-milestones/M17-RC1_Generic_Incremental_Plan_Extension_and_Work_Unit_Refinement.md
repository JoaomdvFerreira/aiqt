# M17-RC1 — Generic Incremental Plan Extension and Work Unit Refinement

**Status:** Build-ready correction specification  
**Applies to:** AIQT CLI after M17  
**Purpose:** Generalize M17 so incremental planning is a reusable workflow-engine capability rather than a consumer-project-specific solution.

---

## 1. Problem

M17 introduced incremental graph mutation through:

```bash
aiqt plan --extend \
  --replace-placeholder <work-unit-id> \
  --from-file <file>
```

The implementation is structurally sound, but its public contract is too narrow:

- it requires a target work unit for every extension;
- it models refinement as “placeholder replacement”;
- it does not support append-only graph extension;
- the test suite contains consumer-project-specific naming;
- `replanned` readiness semantics need stronger structural invariants.

The project that exposed the limitation is only a dogfood scenario. No AIQT runtime behavior, schema, fixture, test, command, or documentation may depend on that project’s domain or roadmap conventions.

---

## 2. Objective

Provide two generic operations over an existing non-empty work graph:

1. **Append** — add milestones, work units, and dependencies without replacing existing work.
2. **Refine** — replace one eligible future work unit with a more detailed subgraph while preserving history and boundary dependencies.

The implementation must preserve M17’s guarantees:

- candidate-state construction;
- complete graph validation before persistence;
- atomic state mutation;
- preview without mutation;
- deterministic ID allocation;
- append-only runlog behavior;
- backward compatibility with existing AIQT projects.

---

## 3. Required CLI Contract

### 3.1 Append to an existing graph

```bash
aiqt plan --extend --from-file plan-extension.json
```

No target work unit is required.

### 3.2 Refine an existing work unit

```bash
aiqt plan --extend \
  --refine-work-unit WU010 \
  --from-file work-unit-refinement.json
```

### 3.3 Preview

```bash
aiqt plan --extend \
  --refine-work-unit WU010 \
  --from-file work-unit-refinement.json \
  --preview
```

### 3.4 Backward-compatible alias

The M17 option remains temporarily supported:

```bash
--replace-placeholder <id>
```

It must behave as a deprecated alias for:

```bash
--refine-work-unit <id>
```

When used, return a non-blocking deprecation warning. Do not remove or silently change its behavior in this correction.

---

## 4. Operation Selection

The CLI determines the operation as follows:

| Invocation | Operation |
|---|---|
| `--extend` without a target | `append` |
| `--extend --refine-work-unit <id>` | `refine` |
| `--extend --replace-placeholder <id>` | `refine` through deprecated alias |
| Both target options supplied | Invalid input |
| Target option supplied without `--extend` | Invalid input |

The structured result should preserve:

```json
{
  "action": "plan",
  "data": {
    "operation": "append"
  }
}
```

or:

```json
{
  "action": "plan",
  "data": {
    "operation": "refine"
  }
}
```

---

## 5. Append Behavior

Append mode may add:

- new milestones;
- new work units under new milestones;
- new work units under existing milestones;
- new dependencies between existing and/or new work units;
- dependency-only changes that add relationships without adding work units.

Append mode must not:

- modify completed work units;
- modify completed milestones;
- remove historical dependencies;
- change the status or scope of existing work units;
- replace or replan an existing work unit;
- introduce duplicate IDs or client keys;
- introduce missing dependency references;
- introduce cycles.

The entire candidate graph must validate before any canonical write occurs.

---

## 6. Refinement Behavior

### 6.1 Eligible target statuses

A work unit may be refined only when its canonical status is:

- `planned`;
- `blocked`;
- `ready`.

### 6.2 Ineligible target statuses

Refinement must be rejected for:

- `in_progress`;
- `done`;
- `replanned`;
- any status that represents prior execution or irreversible workflow history.

A blocked-but-valid workflow-position condition returns exit code `2`.

Unknown target IDs or structurally invalid input return exit code `3`.

### 6.3 Result of refinement

The original work unit:

- remains in the canonical graph;
- is changed to `replanned`;
- is no longer selectable by `aiqt next`;
- records `replanReason`;
- records non-empty `replacedByWorkUnitIds`;
- preserves its original title, scope, milestone, and historical dependencies.

The replacement subgraph is added as new canonical milestones, work units, and dependencies.

---

## 7. Boundary Dependency Preservation

Let:

- `T` be the target work unit;
- `E` be the replacement subgraph’s entry work units;
- `X` be the replacement subgraph’s exit work units.

### 7.1 Incoming blocking dependencies

For every existing dependency:

```text
P → T
```

of type:

- `blocks`;
- `requires`;

create:

```text
P → E1
P → E2
...
```

Preserve the original dependency type exactly.

### 7.2 Outgoing blocking dependencies

For every existing dependency:

```text
T → S
```

of type:

- `blocks`;
- `requires`;

create:

```text
X1 → S
X2 → S
...
```

Preserve the original dependency type exactly.

### 7.3 Non-blocking relationships

`relates_to`:

- remains non-blocking;
- is not copied automatically;
- does not affect readiness;
- may be added explicitly by the extension payload.

Original dependencies are preserved for audit history and are never deleted by refinement.

---

## 8. Replanned Invariants

A work unit with status `replanned` must not be considered structurally valid based only on its status value.

The following invariants are required:

- `replacedByWorkUnitIds` exists and is non-empty;
- every replacement ID exists in the current graph;
- the target does not reference itself;
- replacement IDs are unique;
- the replacement graph has valid entry and exit boundaries;
- copied `blocks` and `requires` dependencies preserve downstream readiness;
- the complete graph passes schema, dependency, and cycle validation.

A malformed historical `replanned` work unit must not release downstream work prematurely.

`aiqt review` and/or `aiqt graph validate` must report invalid replanned structures.

---

## 9. Genericity Requirement

No production code, schema, command, fixture, test name, example, or documentation may depend on:

- Finanças or personal finance;
- “Corte 0”, “Corte 1”, or numbered consumer releases;
- `WU015` as a hard-coded target;
- banks;
- PDF import;
- Next.js;
- any fixed number of milestones or work units;
- any consumer-project naming convention.

Rename consumer-specific fixtures to generic names such as:

```text
existing-graph-refinement-fixture
progressive-planning-fixture
completed-upstream-refinement-fixture
mixed-boundary-dependency-fixture
```

A real consumer project may be used only as a separate dogfood validation after the generic implementation passes.

---

## 10. Input Model

The implementation may reuse M17’s schema where practical, but the normalized internal operation must be explicit.

### Append example

```json
{
  "operation": "append",
  "milestones": [],
  "workUnits": [],
  "dependencies": []
}
```

### Refine example

```json
{
  "operation": "refine",
  "targetWorkUnitId": "WU010",
  "milestones": [],
  "workUnits": [],
  "dependencies": [],
  "entryWorkUnitClientKeys": [],
  "exitWorkUnitClientKeys": []
}
```

The exact external JSON shape may remain compatible with M17, provided normalization produces these semantics unambiguously.

---

## 11. Exit-Code Contract

Preserve the established taxonomy:

| Condition | Exit code |
|---|---:|
| Valid command blocked by workflow state | `2` |
| Invalid input or invalid canonical structure | `3` |
| Required interactive/domain input missing | `10` |
| Success | `0` |

Required cases:

- plain `aiqt plan` on a non-empty graph: exit `2`, unchanged;
- `--extend` on an empty graph: exit `2`, recommend plain `aiqt plan`;
- unknown refinement target: exit `3`;
- ineligible refinement target: exit `2`;
- both refinement flags supplied: exit `3`;
- target flag without `--extend`: exit `3`;
- malformed extension payload: exit `3`.

---

## 12. Atomicity and Persistence

For both append and refine:

```text
Read canonical state
→ Parse and normalize input
→ Validate operation
→ Allocate deterministic IDs
→ Build complete candidate state
→ Validate schema
→ Validate references
→ Validate replanned invariants
→ Validate cycles and readiness
→ Produce preview or atomic write
→ Append runlog only after successful state write
```

Requirements:

- preview changes neither state nor runlog;
- persistence failure produces zero canonical mutation;
- runlog is written only after state persistence succeeds;
- a retry after failure allocates the expected deterministic IDs;
- existing M17 atomic-write mechanisms must be reused.

---

## 13. Required Tests

### 13.1 Append

- append a new milestone to an existing graph;
- append work units to an existing milestone;
- append work units to a new milestone;
- add dependencies only;
- connect existing work to new work;
- connect new work to existing future work;
- reject duplicate IDs;
- reject duplicate client keys;
- reject missing references;
- reject cycles;
- preview without mutation;
- rollback on persistence failure.

### 13.2 Refinement

- refine `planned`;
- refine `blocked`;
- refine `ready`;
- reject `in_progress`;
- reject `done`;
- reject `replanned`;
- preserve incoming `blocks`;
- preserve incoming `requires`;
- preserve outgoing `blocks`;
- preserve outgoing `requires`;
- do not copy `relates_to`;
- support multiple entry nodes;
- support multiple exit nodes;
- prevent premature downstream readiness;
- preserve original dependencies;
- record replacement metadata.

### 13.3 Replanned validation

- valid replanned structure;
- empty replacement IDs;
- missing replacement ID;
- self-reference;
- duplicate replacement ID;
- malformed boundary rewiring;
- invalid replanned structure reported by review/graph validation;
- legacy valid projects remain compatible.

### 13.4 CLI compatibility

- `--refine-work-unit` works in `plan`, `import plan`, and `prompt plan`;
- `--replace-placeholder` remains functional as a deprecated alias;
- both flags together are rejected;
- existing non-extend behavior is unchanged;
- JSON action remains `plan`;
- operation is `append` or `refine`.

---

## 14. Acceptance Criteria

M17-RC1 is complete when:

1. A non-empty work graph can be extended without targeting a work unit.
2. New milestones, work units, and dependencies can be appended safely.
3. Any eligible future work unit can be refined into a subgraph.
4. Refinement terminology is generic in the primary CLI contract.
5. The M17 placeholder flag remains as a deprecated compatibility alias.
6. Completed and in-progress work cannot be refined.
7. `blocks` and `requires` boundary dependencies are preserved exactly.
8. `relates_to` remains non-blocking.
9. Invalid replanned structures cannot release downstream work.
10. Candidate-state validation occurs before persistence.
11. Preview performs no mutation.
12. Persistence failure performs no partial mutation.
13. Existing AIQT projects remain compatible.
14. The complete regression suite passes.
15. No production or test behavior depends on a consumer project.

---

## 15. Out of Scope

- deleting or rewriting completed workflow history;
- removing the existing `replanned` status;
- automatic replanning by an AI model;
- arbitrary graph deletion;
- splitting an `in_progress` or `done` work unit;
- consumer-project-specific planning logic;
- package publication;
- modification of any consumer repository during implementation.

---

## 16. Build Handoff Rule

Implement this as a correction over M17, preserving its candidate-state engine and atomicity guarantees.

Prefer targeted generalization over a rewrite:

- add append mode;
- introduce generic refinement terminology;
- keep the legacy alias;
- strengthen replanned validation;
- rename consumer-specific fixtures;
- expand tests;
- retain backward compatibility.
