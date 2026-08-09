# AIQT Versioning Policy

**Status:** Implemented (v0.9.0)
**Applies to:** the AIQT CLI repository and its release process.

## Canonical version source

`package.json.version` is the single canonical source of the AIQT product
version. Every other place that reports a version derives from it at
runtime:

- `aiqt --version` reads it via `src/core/constants/package-version.ts`
  (resolved from `package.json` at process start, both under `tsx` in
  development and from the built `dist/index.js`).
- No other file may hard-code an independently maintained version literal.
  `pnpm version:check` (below) fails if one is reintroduced.

This is unrelated to `AIQT_SCHEMA_VERSION`
(`src/core/constants/schema-version.ts`), which versions the persisted
`.aiqt` project-state schema independently of CLI releases and is never
changed by a version-governance milestone.

## Canonical Schema Compatibility Policy

AIQT applies a centralized compatibility gate to every canonical
`project.json` and `state.json` read and write. The gate is implemented in
`src/state/versioning.ts`; command code must not implement private
version rules.

Policy:

- The current `AIQT_SCHEMA_VERSION` is accepted.
- Older canonical versions from `0.1.0` through the current version are
  accepted as compatible; schema validation and command-specific logic
  remain the next gates.
- Versions older than `0.1.0` are treated as pre-canonical or otherwise
  incompatible and are rejected before mutation.
- Any version newer than `AIQT_SCHEMA_VERSION` is rejected before
  mutation, including newer `0.x` versions and future major versions.
- Missing, non-string, or malformed versions are rejected before
  mutation.

This is a narrow hybrid policy. Older compatible state may proceed, while
unsupported future or incompatible state cannot reach a write path.
Compatible unknown top-level sections in `project.json` and `state.json`
are preserved semantically across read-modify-write cycles by the
canonical stores. If a command rewrites a known section, that section is
governed by the current typed schema; unknown nested fields inside known
sections are not preserved unless they are promoted into the schema or
stored as separate top-level compatible sections.

`AIQT_SCHEMA_VERSION` changes when the persisted canonical schema contract
changes in a way older binaries cannot safely read and rewrite, when a
new canonical section is intentionally introduced without unknown-field
preservation support, or when the supported compatibility range changes.
Pure runtime behavior changes, validation fixes, test additions, and
optional in-memory helper fields do not by themselves require a schema
version change.

## SemVer policy

AIQT follows [SemVer 2.0.0](https://semver.org). Given a version
`MAJOR.MINOR.PATCH`:

### Patch increment

Backward-compatible corrections:

- bug fixes;
- validation corrections;
- reliability or performance improvements;
- internal refactors with unchanged public behavior;
- compatible output corrections;
- documentation/tooling corrections shipped as a completed patch.

Example: `0.6.0 → 0.6.1`.

### Minor increment

Backward-compatible new capability:

- new CLI flags or commands;
- new workflow-engine behavior;
- new additive JSON output;
- new compatible schema capability;
- substantial release/tooling capability exposed to contributors.

Example: `0.6.1 → 0.7.0`.

### Major increment

Incompatible changes:

- removed or renamed public commands;
- incompatible CLI option changes;
- incompatible JSON output changes;
- incompatible canonical schema changes;
- changes requiring explicit consumer migration;
- removed supported behavior.

Example: `1.4.0 → 2.0.0`.

### Pre-1.0 policy

AIQT is currently below `1.0.0`. Before `1.0.0`:

- **patch** — backward-compatible fixes;
- **minor** — new backward-compatible functionality;
- the **major** component stays `0` until the product deliberately declares
  a stable `1.0.0`;
- an incompatible change before `1.0.0` must still increment the **minor**
  version (never silently ship as a patch) and must be explicitly labeled
  as breaking in documentation and in the implementation commit/tag
  metadata.

Do not use the ambiguous interpretation that any `0.x` change may break
compatibility silently. "It's pre-1.0" is never a reason to skip a version
increment or to omit a breaking-change label.

## When a version bump is required

A version increment is required whenever a completed branch changes AIQT
product behavior **or its public documentation of that behavior** —
public documentation that defines commands, flags, exit codes, JSON
contracts, or workflow behavior is just as much a public contract as the
source code that implements it, and a documentation-only correction that
changes what users are told to expect requires the same bump a code change
would. `pnpm version:check --base <ref>` enforces this deterministically
via one explicit path allowlist (`src/tooling/relevant-paths.ts`) — a
changed path requires a bump only if it matches:

| Pattern | Matches | Why it's public |
|---|---|---|
| `src/**` | any product source file | implements every CLI command, flag, exit code, JSON contract, schema, and workflow behavior |
| `package.json` | exact file | the canonical version source and published command/dependency surface |
| `pnpm-lock.yaml` | exact file | resolved dependency versions that ship with every release |
| `.github/workflows/**` | CI/release-validation tooling | changes what gets enforced before a release is considered valid |
| `docs/governance/versioning.md` | exact file | the contributor-facing release/version policy itself |
| `README.md` | exact file | the universal public entry point (install/usage/compatibility) — listed even though this repository does not have one yet, so the policy is already correct the moment it's added |

`docs/` is fully tracked (not gitignored) and now holds many files beyond
this policy — product/architecture specs, per-milestone governance docs,
milestone build specs and closure reports, and the archive tree. None of
those are on the relevant-paths allowlist except this file: they are
operational/governance/planning documentation, not the definition of a
public command, flag, exit code, or JSON contract, so a change to any of
them does not by itself require a version bump. `docs/governance/maintainer-recovery.md`
and `docs/governance/test-rationalization-policy.md` in particular are
**deliberately not** on the allowlist for that reason (nor is the
archived `docs/archive/legacy-milestones/m21-coverage-baseline.md`
snapshot, which is historical record rather than live governance). There is no
`docs/cli/`, `docs/commands/`, `docs/reference/`, `docs/workflow/`,
`docs/architecture/`, or `docs/specifications/` tree in the actual
repository structure. **If any such public-documentation directory or
file is created in the future, it must be added to this table and to
`RELEVANT_DIRECTORY_PREFIXES`/`RELEVANT_EXACT_FILES` in
`src/tooling/relevant-paths.ts` explicitly** — classification is never
inferred from a directory merely existing under `docs/`, and it is never
inferred from scanning file content for keywords. `src/tooling/relevant-paths.ts`
itself, not this paragraph's prose, is the live source of truth for the
exact current allowlist — read it directly rather than trusting a
point-in-time file count here.

**Everything else is exempt**, including but not limited to: `tests/**`
(pure test-only changes never require a bump on their own), `coverage/`
and other generated report output, editor configuration, and any file
under `docs/` other than `docs/governance/versioning.md` (internal implementation
notes, archived planning drafts, historical milestone specs, per-milestone
build specs/closure reports — all not on the allowlist, even if one were
force-added). This is a strict allowlist, not a heuristic — a path not
listed above is never classified as relevant, and a new relevant surface
must be added here explicitly rather than inferred from its content or
its location under a broad directory.

If a completed change touches both a relevant and an exempt path, the
change as a whole still requires a bump (the relevant path alone is
sufficient).

## Local consistency mode

```bash
pnpm version:check
```

Validates, without requiring a clean working tree, a remote, a base
branch, a published package, or a GitHub token:

1. `package.json.version` exists and is valid, normalized SemVer;
2. the development CLI (`tsx src/index.ts --version`) matches it;
3. the built CLI (`dist/index.js --version`), when `dist/` exists, matches
   it;
4. no hard-coded version literal has been reintroduced into
   `src/cli/register-commands.ts`;
5. `pnpm-lock.yaml`'s root version metadata matches it, where the lockfile
   format records that field at all (current formats generally do not —
   absence is "not applicable", not a failure).

Exit code `0` on success, `1` on a mismatch, `3` on a structural failure
(e.g. invalid SemVer, so nothing downstream can be checked meaningfully).

## Base-comparison mode

```bash
pnpm version:check -- --base origin/main
pnpm version:check -- --base origin/main --json
```

(`pnpm`'s `--` separator forwards the flags that follow to the underlying
script; this works identically on Windows and Linux since the tool itself
is a plain Node/tsx script with no shell-specific syntax.)

With `--base <ref>`, the tool:

1. resolves `<ref>` to a commit;
2. computes `git merge-base <ref> HEAD` — comparison always uses
   merge-base semantics (equivalent to `git diff <ref>...HEAD`), never a
   literal two-dot diff against the ref's possibly-moving tip, so the
   result is deterministic for a given HEAD commit regardless of what
   else has landed on the base branch since divergence;
3. reads the **base version** from `package.json` at that merge-base
   commit;
4. reads the **current version** from `package.json` in the working tree
   (not from HEAD — this reflects what a contributor is about to commit;
   CI always runs on a clean checkout, so working tree and HEAD coincide
   there);
5. collects changed paths between the merge-base and `HEAD`, classifies
   them, and determines whether a bump is required;
6. requires `current >= base` always, and `current != base` whenever a
   relevant change was detected.

An apparent minimum increment level (`patch`/`minor`/`major`) is
calculated and reported for information only. Choosing a larger increment
than the detected minimum is never an error — the tool enforces monotonic
increase and the "some bump occurred" rule, not the exact SemVer level,
since automated breaking-change inference cannot be made reliably.

## Output

Both modes support human-readable text (default) and `--json` (the shape
documented in the M19 build specification: `status`, `mode`, `baseRef`,
`baseVersion`, `currentVersion`, `versionChanged`, `increment`,
`relevantChangesDetected`, `relevantPaths`, `ignoredPaths`, `checks`,
`errors`, `exitCode`). Passing output goes to stdout; failing output goes
to stderr. This is tooling-only output — running `version:check` never
mutates `package.json`, the lockfile, or any `.aiqt/` project state.

## Exit codes

| Condition | Exit code |
|---|---:|
| All checks pass (either mode) | `0` |
| Relevant changes with unchanged version | `1` |
| Runtime/build/lockfile version mismatch | `1` |
| Current version lower than base | `1` |
| Invalid SemVer | `3` |
| Unknown or unresolved base reference | `3` |
| Invalid command arguments | `3` |
| Git comparison cannot be performed safely | `3` |
| Unexpected internal execution failure | `3` |

This is a repository tooling command, not an AIQT workflow command — it
never reuses AIQT's own workflow exit codes (`0`/`2`/`3`/`10`).

## CI

`.github/workflows/validate.yml` runs, on every push to `main` and every
pull request, as a **single** `validate` job: typecheck → lint → build →
test → `pnpm version:check` (local mode) → a **blocking** base-comparison
check. CI never publishes a package, creates a tag or GitHub Release, or
commits/mutates any file; it only reads and reports. There is no
`continue-on-error`, `|| true`, or any other soft-failure pattern on
either comparison step — a policy failure fails the workflow exactly like
a failing test would.

**Change-aware validation.** A `Classify validation profile` step
(`src/tooling/validation-profile.ts`) may reduce the job to a `docs-only`
profile, whose sole effect is skipping the test step. It is fail-closed:
the profile is `docs-only` only when *every* changed path is under
`docs/`, and an unresolvable comparison base, an uncomputable diff, or any
single unrecognised path all yield `full`. Every other step — including
both version-governance comparisons — always runs, so the required check
always resolves and can never be left pending. This is deliberately a
*separate* allowlist from `src/tooling/relevant-paths.ts`: that module
decides whether a version bump is required, this one decides whether the
suite may be skipped, and a path must never become test-skippable as a
side effect of editing the version-governance allowlist.

**Pull requests** compare against the actual
`github.event.pull_request.base.ref`, fetched explicitly before
comparison — never an assumed `origin/main`.

**Direct pushes to `main`** (M19-RC1 correction — this was previously
advisory-only and used the non-authoritative `HEAD~1`) compare against
GitHub's own `github.event.before`, resolved via the tested pure function
`resolveDirectPushBase` (`src/tooling/push-base.ts`) and its CI wrapper
(`src/tooling/resolve-push-base-cli.ts`):

- a non-empty, non-zero `before` that resolves to a known commit →
  **enforced comparison** against it (relevant change with no bump fails
  the job, exactly like a non-compliant PR);
- a missing or all-zero `before` (the SHA GitHub sends for a branch's
  first push) → no previous revision exists, comparison is safely skipped
  and the reason is recorded in the step output; local consistency
  validation still runs regardless;
- a non-empty, non-zero `before` that does **not** resolve (an anomaly,
  e.g. a checkout that doesn't reach it) → the resolution step itself
  fails the job immediately, rather than silently skipping enforcement.

## Milestone branch lifecycle

Future milestones follow this lifecycle:

```
clean main
    |
milestone/<milestone>-<short-name>      (e.g. milestone/m39-agent-execution-efficiency)
    |
Work Unit implementation
    |
focused validation
    |
detailed WU commit + WU tag
    |
next WU (repeat)
    |
milestone closure validation (full suite, typecheck, lint, build)
    |
closure report
    |
milestone tag (m<N>[-suffix]-<slug>), created on the milestone branch
    |
pre-PR audit: run `pnpm pr:ready` (optionally `-- --base <target-branch>`
if the base is not `main`) and confirm it exits 0 before opening the PR.
This is a required step, not an optional one -- it reuses the exact
`runVersionCheck` logic `pnpm version:check` and CI's `version-check` job
both call (local consistency, then comparison against the target
branch), plus tests/unit/package-version.test.ts when a version change is
detected, so it can never drift from what CI actually enforces. It
catches a stale hardcoded version literal or an invalid/missing bump
before CI does -- exactly the round-trip a missing bump on a
non-milestone repository-tooling change (`.github/workflows/**`) cost in
practice. Applies to every PR against this repository, not only
milestone PRs.
    |
Pull Request to main
    |
Validate green on this exact HEAD
    |
human review + approved-for-merge        (only valid once Validate is
    |                                     already green for this HEAD;
    |                                     automation merges via a merge
    |                                     commit, never squash or rebase --
    |                                     this preserves every existing WU
    |                                     commit/tag's provenance verbatim)
post-merge main CI green
    |
[optional, separate] explicit release decision -- see "GitHub Release
governance" below. A milestone merging to main does not by itself create
a release; M40 shipped a package bump with no release, M41 shipped one
with an explicit release both in the same PR-driven flow.
    |
[if released] release tag (v<version>) on the merge commit + GitHub Release
```

A milestone branch is created only when starting that milestone's Work Units
— not preemptively. Existing Git history is never rewritten to fit this
lifecycle onto already-closed milestones.

## Pull Request merge gate

Before a milestone (or any) Pull Request is merged, all of the following
must hold:

- CI/check requirements are satisfied (`Validate` green on the PR);
- the PR is mergeable (no conflicts);
- no blocking review issue remains open;
- applicable risk governance is satisfied (see GitHub Release governance
  below for the risk-score approval thresholds that also inform this gate);
- the human maintainer has reviewed the change.

### Merging is human-authorized, mechanically automatic

The repository workflow is:

1. an agent completes the work;
2. `pnpm pr:ready` must pass locally (see the pre-PR audit step in
   "Milestone branch lifecycle" above);
3. the agent opens the Pull Request;
4. GitHub's `Validate` workflow runs to completion on the PR's current
   HEAD;
5. the human maintainer reviews the PR **only once `Validate` has already
   succeeded for that exact HEAD** — the maintainer is always looking at
   an already-validated, final state, never a state CI has not yet
   confirmed;
6. if approved and risk is below Red (score `< 75`), the maintainer
   applies the `approved-for-merge` label to that reviewed HEAD;
7. `.github/workflows/human-approval-merge.yml` immediately re-reads live
   PR/check/risk state and, only if every gate in "Pull Request merge
   gate" above still holds for that exact HEAD, merges using GitHub's
   merge endpoint with `merge_method=merge` and `sha=<exact current
   HEAD>` (milestone PRs never squash/rebase — this preserves every WU
   commit/tag's provenance verbatim);
8. otherwise nothing merges: if the label was applied while `Validate`
   was missing, pending, failed, or belongs to a different SHA than the
   one labeled, that authorization is invalid — the workflow clears the
   label and the maintainer must look again and re-apply it once the
   HEAD is actually green; for every other gate failure (mergeability,
   blocking review, unparseable risk, or Red-band risk) the PR simply
   remains open, unmerged — Red in particular is never eligible for
   automatic merge under this workflow at all, regardless of the label
   or any PR-body text, and instead goes through the manual-merge path
   below.

This automation performs only the mechanical merge action once a human
has authorized the exact, already-validated HEAD they are looking at. It
never holds standing authorization waiting for a future CI result:
`approved-for-merge → CI still pending → CI later turns green → merge`
is explicitly **not** supported — applying the label before `Validate`
has succeeded for that HEAD is not a valid authorization, does not queue
a merge, and does not get reconsidered when CI later finishes. Any new
commit after a valid authorization makes it stale immediately; the
workflow removes the label on the next push, and the exact-HEAD-SHA
merge precondition independently prevents merging past a stale
authorization into a newer, unreviewed revision even in a race. An agent
must never apply `approved-for-merge` to its own PR, and must never treat
conversation text, CI status, or a risk score alone as authorization —
only the maintainer's own label application on an already-green HEAD is
authorization.

A repository previously used an `approved-for-merge` label plus an
automated merge workflow as a fallback approval signal (GitHub does not
permit a native `APPROVED` review from the same identity that opened the
PR). That mechanism was removed on 2026-08-09: it allowed the label to be
applied before CI finished and merged automatically whenever CI later
turned green, so the human's moment of authorization could precede — and
therefore not actually reflect — the exact validated state that
ultimately merged. This model closes that gap structurally rather than
reintroducing the removed one unchanged: authorization is accepted only
when applied to a HEAD whose `Validate` result is already known and
successful, so the human is always looking at the final, validated state
before merge, and automation supplies only the mechanical merge step
afterward — it never waits on or reacts to a future CI result.

**Trust boundary.** `.github/workflows/human-approval-merge.yml` holds
`contents: write` and therefore must never execute code the PR under
evaluation controls. It triggers on `pull_request_target`, not
`pull_request`: GitHub always resolves and runs a `pull_request_target`
workflow's *definition* from the target branch (`main`), never from the
PR's own ref — including a PR that edits this very file — and the
workflow never runs `actions/checkout` or otherwise fetches/executes PR
content; every step is a metadata/API read or write only. One structural
consequence: this workflow cannot make itself, or any change to itself,
authoritative for the PR that introduces it — only the copy already
merged to `main` ever runs. This is why the PR that lands this workflow
requires one manual bootstrap merge, and why any future PR that modifies
this file is still evaluated only under the version of it already on
`main`, never the PR's proposed edit.

**Red-risk band is not automatable.** Risk `75`-`100` is never eligible
for automatic merge — `approved-for-merge` does not authorize it, and no
PR-body text (a `Waiver:` line or otherwise) is treated as evidence of a
human-granted waiver, because PR-body text is authored or editable by
the same agent/PR author the approval exists to check and so cannot
itself satisfy Red-risk governance. The workflow fails closed and
existing human/manual PR governance applies: the maintainer reviews and
merges the PR directly (not through `approved-for-merge`/this
workflow). This is PR-merge governance, not the "GitHub Release
governance" section below — that section separately governs publishing
a GitHub Release after a merge has already happened, and this repository
does not currently define a shared contract between the two. If risk
cannot be parsed deterministically from the PR body at all, the merge
gate fails closed the same way.

## Tag conventions

- **Work Unit tag** — created after each WU's commit, on the milestone
  branch, per [`milestone-protocol.md`](milestone-protocol.md)'s per-WU
  discipline.
- **Milestone tag** — `m<N>[-suffix]-<slug>`, e.g. `m19-version-governance`,
  created on the milestone branch at closure, before the PR is opened.
- **Semantic-version tag** — `v<version>`, e.g. `v0.6.0`, created on `main`'s
  merge commit only if and when a release decision is made (see "GitHub
  Release governance" below) -- not automatically at milestone merge.

WU tags, the milestone tag, the package version, a semantic-version tag,
and a GitHub Release are independent provenance/version domains. A
milestone tag and a semantic-version tag frequently point at **different
commits** -- the milestone tag sits on the milestone branch (before merge),
the semantic-version tag (when one is created at all) sits on `main`'s
merge commit -- and this is expected, not an inconsistency to reconcile.
Do not assume or require that a milestone tag and a release tag resolve
to the same commit. All tags are created manually; CI never creates tags
automatically. See `AGENTS.md` for the per-WU commit/tag discipline
agents must follow.

## GitHub Release governance

Every GitHub Release for a milestone must contain at least these sections:
**Summary**, **Implemented Work Units**, **Major Changes**, **Validation**,
**Known Limitations**, **Compatibility / Migration Notes**, **Provenance**,
and **Risk / Potential Risks**.

The **Risk / Potential Risks** section must include:

- an overall risk score, `0`–`100`, using the four-band scale:
  - `0`–`24` = 🟢 green (low risk)
  - `25`–`49` = 🟡 yellow (elevated-but-bounded risk)
  - `50`–`74` = 🟠 orange (substantial risk)
  - `75`–`100` = 🔴 red (high risk)
- the main contributing risks and their mitigations;
- residual risks after mitigation;
- a recommendation for broader use.

**Approval policy** (the automation boundary sits at `50`, not at a band
edge — yellow is still agent-approvable):

- risk `< 50` (green or yellow) → agent/automation approval is permitted
  once all other release/merge gates pass;
- risk `50`–`74` (orange) → human approval is mandatory before
  publication;
- risk `75`–`100` (red) → human approval **plus an explicit waiver** is
  mandatory before publication.

Boundary examples (illustrative, not exhaustive):

| Score | Band | Approval |
|---|---|---|
| 24 | 🟢 Green | agent/automation permitted |
| 25 | 🟡 Yellow | agent/automation permitted |
| 49 | 🟡 Yellow | agent/automation permitted |
| 50 | 🟠 Orange | human approval required |
| 74 | 🟠 Orange | human approval required |
| 75 | 🔴 Red | human approval + explicit waiver required |
| 100 | 🔴 Red | human approval + explicit waiver required |

**A release must never be published before:**

1. the milestone PR is merged to `main`;
2. post-merge `main` CI is green.

Historical release reconstruction for pre-existing tags without a Release
is out of scope here — see the M44 milestone.

## Contributor checklist

For every completed milestone/change:

1. implement the change;
2. select the appropriate version increment (patch/minor/major, per the
   policy above), if the change is relevant per the allowlist above;
3. update `package.json.version`, if a bump is required;
4. update lockfile version metadata, where applicable;
5. run full validation (`pnpm validate`, i.e. `pnpm typecheck && pnpm lint
   && pnpm build && pnpm test && pnpm version:check`, in that order);
6. run `pnpm version:check -- --base <target-branch>` (comparison mode)
   against the branch you intend to merge into;
7. for a milestone: create the milestone tag on the milestone branch, then
   push the branch and the tag explicitly (never `git push --tags`);
8. run `pnpm pr:ready` and confirm it passes, then open a Pull Request to
   the target branch; once `Validate` is already green on the exact HEAD,
   the human maintainer reviews it and applies `approved-for-merge`, which
   `.github/workflows/human-approval-merge.yml` verifies live and merges
   automatically (with a merge commit, never squash/rebase, for milestone
   PRs);
9. verify post-merge CI is green on the target branch.

Steps 10-11 below are a **separate, explicit decision**, not an automatic
continuation of merging -- a merged milestone/change does not by itself
require or authorize a release:

10. [only if a release is decided] create the semantic-version tag on the
    merge commit and push it explicitly;
11. [only if a release is decided] publish the GitHub Release per "GitHub
    Release governance" below, once post-merge CI is green.

CI enforces that a required version bump is present before merge. CI
never creates the bump itself — that decision and commit always belong to
the contributor.
