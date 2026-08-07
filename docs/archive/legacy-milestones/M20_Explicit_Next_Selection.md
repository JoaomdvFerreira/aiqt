# M20 — Explicit Ready Work Unit and Branch Selection

**Status:** Implemented (v0.7.0)
**Applies to:** `aiqt next` and `aiqt next --preview`.

## What changed

`aiqt next` gained two optional, mutually exclusive selectors:

```bash
aiqt next --work-unit <id>
aiqt next --milestone <id>
```

Both work with `--preview` and `--json`. Without a selector, `aiqt next`
behaves exactly as before: it selects the first effectively ready work unit
in stored order.

Explicit selection chooses among effectively ready work units. **It does
not bypass dependencies, active execution, or workflow state** — the same
M18 effective-readiness engine (`computeEffectiveReadinessForState`) gates
every selection mode, and the existing `currentWorkUnitId` active-work
guard is checked before any mode (default or explicit) runs.

## Selection architecture

One shared engine, `resolveNextSelection` (`src/workflow/next-work-unit-selector.ts`),
serves default, `--work-unit`, and `--milestone` modes, and is called
identically by `aiqt next` (apply) and `aiqt next --preview`. Preview and
apply are therefore guaranteed to select the same work unit for the same
canonical state — not by convention, but because they call the exact same
function.

Shared CLI-layer plumbing (mutual-exclusivity validation, the active-work
guard, blocked-result construction, candidate reporting) lives in
`src/cli/commands/next-selection-helpers.ts`, used by both
`next.command.ts` and `next-preview.command.ts`.

## Candidate reporting

Additive JSON fields on every `aiqt next`/`aiqt next --preview` result:

```json
{
  "selectionMode": "default",
  "selectedWorkUnitId": "WU100",
  "effectivelyReadyCandidates": [
    { "workUnitId": "WU100", "title": "...", "milestoneId": "M010", "milestoneTitle": "..." },
    { "workUnitId": "WU200", "title": "...", "milestoneId": "M020", "milestoneTitle": "..." }
  ]
}
```

Stale-ready and blocked units are never listed. When more than one
candidate exists, human-mode output appends:

```text
Multiple work units are effectively ready. Default selection: WU100.
Use --work-unit or --milestone to choose another ready branch.
```

## Exit codes

| Condition | Exit code |
|---|---:|
| Selection succeeds (any mode, apply or preview) | `0` |
| Active work unit blocks any mode | `2` |
| Requested work unit/milestone exists but has no executable target | `2` |
| Default mode has no effectively ready unit | `2` |
| Unknown work unit or milestone id | `3` |
| Both selectors supplied | `3` |
| Missing/empty selector value | `3` |

## Compatibility

- No canonical schema change; `AIQT_SCHEMA_VERSION` unchanged.
- Nothing is persisted beyond the existing `currentWorkUnitId`/packet/
  runlog mechanics — no selection intent, candidate list, or priority is
  ever written to `.aiqt/state.json`.
- Default-mode blocked-result issue ids (`NEXT-NO-READY-WORK-UNIT`,
  `NEXT-PREVIEW-NO-READY-WORK-UNIT`) are unchanged from pre-M20 for exact
  backward compatibility; new issue ids (`NEXT-UNKNOWN-WORK-UNIT`,
  `NEXT-UNKNOWN-MILESTONE`, `NEXT-TARGET-NOT-EXECUTABLE`,
  `NEXT-NO-READY-CANDIDATE`, `NEXT-WORK-UNIT-IN-PROGRESS`, and their
  `NEXT-PREVIEW-*` equivalents) apply only to the new explicit-selection
  paths.
