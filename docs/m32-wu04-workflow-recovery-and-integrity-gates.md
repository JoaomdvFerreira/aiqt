# M32 WU32-04: Workflow Recovery and Integrity Gates

WU32-04 closes the recovery and mutation-safety gaps around canonical workflow guidance.

`needs_review` routing now recommends a concrete amendment command when checkpoint context exists, for example `aiqt checkpoint amend --checkpoint C001`. If a `needs_review` work unit has no amendable checkpoint context, the assessment falls back to review inspection instead of emitting a self-referential review loop as the normal recovery path.

Planning-readiness blocks now name the missing conditions and the satisfiable structured-input path. The shared guidance data includes the missing readiness condition identifiers and points to `.aiqt/inputs/update.json`; `aiqt plan` blocking output names the missing objective, target user, implementation-shaping context, or blocking open-question resolution.

Dangling current workflow pointers are deterministic graph-repair candidates. `aiqt graph repair --dry-run` reports pointer repairs, and `aiqt graph repair --apply` clears dangling `currentWorkUnitId` and `currentMilestoneId` without changing work history. Broader structural errors still block repair apply and require validation/manual repair.

Unsafe mutation entry points now reuse `assessWorkflow()` as an integrity gate before local precondition logic. `aiqt next`, `aiqt checkpoint`, and `aiqt plan` block on invalid workflow integrity and route pointer-only corruption to `aiqt graph repair --apply`.

No schema version, package version, runtime dependency, or timeout policy changed.
