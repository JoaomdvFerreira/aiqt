# AIQT Versioning Policy

**Status:** Implemented (v0.8.1)
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
| `docs/versioning.md` | exact file | the contributor-facing release/version policy itself |
| `README.md` | exact file | the universal public entry point (install/usage/compatibility) — listed even though this repository does not have one yet, so the policy is already correct the moment it's added |

As of this policy revision (M21), `git ls-files docs/` confirms this
repository has three tracked files under `docs/`: `docs/versioning.md`
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
under `docs/` other than `docs/versioning.md` (internal implementation
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

## Tag conventions

- **Milestone tag** — `m<N>[-suffix]-<slug>`, e.g. `m19-version-governance`.
- **Semantic-version tag** — `v<version>`, e.g. `v0.6.0`.

Both are created manually by whoever merges the milestone, after full
validation passes locally; CI never creates tags automatically.

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
8. merge;
9. create the milestone tag;
10. create the semantic-version tag;
11. push the feature branch, the target branch, and both tags explicitly.

CI enforces that a required version bump is present before merge. CI
never creates the bump itself — that decision and commit always belong to
the contributor.
