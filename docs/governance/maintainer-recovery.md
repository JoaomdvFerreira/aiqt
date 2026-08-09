# AIQT Maintainer Recovery and Release Runbook

**Status:** Implemented (M21-WU09). Exercised through a real clean-clone
smoke test (see "Smoke-test evidence" below) rather than written and left
unverified.

## 1. Clean installation from a fresh clone

```bash
git clone <repo-url> aiqt-clean
cd aiqt-clean
corepack enable
corepack prepare pnpm@7.33.5 --activate   # matches package.json's packageManager and pnpm-lock.yaml's lockfileVersion 5.4
pnpm install --frozen-lockfile
```

If `pnpm install --frozen-lockfile` fails immediately with a lockfile
compatibility error, check that the active pnpm major version is 7 (`pnpm
--version`) -- a pnpm 8/9/10/11 install can silently rewrite
`pnpm-lock.yaml` to an incompatible format (this happened once during
M19-RC1; see `docs/governance/versioning.md`). If that happens, `git checkout --
pnpm-lock.yaml` to discard the rewrite and re-run with the correct pnpm
version.

## 2. Supported Node/pnpm setup

- **Node.js:** `>=24.0.0` (`package.json` `engines.node`). Node 24 (Active
  LTS, through 2028-04-30) is the sole official runtime, per the Technical
  Architecture Specification. Node 22 (Maintenance LTS) was supported
  through the M21-M34 era but is no longer part of CI's job matrix --
  `.github/workflows/validate.yml` now runs a single Node 24 job, not a
  Node 22/24 matrix. Node 20 reached end of security support on
  2026-04-30 and is unsupported.
- **pnpm:** exactly `7.33.5` (`package.json` `packageManager`), matching
  CI's `pnpm/action-setup` pin and `pnpm-lock.yaml`'s `lockfileVersion:
  5.4` format.

## 3. Build / test / coverage commands

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm build       # tsc (emits dist/)
pnpm test        # vitest run
pnpm coverage    # vitest run --coverage; diagnostic only, see docs/archive/legacy-milestones/m21-coverage-baseline.md
pnpm version:check                        # local consistency
pnpm version:check -- --base <ref> --json # comparison mode
pnpm validate    # typecheck && lint && build && test && version:check, in sequence (build runs before test so tests/integration/built-binary-smoke.test.ts has a real dist/index.js)
```

If `pnpm run <script>` (or `pnpm validate`) fails in a sandboxed/restricted
environment with an install-hook or store error unrelated to the actual
command, fall back to direct invocation, which every AIQT milestone since
M19-RC1 has used successfully in exactly that situation:

```bash
node_modules/.bin/tsc --noEmit
node_modules/.bin/eslint .
node_modules/.bin/tsc
node_modules/.bin/vitest run
node_modules/.bin/vitest run --coverage
node_modules/.bin/tsx src/tooling/version-check-cli.ts
```

## 4. Canonical-state backup and validation

AIQT's own canonical state (when a project has been initialized with `aiqt
init`) lives entirely under `.aiqt/`: `project.json`, `state.json`,
`runlog.jsonl`, and the `exports/` directory. To back up a project's
state, copy `.aiqt/` as-is -- it is plain JSON/JSONL, no database, no
external service dependency.

To validate a project's canonical state is well-formed:

```bash
aiqt status --json    # fails loudly (exit 3) on structurally invalid state.json/project.json
aiqt graph validate --json
```

This repository itself (`aiqt`'s own source tree) has no `.aiqt/` project
-- it is the tool, not a project managed by the tool. There is nothing to
back up here beyond ordinary Git history.

## 5. Tag/version verification

```bash
node -p "require('./package.json').version"
git tag -l | grep -E "^(m[0-9]+|v[0-9])"
git log --oneline -1 v<expected-version>
git log --oneline -1 m<N>-<slug>
```

A milestone tag and a semantic-version tag are independent provenance
domains and are not expected to resolve to the same commit -- the
milestone tag sits on the milestone branch at closure, while a
semantic-version tag (created only when a release is explicitly decided)
sits on `main`'s merge commit. See `docs/governance/versioning.md`'s "Tag
conventions" for the current model; this replaces an earlier (M20-era)
assumption that the two always matched, which real M40/M41/M42 practice
no longer holds (each milestone's `m<N>-...` tag and its corresponding
`v<version>` tag resolve to different commits).

## 6. Failed atomic-write recovery expectations

Every canonical write goes through `atomicWriteFileSync`
(`src/core/filesystem/atomic-write.ts`, hardened in M21-WU07): write to a
same-directory, exclusively-created (`wx`), UUID-named temp file, `fsync`,
`rename` over the target. On any failure at any step, the temp file is
removed and the pre-existing target (if any) is left untouched -- there is
no canonical-state recovery procedure needed beyond "the write either
fully happened or it didn't," because partial writes are structurally
impossible by construction. If a `.{uuid}.tmp` file is ever found orphaned
in `.aiqt/` (e.g. after a hard process kill mid-`fsync`, before the
`rename`), it is always safe to delete -- the target it was headed for was
never modified.

## 7. CI and branch-protection status

See `GOVERNANCE.md` for the full, current, evidence-backed decision.
Summary: CI (`.github/workflows/validate.yml`) runs on every push to
`main` and every pull request, on a single Node 24 job (no Node 22/24
matrix -- Node 22 was retired from CI after the M21-M34 era), and fails
visibly on any check failure -- but it is **advisory, not platform-
enforced**, because branch protection is unavailable on this private
repository's current GitHub plan (confirmed via API: 403 on the
protection endpoint, `protected: false`). Compensating controls (solo
maintainer, no force-push, always validate locally before push) are
documented in `GOVERNANCE.md`.

## 8. Milestone closure, PR integration, and optional release

Extends `docs/governance/versioning.md`'s contributor checklist and
milestone branch lifecycle -- three distinct processes, not one linear
sequence:

**Milestone closure** (on the milestone branch):

1. implement the milestone's Work Units, each with its own commit and WU
   tag;
2. select and apply the correct version increment, if the milestone's
   changes are relevant per `docs/governance/versioning.md`'s allowlist;
3. run the full local validation suite (`pnpm validate` or the direct
   fallback above);
4. optionally run `pnpm coverage` as a diagnostic signal -- it is not a
   pass/fail gate and there is no maintained numeric baseline to compare
   against (see `docs/archive/legacy-milestones/m21-coverage-baseline.md`
   for the historical M21 snapshot);
5. write the closure report; create the milestone tag
   (`m<N>[-suffix]-<slug>`) on the milestone branch.

**PR integration** (merging into `main`):

6. run `pnpm pr:ready` and confirm it passes; push the milestone branch and
   its tag explicitly (never `git push --tags`); open a Pull Request to
   `main`;
7. the human maintainer merges manually once CI is green and the change is
   approved, using a merge commit (never squash/rebase, to preserve WU
   commit/tag provenance);
8. verify the real post-merge CI run via `gh run view` -- do not consider
   the milestone closed on local validation alone.

**Optional product release** (a separate, explicit decision -- not
automatic on merge; see `docs/governance/versioning.md`'s "GitHub Release
governance"):

9. if and only if a release is decided, create the semantic-version tag
   (`v<version>`) on `main`'s merge commit and push it explicitly, then
   publish the GitHub Release once post-merge CI is green. The milestone
   tag and the semantic-version tag are independent and frequently point
   at different commits -- do not expect or require them to match.

10. update this runbook and `docs/governance/versioning.md` if the release
    process itself changed.

## 9. Rollback to the previous milestone tag

Tags are never moved, deleted, or force-pushed. To roll back a bad
release:

```bash
git checkout main
git revert --no-edit <bad-merge-commit>   # preferred: preserves history
# or, only if the bad commit was never pushed/shared:
git reset --hard <previous-milestone-tag>
```

A rollback is itself a new commit (via `revert`) or an explicitly
communicated, pre-agreed local-only reset -- it never rewrites or deletes
an already-pushed tag or commit.

## 10. Dependency-update review

`.github/dependabot.yml` (M21-WU04) opens weekly, capped, grouped update
pull requests for the npm ecosystem and GitHub Actions. None are
auto-merged. Review each PR like any other change: CI must pass, and a
version bump is required if the update touches a relevant path
(`package.json`, `pnpm-lock.yaml`) per `docs/governance/versioning.md`'s policy.

**The npm ecosystem entry has `open-pull-requests-limit: 0`** (set
2026-07-20, supply-chain maintenance). This is a deliberate response to a
confirmed external `dependabot-core` limitation, not a monitoring
reduction of detection -- see `GOVERNANCE.md`'s "Lockfile-parsing
limitation" record for the full evidence trail (job logs, a byte-for-byte
lockfile regeneration proof, and the matching unresolved
`dependabot-core` issue #7584). In short: `dependabot-core`'s
`npm_and_yarn` updater cannot parse this repository's
`pnpm-lock.yaml` (`lockfileVersion: 5.4`) even though the lockfile itself
is fully valid for the exact approved `pnpm@7.33.5`. Vulnerability alert
*detection* is unaffected; only automated PR creation for npm/pnpm is
blocked. Do not remove this limit without first confirming
`dependabot-core` has added `lockfileVersion: 5.4` support, or without a
separately approved pnpm-version migration.

The `github-actions` ecosystem entry is unaffected and remains fully
functional (weekly Actions-version update PRs).

**Snapshot (resolved 2026-07-20, combined maintenance PR merged):** the
three GitHub Actions bumps Dependabot originally opened separately
(`actions/checkout` 4->7, `pnpm/action-setup` 4->6, `actions/setup-node`
4->7) were reviewed for compatibility (release notes checked for each;
no breaking changes affecting this repository's usage), combined into one
maintenance branch, validated, merged after real CI passed, and the
original three Dependabot PRs closed as superseded. `gh pr list` and
`gh run list --workflow=validate.yml` are the live source of truth for
current state, not this paragraph.

## 11. Owner actions still required outside this repository

Confirmed via live GitHub API evidence (2026-07-20) rather than assumed:

- **Private vulnerability reporting:** confirmed **unavailable** on this
  plan/visibility (`GET`/`PUT .../private-vulnerability-reporting` both
  -> 404, including a real enable attempt). See `SECURITY.md` and
  `GOVERNANCE.md`'s "Vulnerability reporting decision" for the current,
  honest state -- there is no working private *reporting* channel for
  external researchers today, though automated detection works (below).
- **Vulnerability alerts / dependency graph / Dependabot security
  updates:** confirmed **enabled** (re-verified 2026-07-20, a change from
  earlier the same day) and already surfacing 6 real alerts in
  `vitest`/`vite`/`esbuild` (devDependencies). Review these periodically
  via `gh api repos/{owner}/aiqt/dependabot/alerts` or the repository's
  Security tab -- they cannot be auto-fixed by Dependabot for this
  ecosystem (see item 10 above) so any real remediation is manual.
- If/when branch protection becomes a priority, either upgrade the GitHub
  plan or make the repository public (see `GOVERNANCE.md`'s
  `revisit_when` list) and then configure required status checks -- the
  same plan/visibility change also unlocks private vulnerability
  reporting.
- Once any of the above changes, update `SECURITY.md` and `GOVERNANCE.md`
  to reflect the new verified state -- neither document updates itself.

## Smoke-test evidence

This runbook's install/build/test/coverage/version-check sequence (§1-3)
was exercised end-to-end from a clean, isolated temporary copy of this
repository's committed state during M21-WU09/WU10 (see the M21 closure
report for the exact commands run and their results). Steps requiring an
external GitHub account action (owner actions in §11, and the real-CI
verification in §8's step 8) were not and cannot be exercised from a local
clone -- they are explicitly listed, not silently skipped.
