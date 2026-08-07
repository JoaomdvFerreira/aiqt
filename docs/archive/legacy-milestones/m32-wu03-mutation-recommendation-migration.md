# M32 WU32-03: Mutation Recommendation Migration

WU32-03 migrates persisted workflow recommendations for mutation paths to the shared assessment engine.

The new `applyWorkflowAssessmentToState()` adapter stamps `projectStatus` and `nextRecommendedCommand` from `assessWorkflow()` immediately before state persistence. It is used by project update, initial and incremental planning, next, checkpoint, checkpoint amend, dependency update, issue update, issue promote, review acknowledge, next cancel, and graph repair flows.

Checkpoint transitions now derive their post-mutation recommendation through the assessment contract. `needs_review` work routes to `aiqt checkpoint amend`, ready work routes to `aiqt next`, all development complete routes to `aiqt review --mode release`, and invalid graph state remains routed to validation or repair.

Idempotent no-op mutation responses also use the same assessment adapter for result recommendations, even when they do not rewrite state. Command-specific preview messages and non-workflow execution prompts remain local.

No schema version, package version, runtime dependency, or timeout policy changed.
