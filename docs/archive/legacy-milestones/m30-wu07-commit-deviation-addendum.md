# M30 Closure Addendum — WU30-07 Commit-Count Deviation

Records one accepted governance deviation in the closed M30 milestone: WU30-07
was delivered as two commits instead of the protocol's one-commit-per-Work-Unit
rule. Not a code or architecture deviation — no schema, behavior, or risk
model changed as a result.

```yaml
accepted_deviation:
  work_unit: WU30-07
  required_commits: 1
  actual_commits: 2
  commits:
    - c07e0ef  # Gate K Dogfood, Hardening, and Closure
    - 81ec79c  # package version bump (0.17.1 -> 0.18.0)
  reason: implementation closure and version bump were separated
  production_risk: none
  history_rewrite_required: false
  tags_move_required: false
```

## Rationale

`pnpm version:check --base v0.17.1 --json` must be run against the fully
implemented WU30-07 diff to determine both whether a bump is required and, if
so, its exact increment (per the milestone's own instruction to run the tool
before choosing a version). That check can only be run correctly once the
dogfood test, hardening tests, and all other WU30-07 content already exist in
the tree — so the version bump is necessarily a distinct, later change from
the implementation it is measuring. Combining them into one commit would mean
either running the version bump on an incomplete diff (risking a wrong
increment) or hand-waving the check's own "run before deciding" requirement.

Both commits carry the same WU30-07 tag (`m30-wu07-final-validation`, applied
to the second/final commit) and the same milestone risk accounting; no
functional content is split across them in a way that leaves either commit in
an inconsistent state on its own. No tags were moved to accommodate this
deviation, and no history rewrite was performed or is required.
