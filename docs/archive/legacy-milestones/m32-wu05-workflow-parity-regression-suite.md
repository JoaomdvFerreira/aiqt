# M32 WU32-05: Workflow Parity Regression Suite

WU32-05 locks the consolidated workflow recommendation behavior with parity and architecture regression coverage.

The parity matrix now checks the authoritative assessment, status adapter, start/continue guidance, review, manage, and persisted mutation-cache adapter against the same canonical states. Covered rows include all development done, active in-progress work, concrete `needs_review` checkpoint amendment, planning-ready/no-graph, incomplete context, stale readiness, and dangling-pointer repair.

A public-command integration row verifies `status`, `start`, `continue`, `review`, `manage`, and `next` all recommend `aiqt graph repair --apply` for a dangling `currentWorkUnitId`, and that `aiqt graph repair --apply` clears the pointer deterministically.

The architecture guard asserts that `WORKFLOW_RECOMMENDATION_RULES` remains owned only by `src/workflow/workflow-assessment.ts` and that mutation services do not hard-code persisted `nextRecommendedCommand` values.

The repository owner map now records `assessWorkflow()` and `WORKFLOW_RECOMMENDATION_RULES` as the current authoritative owner. Legacy helpers remain compatibility adapters, not independent precedence owners.

No schema version, package version, runtime dependency, or timeout policy changed.
