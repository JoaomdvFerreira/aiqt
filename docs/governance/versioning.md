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

As of this policy revision (M21), `git ls-files docs/` confirms this
repository has three tracked files under `docs/`: `docs/governance/versioning.md`
(this policy — on the relevant-paths allowlist above), plus two files
added in M21 (`docs/coverage-baseline.md`, `docs/maintainer-recovery.md`)
that are **deliberately not** on the allowlist. Both are operational/
governance documentation (install steps, coverage snapshots, release and
recovery procedure) — neither one defines a public command, flag, exit
code, or JSON contract the way this file or `README.md` would, so a
change to either one does not by itself require a version bump. Everything
else in `docs/` remains local-only PDFs and spec drafts, gitignored. There
is no `docs/cli/`, `docs/commands/`, `docs/reference/`, `docs/workflow/`,
`docs/architecture/`, or `docs/specifications/` in the actual repository
structure. **If any such public-documentation directory or file is
created in the future, it must be added to this table and to
`RELEVANT_DIRECTORY_PREFIXES`/`RELEVANT_EXACT_FILES` in
`src/tooling/relevant-paths.ts` explicitly** — classification is never
inferred from a directory merely existing under `docs/`, and it is never
inferred from scanning file content for keywords.

**Everything else is exempt**, including but not limited to: `tests/**`
(pure test-only changes never require a bump on their own), `coverage/`
and other generated report output, editor configuration, and any file
under `docs/` other than `docs/governance/versioning.md` (internal implementation
notes, archived planning drafts, historical milestone specs — all
gitignored, and even if one were force-added, it is still not on the
allowlist). This is a strict allowlist, not a heuristic — a path not
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

`.github/workflows/validate.yml` runs, on every push and pull request:
typecheck → lint → test → build → `pnpm version:check` (local mode) →
a **blocking** base-comparison check. CI never publishes a package,
creates a tag or GitHub Release, or commits/mutates any file; it only
reads and reports. There is no `continue-on-error`, `|| true`, or any
other soft-failure pattern on either comparison step — a policy failure
fails the workflow exactly like a failing test would.

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
release risk assessment
    |
Pull Request to main
    |
merge                                    (prefer a merge commit for the
    |                                     milestone PR if needed to preserve
    |                                     existing WU commit/tag provenance;
    |                                     never rewrite existing history)
post-merge main CI green
    |
release tag (v<version>) + milestone tag
    |
GitHub Release
```

A milestone branch is created only when starting that milestone's Work Units
— not preemptively. Existing Git history is never rewritten to fit this
lifecycle onto already-closed milestones.

## Pull Request human-approval gate

Before a milestone (or any) Pull Request is merged, all of the following
must hold:

- CI/check requirements are satisfied;
- the PR is mergeable (no conflicts);
- no blocking review issue remains open;
- applicable risk governance is satisfied (see GitHub Release governance
  below for the risk-score approval thresholds that also inform this gate);
- explicit human approval exists.

### Machine-readable approval signal

AIQT Pull Requests are currently created using the same GitHub identity as
the human maintainer, so GitHub does not permit a native `APPROVED` review
from that identity on its own PR. While this remains true, the label

```text
approved-for-merge
```

on the Pull Request is the authoritative machine-readable signal that
human approval has been given. It substitutes for a native GitHub review
approval in this operating mode — it does not add an additional, separate
requirement on top of one.

### Ownership of the label

- Only the human maintainer may apply `approved-for-merge`.
- An agent must never add this label to its own PR, under any
  circumstance.
- An agent must never infer approval from conversation text, an earlier
  prompt, CI status, a risk score, or the mere absence of review comments.
  The label itself, read directly from GitHub, is the only valid signal.
- An agent may only *read* the label; applying or removing it as a grant
  of approval is exclusively the maintainer's action.

### Approval applies to the reviewed PR state, not the PR in general

Human approval is granted for the specific PR state that was reviewed. If
source code, tests, documentation, version metadata, generated artifacts,
or any other tracked content changes after `approved-for-merge` was
applied:

- the previous approval is invalid, regardless of how small the change is;
- `approved-for-merge` must be removed before, or as part of, making that
  change (an agent making such a change removes the label itself rather
  than leaving a stale approval in place);
- CI/checks must run again as applicable to the new commit;
- the human must review the updated PR;
- the human must re-apply `approved-for-merge` before merge.

An agent must never merge a PR merely because a stale `approved-for-merge`
label remains present after new commits were pushed following its
removal — the label is re-evaluated per PR state, not treated as a
standing grant.

### Merge gate

Immediately before performing a merge, an agent must verify directly from
GitHub (not from memory of an earlier check in the same conversation)
that:

- the PR is open;
- the target and source branches are the expected ones;
- `approved-for-merge` is present;
- required/current checks are green;
- the PR is mergeable;
- no known blocking review issue remains;
- risk governance permits the merge.

If any of these fails, the agent stops without merging and reports the
specific failing condition.

### Future compatibility

This label-based mechanism is the current fallback governance control,
adopted specifically because PRs share the maintainer's own GitHub
identity. If AIQT later merges PRs under a separate bot/GitHub App
identity, adopts native required reviewers, or adds branch
protection/rulesets, native GitHub review approval may supersede this
label mechanism — but only through a deliberate governance update to this
document, not silently or by assumption.

## Tag conventions

- **Milestone tag** — `m<N>[-suffix]-<slug>`, e.g. `m19-version-governance`.
- **Work Unit tag** — created after each WU's commit, per
  [`milestone-protocol.md`](milestone-protocol.md)'s per-WU discipline.
- **Semantic-version tag** — `v<version>`, e.g. `v0.6.0`.

All are created manually by whoever merges the milestone, after full
validation passes locally; CI never creates tags automatically. See
`AGENTS.md` for the per-WU commit/tag discipline agents must follow.

## GitHub Release governance

Every GitHub Release for a milestone must contain at least these sections:
**Summary**, **Implemented Work Units**, **Major Changes**, **Validation**,
**Known Limitations**, **Compatibility / Migration Notes**, **Provenance**,
and **Risk / Potential Risks**.

The **Risk / Potential Risks** section must include:

- an overall risk score, `0`–`100`:
  - `0`–`24` = green (low risk)
  - `25`–`75` = orange (moderate risk)
  - `76`–`100` = red (high risk)
- the main contributing risks and their mitigations;
- residual risks after mitigation;
- a recommendation for broader use.

**Approval policy:**

- risk `< 50` → agent approval is permitted;
- risk `>= 50` → human review and approval is required before publication.

**A release must never be published before:**

1. the milestone PR is merged to `main`;
2. post-merge `main` CI is green.

Historical release reconstruction for pre-existing tags without a Release
is out of scope here — see the M44 milestone.

## Contributor checklist

For every completed milestone/change:

1. implement the change;
2. select the appropriate version increment (patch/minor/major, per the
   policy above);
3. update `package.json.version`;
4. update lockfile version metadata, where applicable;
5. run full validation (`pnpm typecheck && pnpm lint && pnpm test && pnpm
   build`);
6. run `pnpm version:check` (local mode);
7. run `pnpm version:check -- --base <target-branch>` (comparison mode)
   against the branch you intend to merge into;
8. open a Pull Request to the target branch and merge only after CI is
   green;
9. create the milestone tag;
10. create the semantic-version tag;
11. push the feature branch, the target branch, and both tags explicitly;
12. publish the GitHub Release per the governance above, once post-merge
    CI is green.

CI enforces that a required version bump is present before merge. CI
never creates the bump itself — that decision and commit always belong to
the contributor.
