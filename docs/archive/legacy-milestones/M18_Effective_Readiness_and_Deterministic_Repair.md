# M18 — Effective Readiness Selection and Deterministic Repair

**Status:** Implemented (v0.5.1)
**Applies to:** AIQT CLI, all commands that select or report on "ready" work.

## Canonical vs. effective readiness

Canonical `ready` is the persisted work unit status in `.aiqt/state.json`. It is
**not sufficient by itself** to determine whether a work unit is actually
executable: a later graph mutation (for example, `aiqt plan --extend`
appending a new blocking dependency onto an existing work unit) can leave a
work unit canonically `ready` while an active `blocks`/`requires` dependency
on it remains unsatisfied. AIQT's append operation never rewrites an
existing work unit's status (that is a required invariant, not a bug), so
this condition can persist until explicitly repaired.

**Effective readiness controls execution selection.** A work unit is
effectively ready only when:

1. its canonical status is `ready`;
2. every active `blocks`/`requires` dependency on it is satisfied;
3. `relates_to` dependencies are ignored entirely for readiness.

A `done` predecessor always satisfies a dependency. A `replanned`
predecessor only satisfies a dependency when its replacement metadata is
structurally valid (non-empty, no self-reference, no duplicates, every
replacement id exists) **and** the specific downstream work unit has a
genuine boundary dependency from one of those valid replacement units.
`status === "replanned"` alone is never treated as satisfying — a malformed
replanned record must never release downstream work prematurely.

A work unit that is canonically `ready` but not effectively ready is
**stale-ready**. Its normalized target status is `planned`.

## One shared engine

All of this is computed by a single function,
`computeEffectiveReadiness`/`computeEffectiveReadinessForState`
(`src/workflow/effective-readiness.ts`), consumed identically by:

- `aiqt next` and `aiqt next --preview` (selection — always identical for
  the same canonical state);
- `aiqt status` (additive `effectivelyReady`/`staleReady` counts);
- `aiqt graph validate` and `aiqt review` (the `stale-readiness` warning,
  via the shared `collectGraphAndPlanQualityWarnings` collector — no
  duplicate findings from independent validators);
- `aiqt graph repair --dry-run`/`--apply` (the deterministic repair
  proposal/apply source).

## `aiqt next` / `aiqt next --preview`

Both commands select the first *effectively* ready work unit in stored
order. A stale-ready work unit is never selected and never receives an
agent packet. When no effectively ready work unit exists — including when
only stale-ready units remain — both commands return the existing
blocked/no-ready result (exit `2`), never a false-positive selection.

## `aiqt status`

`data.workUnitCounts` gained two additive fields alongside the existing
canonical per-status counts:

```json
{
  "workUnitCounts": {
    "ready": 2,
    "planned": 1,
    "effectivelyReady": 1,
    "staleReady": 1
  }
}
```

`ready` remains the canonical stored count (backward compatible).
`effectivelyReady` is the actionable execution count. `staleReady` is the
number of canonical-ready units currently blocked by an unsatisfied
dependency.

## Stale-readiness findings

A stale-ready work unit produces one `stale-readiness` finding (category
`graph`, non-blocking) via `aiqt review` and `aiqt graph validate`,
carrying an additive `staleReadinessDetails` object: the work unit id,
canonical/expected status, unsatisfied dependency ids, blocking predecessor
work unit ids, dependency types, and `repairable: true`. The finding is
non-blocking, but the affected work unit is always excluded from `aiqt
next` regardless.

## `aiqt graph repair --dry-run` / `--apply`

`aiqt graph repair` now requires exactly one of `--dry-run` or `--apply`
(the pre-existing `--dry-run`-only contract is preserved as-is when neither
flag is given).

- `--dry-run` always succeeds (exit `0`), with or without proposed changes.
  For every stale-ready work unit it proposes `ready -> planned`, including
  the unsatisfied dependency ids, blocking predecessor ids, and reason.
  Zero state or runlog writes.
- `--apply` atomically repairs every deterministic stale-readiness proposal
  in one write: candidate-state build, candidate re-validation, atomic
  write, then a single `graph.repaired` runlog event appended only after
  the write succeeds. A persistence failure leaves state and runlog
  completely untouched (no partial repair). Terminal/history statuses
  (`done`, `replanned`, `cancelled`, `in_progress`, `needs_review`) are
  never touched. Calling `--apply` again once the graph is normalized is a
  safe no-op (`mutationPerformed: false`).

## Version

`package.json.version` is the canonical CLI version source (`0.5.1`).
`aiqt --version` reads it at runtime (`src/core/constants/package-version.ts`)
instead of an independently maintained literal. This is unrelated to
`AIQT_SCHEMA_VERSION` (the persisted `.aiqt` project-state schema version,
unchanged by M18).
