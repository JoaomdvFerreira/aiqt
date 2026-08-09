# Infrastructure: Human Approval → Automatic Merge

**Work type:** Development-process automation (not a product milestone)
**Branch:** `infra/human-approval-auto-merge`
**Status:** implemented, PR-ready; bootstrap merge is manual (see
"Bootstrap limitation" in the closure report)

## Background

An earlier design (`5910165`, PR #17, merged and reverted same day as
`d4a3811`) let a human apply `approved-for-merge` at any time, including
while `Validate` was still pending, and merged automatically whenever CI
later turned green. The revert's stated reason: the human's moment of
authorization did not necessarily reflect the exact validated state that
ultimately got merged. See `docs/governance/versioning.md`'s "Merging is
human-authorized, mechanically automatic" section for the full narrative
and the governance delta this milestone made to it.

This build implements a materially different model — **Human Final-State
Authorization** — that closes that gap structurally rather than
reintroducing the removed design unchanged.

## Model

```
current HEAD
  → authoritative Validate SUCCESS (already true when the human looks)
  → human reviews the current, already-validated state
  → human applies approved-for-merge
  → automation immediately re-verifies every live gate
  → merge exact approved HEAD SHA, merge-commit method
```

`approved-for-merge` is a valid authorization **only** when applied to a
HEAD for which `Validate` has already succeeded. Applying it while
Validate is missing, pending, failed, or belongs to a different SHA is
not authorization — it is cleared immediately and does not queue a
merge. There is no reconsideration when CI later finishes: this
automation never listens for `Validate`'s completion event, so
`approval → CI pending → later CI success → automatic merge` is
structurally impossible, not just discouraged.

Any new commit after a valid authorization makes it stale; the label is
removed on the next push (`synchronize`), and the exact-HEAD-SHA merge
precondition (`gh pr merge --match-head-commit`) independently prevents
merging a newer, unreviewed revision even in a race.

## Mandatory merge gates

Re-read live from the GitHub API immediately before merging:

- PR `OPEN`, not draft;
- base is `main`;
- `approved-for-merge` present on the live PR (not just the event
  payload);
- `Validate`'s most recent check run for the exact current HEAD SHA is
  `completed`/`success`;
- no unresolved `CHANGES_REQUESTED` review (latest review per author);
- `mergeable == MERGEABLE` and `mergeStateStatus == CLEAN`;
- PR body risk header parses deterministically (`## ... Risk: N/100 —
  BAND`) and the score is below Red (`< 75`);
- one final live re-read immediately before merge reconfirms
  head/state/label/mergeability are unchanged from the checks above.

Missing, pending, stale, ambiguous, or conflicting state at any gate
fails closed: the workflow step exits `0` without merging (or, for the
CI-staleness case specifically, clears the invalid label first).

**Risk 75-100 is never eligible for automatic merge**, under any
condition, including `approved-for-merge` being present. No PR-body text
(a `Waiver:` line or otherwise) is treated as evidence of a
human-granted waiver, because that text is authored or editable by the
same agent/PR author the approval exists to check. The workflow fails
closed and existing human/manual PR governance applies — a Red PR
requires a direct manual merge by the maintainer. This is PR-merge
governance, kept separate from GitHub Release publication governance
(`docs/governance/versioning.md`'s "GitHub Release governance" section)
unless a future change explicitly defines a shared contract between the
two; this automation does not attempt to solve Red-risk waiver evidence
in this iteration.

## Implementation

`.github/workflows/human-approval-merge.yml`, two jobs:

- **`strip-stale-approval`** (`pull_request: synchronize`, only when
  `approved-for-merge` is present) — removes the label so a new commit
  can never be merged under an old authorization.
- **`evaluate-and-merge`** (`pull_request: labeled`, only for the
  `approved-for-merge` label) — the gate sequence above, then
  `gh pr merge --merge --match-head-commit <sha>`.

No `workflow_run` trigger, no polling, no reconsideration loop — CI
finishing later than the label never causes a merge.

### Security

- `GITHUB_TOKEN` only (`permissions: {}` at workflow scope, minimum
  per-job grants: `pull-requests: write` to strip a label,
  `contents: write` + `pull-requests: write` + `checks: read` to
  evaluate/merge);
- **trigger is `pull_request_target`, not `pull_request`, deliberately**:
  a `pull_request_target` workflow's *definition* is always resolved from
  the target branch (`main`), never the PR's own ref, which is the
  required trust boundary for a job holding `contents: write` — a PR
  cannot make its own edit to this file (or anything else) authoritative
  for its own evaluation, only the copy already on `main` ever runs;
  `branches: [main]` further scopes it to PRs actually targeting `main`;
- no `actions/checkout`, no `git fetch`/checkout of the PR head, no PR
  code fetched or executed under any trigger;
- no dependency installation (`gh` and `jq` are runner-preinstalled);
- all PR-controlled text (title/body/branch) is read via `gh ... --json`
  and consumed only inside `jq`/`grep` — never interpolated into a shell
  command or `eval`'d;
- no new secrets, no PAT.

### Cost

One job, no checkout/install/build/test, event-driven (label + push
events only) — approximately one billed Actions minute per evaluation,
matching the spec's target.

## Documentation

This file and `closure-report.md` under
`docs/archive/infrastructure/human-approval-auto-merge/`, per the
milestone-protocol documentation-budget rule for infrastructure work
(not a product milestone; `docs/milestones/active/` is not used).

## Bootstrap limitation

This PR must itself be merged manually the first time — the workflow
that would automate its own merge does not exist on `main` until this
PR lands. This is expected and is not weakened by adding any
self-referential exception.
