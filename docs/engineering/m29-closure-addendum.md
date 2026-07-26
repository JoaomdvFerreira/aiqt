# M29 Closure Addendum — Accepted Architecture Deviation

Records one accepted deviation from `AIQT_Milestone_29_Build_Specification_v0.2`
discovered during WU29-02 implementation. Not a commit or tag boundary itself.

```yaml
accepted_deviation:
  specification_section: M29 v0.2 §4
  original_contract: CheckpointIssue XOR ProjectIssue routing
  implemented_contract: ProjectIssue-only advisory routing
  reason: checkpoint issue arrays are immutable after checkpoint creation
  controls:
    - deterministic advisory issue key
    - existing M22 ProjectIssue lifecycle
    - no duplicate issue lifecycle
    - checkpoint identity retained in issue key and metadata
    - advisory issues remain non-blocking
  residual_risk: 8/100
  code_change_required: false
  version_or_tag_change_required: false
```

## Rationale

`Checkpoint.issues[]` (`src/schema/checkpoint.schema.ts`) is populated once at
checkpoint creation and never rewritten afterward — `checkpoint-amendment-
service.ts`'s own contract is built entirely around this immutability
(amendments are overlays specifically because the original checkpoint record
is never touched). An M29 advisory finding is discovered strictly after
checkpoint persistence, so it structurally cannot be appended into
`Checkpoint.issues[]` without violating that invariant.

Every M29 finding is instead routed into the existing, mutable M22
`ProjectIssue` collection (`state.issues.projectIssues`) via the unchanged
`resolveOrCreateProjectIssue` (`src/workflow/finding-routing.ts`), the same
path M23-WU06 added for standalone findings with no checkpoint origin. The
spec's CheckpointIssue/ProjectIssue *routing decision* (execution-local vs.
cross-cutting) is preserved conceptually through:

- a deterministic key, `checkpoint:<checkpointId>:advisory:<policyDigest12>:<ruleId>`
  (`mintAdvisoryIssueKey`, `src/workflow/finding-fingerprint.ts`), collision-free
  because `ruleId` is unique within a policy;
- `sourceType: "checkpoint"` and `checkpointRefs`/`affectedWorkUnitIds` on the
  `ProjectIssue` record, retaining full checkpoint identity;
- reuse of the existing M22 `IssueOverride`/`IssuePromotion` lifecycle
  (`src/services/issue-service.ts`) unchanged — no second lifecycle, no new
  severity/status vocabulary;
- `buildAdvisoryWarningsSection` (`src/workflow/checkpoint-advisory-
  visibility.ts`) confirming, and Gate J's Project C confirming empirically,
  that advisory issues never change review's exit code, manage's primary
  recommendation, readiness, or checkpoint completion.

No schema change, no code change, and no version/tag change are required by
this deviation — it was accepted and implemented as part of the already-
closed M29-WU02 commit (`61d5299`), and is recorded here for Gate J review
per the milestone's own closure discipline.

## Disposition

Accepted. Residual risk 8/100, within M29's `mergeResidualRisk <= 12`
ceiling (contributes to hazard M29-R04, "Duplicate or dual-routed issues",
residual 8 as reported in the M29 closure).
