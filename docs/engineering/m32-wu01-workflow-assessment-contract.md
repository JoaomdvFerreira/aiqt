# M32 WU32-01: Workflow Assessment Contract

WU32-01 establishes `src/workflow/workflow-assessment.ts` as the intended authoritative workflow assessment owner. It does not migrate public commands yet; legacy command behavior is characterized in tests.

## Owner Inventory

| Concern | Current owner(s) | WU32-01 decision |
| --- | --- | --- |
| Workflow position | `next-action.ts`, `review-next-command.ts`, `guidance-rules.ts`, `manage-service.ts` | Future owner: `assessWorkflow()` |
| Project status | checkpoint, amend, plan/update services | Future derivation: `deriveAssessmentProjectStatus()` |
| Next recommended command | status/review/start/continue/manage/update/checkpoint/plan-extension paths | Future owner: `WORKFLOW_RECOMMENDATION_RULES` |
| Integrity assessment | review rules and graph validation | `assessWorkflow()` exposes integrity status/findings, reusing the same boundary concept |
| Planning readiness | `planning-readiness.ts` | Reused; assessment adds missing-condition projection |
| Effective readiness | `effective-readiness.ts` | Reused directly; canonical ready is not enough |
| Terminal classification | `manage-service.ts` | Remains current release/production owner until later WU32 migration |

## Precedence Contract

Priority is: invalid state/broken refs; active in-progress; needs_review; incomplete context; planning-ready/no graph; ready work; stale/effectively blocked ready work; all development complete; development complete but production not ready; terminal export/reporting; no actionable command.

## Characterized Contradictions

Tests pin disagreements for all-done, in-progress command families, needs_review looping, planning-ready/no graph direct-vs-prompt planning, stale ready work, and dangling `currentWorkUnitId`. Incomplete context is characterized as currently consistent.

No schemas, versions, runtime dependencies, timeout settings, or command behavior were changed.
