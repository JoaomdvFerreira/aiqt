# AIQT Milestone 32 Closure Report

## Milestone

**Title:** AIQT Milestone 32: Authoritative Workflow Recommendation Consolidation

**Objective:** Consolidate workflow position, project-status derivation, next-command precedence, recovery guidance, and persisted recommendation updates behind one authoritative workflow assessment engine.

**Risk classification:** Corrective workflow-integrity milestone. Final closure risk score: `20/100`.

**Starting commit:** `6cdf06c` (`m31-canonical-state-preview-integrity`)

**Ending commit:** WU32-05 closure commit tagged `m32-wu05-workflow-parity-regression-suite`

**Package version:** `0.18.0`

**Canonical schema version:** `0.5.0`

## Work Units

| Work Unit | Commit | Tag | Scope |
| --- | --- | --- | --- |
| WU32-01 | `395bba99158a0ad2e68db0ed19e1d6d9aa0d4aed` | `m32-wu01-workflow-assessment-contract` | Added `src/workflow/workflow-assessment.ts`, owner inventory, and characterization tests for contradictory recommendation owners. |
| WU32-02 | `e0cae07bda002fbcc0d7b02a98e052954c598745` | `m32-wu02-readonly-recommendation-migration` | Migrated status/start/continue/review/manage and legacy helper adapters to shared assessment for substantive recommendations. |
| WU32-03 | `5e60f92fff870519302074ae4313fb55e21979e8` | `m32-wu03-mutation-recommendation-migration` | Migrated persisted mutation recommendations for update, plan, next, checkpoint, graph repair, issue/dependency changes, and review acknowledgement. |
| WU32-04 | `dc13a000aa52c24e52078d1928d598ebf6994586` | `m32-wu04-workflow-recovery-and-integrity-gates` | Added concrete `needs_review` recovery, exact planning-readiness output, dangling-pointer repair, and assessment-based mutation gates. |
| WU32-05 | closure commit | `m32-wu05-workflow-parity-regression-suite` | Added parity matrix, public command corruption-recovery row, architecture guard, owner-map update, and this closure report. |

## Assessment Contract

The authoritative owner is `assessWorkflow()` in `src/workflow/workflow-assessment.ts`.

It returns integrity status/findings, workflow position, project status, current IDs, development-complete status, production-readiness input, recommended command, recommendation reason/rule id, mutation allowance, and planning-context readiness details.

`WORKFLOW_RECOMMENDATION_RULES` defines the priority table:

1. invalid state or broken references;
2. active in-progress work;
3. `needs_review`;
4. incomplete context;
5. planning-ready/no graph;
6. ready work;
7. stale ready work;
8. all development work complete;
9. development complete but production not ready;
10. terminal export/reporting;
11. no actionable command.

## Decisions

**Persisted recommendation decision:** `nextRecommendedCommand` remains as a compatible cache. It is recomputed by `assessWorkflow()` through `applyWorkflowAssessmentToState()` before mutation persistence and is not an independent authority.

**Project-status decision:** `deriveAssessmentProjectStatus()` is the workflow-status owner used by assessment-stamped mutation state and read-only outputs.

**`needs_review` recovery:** When checkpoint context exists, recommendation is concrete, for example `aiqt checkpoint amend --checkpoint C001`. If no amendable checkpoint context exists, assessment routes to review inspection rather than a self-referential review loop.

**Planning readiness:** Missing conditions are exposed as identifiers and user-facing labels: objective, target user, implementation-shaping context, and blocking open-question resolution. `aiqt plan` points to `aiqt update --from-file <path>` when structured project context is required.

**Dangling-pointer repair:** `aiqt graph repair --dry-run` proposes deterministic clearing of dangling `currentWorkUnitId` and `currentMilestoneId`; `--apply` clears only those pointers and does not alter work history.

**Integrity-gated mutation:** `aiqt next`, `aiqt checkpoint`, and `aiqt plan` use `assessWorkflow()` before unsafe local mutation logic and route pointer-only corruption to `aiqt graph repair --apply`.

**Compatibility adapters:** `computeNextAction()`, `computeReviewNextCommand()`, and `computeGuidance()` remain as compatibility adapters over the assessment engine.

## Findings Closed Or Reduced

- `HIGH-003`: materially reduced by exact, satisfiable planning-readiness guidance.
- `HIGH-010`: closed for dangling current pointers through deterministic graph repair and mutation gates.
- Workflow recommendation owner drift: closed by the assessment owner, parity tests, and architecture guard.
- Terminal routing disagreement: materially reduced by release/production readiness being passed into assessment by read-only owners.
- Persisted recommendation staleness: materially reduced by recomputing mutation cache values from assessment.

## Validation

Focused WU32 validation completed during implementation:

- WU32-01 assessment/characterization tests passed.
- WU32-02 read-only recommendation migration tests passed.
- WU32-03 mutation unit and integration suites passed: 82 unit tests and 152 mutation integration tests across focused files.
- WU32-04 recovery/integrity suites passed: 95 tests across assessment, checkpoint, plan, next, graph repair, and start/continue.
- WU32-05 parity/architecture suites passed: 10 tests across public command parity and source architecture guards.

Standard validation commands passed during WU32:

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm build`
- `corepack pnpm version:check`
- `git diff --check`

Official full-suite result must not be reported as passing. `corepack pnpm test` failed after approximately 164 seconds with timeout-heavy integration failures. The final rerun reported 52 failing tests, all surfaced as Vitest 5000 ms test timeouts in execution, evidence, and workspace-heavy suites. Earlier M32-related assertion expectation failures found during the first full-suite run were corrected and revalidated with focused suites before closure. The remaining full-suite failure class is the known timeout-heavy baseline, not a reported M32 assertion regression.

## Remaining Risks

- Full-suite timeout behavior remains unresolved.
- Older peripheral result-contract and prompt/reporting surfaces still contain command-specific presentation hints by design.
- CLI result-contract consolidation remains separate work.
- Parser-level structured errors and human/JSON output consistency remain separate work.
- Autonomous execution remains deferred.

## Recommendation

Workflow-recommendation consolidation is complete enough for the next corrective milestone to begin. CLI result-contract consolidation may begin next.

Autonomous execution remains deferred.
