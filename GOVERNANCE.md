# AIQT Repository Governance

## Distribution and license decision

```yaml
package_distribution_intent:
  status: proprietary_private
  package_json:
    private: true
    license: "UNLICENSED"
  decided: 2026-07-20 (M21 Gate A, explicit owner decision)
  rationale: >
    Matches current reality: private repository, solo maintainer, no
    public npm publication planned at this time. Not a permanent
    commitment -- revisit if/when public distribution is intended, at
    which point an approved SPDX license and a LICENSE file become
    required (see M21 Build Spec v0.2 §5.2).
```

See `SECURITY.md` for the related vulnerability-reporting policy, decided
in the same Gate A session.

## Branch-protection decision

```yaml
branch_protection_decision:
  status: accepted_unenforced_gap
  evidence:
    - "GET /repos/{owner}/aiqt/branches/main/protection -> HTTP 403: "
    - "'Upgrade to GitHub Pro or make this repository public to enable this feature.'"
    - "GET /repos/{owner}/aiqt/branches/main -> protected: false"
    - "Repository visibility: private (confirmed via gh api)"
    - "Verified via live gh api calls during M21 Gate A, 2026-07-20."
  rationale: >
    Required status checks and branch protection are unavailable on this
    repository's current GitHub plan while it remains private. Upgrading
    the plan or making the repository public are both real options but are
    account/visibility decisions outside the scope of an M21 code change,
    and neither is made automatically by AIQT or by this milestone.
    Accepting the gap now, with truthful documentation and compensating
    controls, is preferable to silently pretending CI is a merge gate it
    is not.
  compensating_controls:
    - "Single maintainer; no third-party push access to this repository."
    - "Established discipline (all milestones to date): never force-push,
       never rewrite published history, never skip CI locally before
       pushing, always run the full validation suite
       (typecheck/lint/test/build/version:check) before every push to
       main."
    - "`.github/workflows/validate.yml` has no `continue-on-error` or
       `|| true` anywhere -- a failing check fails the workflow run
       visibly, even though GitHub does not block the push on it."
    - "`pnpm version:check -- --base <ref>` enforces a version bump on
       every relevant change, evaluated locally before push and again in
       CI, even though neither is a platform-required check."
  revisit_when:
    - "The repository is made public (branch protection becomes free), or"
    - "The GitHub plan is upgraded to one that includes branch protection
       for private repositories, or"
    - "A second contributor with push access is added."
```

## CI status: advisory, not enforced

`.github/workflows/validate.yml` runs on every push to `main` and every
pull request, and fails visibly (no soft-failure pattern anywhere in the
workflow) when typecheck, lint, tests, build, or version governance fail.

**This is not the same as GitHub enforcing it.** With no required status
checks and `protected: false` on `main`, GitHub does not prevent a push or
merge from landing regardless of whether the workflow run is green or red.
The check is advisory: visible, run in good faith, and never bypassed in
practice by the current maintainer discipline above -- but not
structurally guaranteed by the platform. Any documentation, command
output, or commit message that calls CI "enforced" without this caveat is
inaccurate and should be corrected.

## Vulnerability reporting decision

```yaml
vulnerability_reporting_decision:
  status: partially_available_reverified_2026_07_20
  evidence:
    - "GET /repos/{owner}/aiqt/private-vulnerability-reporting -> HTTP 404 (still unavailable; re-verified 2026-07-20, unchanged since Gate A)"
    - "GET /repos/{owner}/aiqt/vulnerability-alerts -> 204 (now ENABLED -- was HTTP 404 'disabled' at Gate A, 2026-07-20 earlier same day)"
    - "GET /repos/{owner}/aiqt/dependabot/alerts -> 6 real open alerts (2 critical, 1 high, 3 medium -- vitest/vite/esbuild devDependencies)"
    - "GET /repos/{owner}/aiqt/automated-security-fixes -> {enabled: true, paused: false}"
    - "GET /repos/{owner}/aiqt/dependency-graph/sbom -> succeeds with real SBOM data"
    - "Verified via live gh api calls, 2026-07-20 (supply-chain maintenance session, same day as Gate A but later)."
  rationale: >
    Vulnerability alerts, the dependency graph, and Dependabot security
    updates are now confirmed ENABLED -- a change from the Gate A snapshot
    taken earlier the same day, most likely GitHub's own asynchronous
    processing catching up rather than any repository-side action taken
    here. Private vulnerability reporting specifically remains the one
    unavailable piece, gated the same way branch protection is (plan/
    visibility). SECURITY.md is updated to reflect this: alerts work and
    are actively finding real issues; only the private *reporting*
    channel for external researchers is still missing.
  revisit_when:
    - "The repository is made public, or"
    - "The GitHub plan is upgraded to one that includes private vulnerability reporting for private repositories."
```

## Dependency and supply-chain monitoring

`.github/dependabot.yml` (added in M21-WU04) requests weekly, capped,
grouped update pull requests for the npm ecosystem and GitHub Actions.
Dependabot does not auto-merge anything; every update PR requires the same
manual review and CI run as any other change.

Dependabot itself is confirmed active (it opened three real GitHub Actions
update PRs on 2026-07-20: `actions/checkout` 4->7, `pnpm/action-setup`
4->6, `actions/setup-node` 4->7). Vulnerability alerts and the dependency
graph are now confirmed **enabled** (see "Vulnerability reporting
decision" above), and have already surfaced 6 real alerts in
`vitest`/`vite`/`esbuild` (devDependencies).

## Lockfile-parsing limitation (npm/pnpm ecosystem)

```yaml
dependabot_pnpm_parsing_limitation:
  status: external_limitation_workaround_applied
  symptom: "GitHub UI: '/pnpm-lock.yaml not parseable'"
  evidence:
    - "Dependabot job log (run for security update on 'vite', 2026-07-20): corepack correctly activates pnpm@7.33.5 per packageManager, then the npm_and_yarn updater subprocess exits 1 with error type dependency_file_not_parseable, message '/pnpm-lock.yaml not parseable', file-path '/pnpm-lock.yaml'."
    - "pnpm@7.33.5 install --frozen-lockfile succeeds cleanly in a disposable clean clone against the committed lockfile."
    - "Regenerating pnpm-lock.yaml from scratch with the exact same pnpm@7.33.5 in that clean clone produces a byte-for-byte identical file (md5 4288c0576b2b424de3fb5b93fd6dcbf5, both the committed file and the from-scratch regeneration)."
    - "dependabot-core issue #7584 (github.com/dependabot/dependabot-core/issues/7584): an unresolved, 'closed as not planned' report of the identical dependency_file_not_parseable / JSON-parse-error signature for a pnpm lockfile, no fix ever shipped."
  conclusion: >
    This repository's pnpm-lock.yaml (lockfileVersion: 5.4, the format
    pnpm 7.x writes) is valid and deterministic for the exact approved
    pnpm version. The failure is in dependabot-core's own npm_and_yarn
    updater, which cannot parse this lockfile format/version combination
    -- an external tool limitation, not a defect in this repository.
  workaround_applied:
    - "open-pull-requests-limit: 0 on the npm ecosystem entry in .github/dependabot.yml, stopping Dependabot's own scheduled npm-ecosystem update-PR attempts."
  not_changed:
    - "pnpm version (still exactly 7.33.5, matching lockfileVersion 5.4) -- no unapproved package-manager migration."
    - "Lockfile format/content -- unchanged, proven byte-identical to a fresh regeneration."
    - "GitHub Actions ecosystem monitoring -- fully independent, unaffected."
    - "Vulnerability alert detection -- unaffected; alerts fire correctly regardless of whether Dependabot can open a fix PR."
  known_residual_effect: >
    Alert-triggered *security* update attempts (as opposed to scheduled
    version updates) are controlled by the repository's separate
    "Dependabot security updates" setting, not by open-pull-requests-limit
    in dependabot.yml. Those will still be attempted whenever a new
    vulnerability alert fires for an npm-ecosystem dependency, and will
    still fail with the same parse error, until dependabot-core adds
    lockfileVersion 5.4 support or a separately approved pnpm-version
    migration changes the lockfile format. This residual noise was an
    explicit, accepted tradeoff (owner decision, 2026-07-20) in exchange
    for not reducing security-update *capability* further.
  revisit_when:
    - "dependabot-core adds lockfileVersion 5.4 (or pnpm 7.x-lockfile) support, or"
    - "A separately reviewed and approved pnpm major-version migration changes the lockfile format to one dependabot-core supports."
```

## M22-WU01 tag waiver

```yaml
m22_wu01_tag_waiver:
  status: waived_no_retroactive_tag
  work_unit: WU22-01 (Gate B Repository Audit, M22 Build Spec v0.2)
  why_no_commit: >
    WU22-01 was a read-only audit by design (git/version/schema/service
    inspection only). It produced no repository mutation, so an empty
    commit was correctly never created, consistent with this project's
    standing rule against empty commits.
  why_no_retroactive_tag: >
    The commit that was actually HEAD when Gate B was audited is
    db16b237fd896365cc54291dce55d27a7848e383 -- the merge commit for the
    unrelated prior "vitest/vite/esbuild security upgrade" milestone
    (already tagged v0.8.3). That commit's content and message describe a
    dependency-security fix, not M22 work. Attaching a new
    "m22-wu01-gate-b-audit" tag to it would misrepresent what the commit
    did to anyone reading `git tag --points-at` or a tag list -- the tag
    name would claim M22 audit work on a commit that has nothing to do
    with M22. A tag recording "this was the baseline examined," not "this
    commit performed WU22-01," is more honest recorded here instead.
  commit_audited: db16b237fd896365cc54291dce55d27a7848e383
  gate_b_result:
    implementation_entry_risk: 25
    outcome: passed
    verified_baseline:
      package_version: "0.8.3"
      release_tag: v0.8.3
      test_count: 1216
      open_critical_high_dependency_alerts: 0
  waiver_approved_by: >
    Recorded during the M22 governance micro-closure (2026-07-21) as the
    single, non-duplicated closure record for WU22-01 -- no tag
    "m22-wu01-gate-b-audit" exists or will be created; this waiver is the
    sole governance artifact for that Work Unit.
```
