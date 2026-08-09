# Closure Report: Human Approval → Automatic Merge

**Branch:** `infra/human-approval-auto-merge`
**Type:** development-process infrastructure (not a milestone; no WU/HF
units, no version bump — `.github/workflows/**` and `docs/governance/
versioning.md` did change, so `pnpm version:check` is expected to require
a bump; see Validation below).

## What changed

- `.github/workflows/human-approval-merge.yml` — new workflow, two jobs
  (`strip-stale-approval`, `evaluate-and-merge`), described in
  `build-spec.md`.
- `docs/governance/versioning.md` — replaced "Merging is a manual human
  action" with "Merging is human-authorized, mechanically automatic";
  added the Red-risk `**Waiver:**` line convention; updated the
  milestone-lifecycle diagram and Contributor checklist step 8.
- `docs/governance/repository-owner-map.json` — `pullRequestGovernance`
  entry updated to the new contract and workflow as a supporting file.
- `docs/governance/maintainer-recovery.md` — PR-integration step 7
  updated to the new merge model.
- `.github/pull_request_template.md` — added the commented-out
  `**Waiver:**` line, active only for Red-band PRs.
- This directory (`build-spec.md`, `closure-report.md`).

No product source (`src/**`) touched; no `.aiqt/` created; no Release,
tag, or merge performed; `approved-for-merge` was not self-applied.

## Governance delta reasoning (why this differs from the removed design)

The 2026-08-09 revert (`d4a3811`) removed a label+auto-merge mechanism
whose flaw was procedural, not technical: approval could be applied
before CI finished, and a later CI-green event triggered the merge
without the human looking again. This build's gate sequence makes that
ordering unreachable rather than merely discouraged — the workflow has
no `workflow_run` trigger and only ever evaluates on the `labeled` event,
so there is no code path where a subsequently-completing `Validate` run
causes a merge. A label applied too early is treated as an invalid
signal and cleared, not queued.

## Required scenarios (spec §"Required scenarios", all 16)

1. **approved current SHA + current Validate green + mergeable →
   eligible** — all gate checks pass, final re-read matches, `gh pr
   merge --match-head-commit` runs. ✅
2. **approval while CI pending → no premature merge** — `validate_conclusion`
   resolves to `pending` (check run `status != completed`); label is
   stripped, `fail_closed`, no merge. ✅
3. **CI later green for approved SHA → eligible** — not automatic by
   design (no `workflow_run` listener); the cleared label requires a
   fresh `labeled` event, i.e. explicit human re-approval, which then
   hits path 1. This is the intended behavior per the revised model, not
   a gap. ✅ (by design)
4. **failed CI → blocked** — `validate_conclusion == "failure"` (or any
   non-`success` value) → label cleared, `fail_closed`. ✅
5. **no approval → blocked** — job only runs `if: action == 'labeled' &&
   label.name == 'approved-for-merge'`; no other event triggers merge
   evaluation. ✅
6. **new commit after approval → stale/block** — `strip-stale-approval`
   fires on `synchronize` when the label is present and removes it. ✅
7. **stale label alone cannot authorize new SHA** — even if label
   removal races or fails, `evaluate-and-merge` only ever runs on a
   `labeled` *event* for that specific application; a `synchronize` event
   does not trigger evaluation, so a stale label sitting on a new SHA is
   never itself treated as a merge signal. ✅
8. **re-approval of new SHA restores eligibility** — a fresh `labeled`
   event re-runs the full gate sequence against the then-current
   `headRefOid`. ✅
9. **draft/wrong-base/conflicted PR → blocked** — `isDraft`, `baseRefName
   != main`, and `mergeable/mergeStateStatus` checks each `fail_closed`
   independently. ✅
10. **blocker/request-changes state → blocked where supported** — latest
    review per author computed via `group_by(.author.login) |
    map(max_by(.submittedAt))`; any `CHANGES_REQUESTED` blocks. ✅
11. **missing/unparseable risk → blocked** — `risk_line` grep must match
    the exact template header shape; empty match → `fail_closed`. ✅
12. **Red risk without required waiver → blocked** — `risk_band == RED`
    requires a non-empty `**Waiver:**` line; missing → `fail_closed`. ✅
13. **HEAD changes during gate/merge → SHA precondition prevents merge**
    — the final re-read compares `recheck_head` to the earlier `head_sha`
    and blocks on mismatch; independently, `--match-head-commit` makes
    GitHub itself reject a merge against a moved HEAD even in a tighter
    race than this workflow's own re-read window. ✅
14. **already merged/closed PR → idempotent no-op** — `state != OPEN` is
    the first check, `fail_closed` immediately. ✅
15. **no PR code executed** — no `actions/checkout`, no dependency
    install; only `gh`/`jq` read/write via the GitHub API. All
    PR-controlled text (body, labels) is consumed exclusively through
    `jq`/`grep` filters, never interpolated into a shell command. ✅
16. **no Release/package/schema/product behavior change** — confirmed
    above (no `src/**`, no version bump beyond what governance-doc/CI
    changes themselves require, no tag, no Release). ✅

## Validation performed

- YAML structural validity: parsed with `js-yaml` (already a transitive
  repo dependency) — clean, no syntax errors.
- Scenario-by-scenario reasoning above, checked directly against the
  committed script logic (not narrative summary) for all 16 required
  scenarios.
- Manual review of workflow permissions (`permissions: {}` at workflow
  level; minimum per-job grants) and confirmed no `actions/checkout`,
  `setup-node`, or `pnpm` step exists anywhere in the file.
- Confirmed no untrusted PR text reaches `eval`/direct shell
  interpolation — every PR-controlled field flows through `jq`/`grep`
  only.
- `pnpm version:check` / `pnpm pr:ready` deferred to immediately before
  `gh pr create`, per `docs/governance/versioning.md`'s pre-PR audit
  step (this workflow file is on the version-check relevant-paths
  allowlist, so a version bump is expected at that point).
- No hosted Actions run of this workflow was exercised (per spec:
  "avoid speculative hosted Actions runs"; this PR does not self-apply
  `approved-for-merge`, so the new path is never exercised against
  itself, matching the precedent set by the original PR #17 review).

## Residual risk

- **Shell/jq gate logic is inline YAML, not unit-tested code** — no
  `actionlint` or `jq` was available in this local environment to
  execute the script directly; correctness rests on the scenario
  reasoning above plus manual review, the same method the original
  (already-reviewed) PR #17 used. First live exercise will be the next
  suitable PR after this one merges (manually) — a tiny docs-only smoke
  PR if no organic candidate is available, per spec.
- **Review-state detection** depends on `reviews[].submittedAt`/`state`
  as returned by `gh pr view --json reviews`; GitHub's PENDING reviews
  are excluded implicitly (only submitted reviews appear in this field),
  which is correct — a review left in draft state should not block or
  count.
- **Risk-header parsing is a fixed regex** against the PR template's
  current shape; if the template's header format changes, this workflow
  and the template must change together (already cross-referenced in
  `repository-owner-map.json`'s `pullRequestGovernance` entry).

Overall risk: **Orange (≈55/100)** — new write authority (`contents:
write`) over the default branch's merge action is a genuine mutation
boundary, but scope is narrow (label-triggered only, no checkout, no
polling, exact-SHA precondition, fail-closed on every ambiguous state),
and the design was reasoned through scenario-by-scenario rather than
merely asserted. Human approval is mandatory before this PR merges per
that same band.

## Bootstrap

This PR requires a manual human merge — the workflow it adds cannot
automate its own landing. After merge, the next suitable PR (or a tiny
docs-only smoke PR if none is available) exercises the live path.

## PR readiness

Branch pushed, not merged. `approved-for-merge` not applied. No Release
created. M46/M47/M48 not started.
