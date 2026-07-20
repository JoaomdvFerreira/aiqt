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
  status: unavailable_on_current_plan
  evidence:
    - "GET /repos/{owner}/aiqt/private-vulnerability-reporting -> HTTP 404"
    - "PUT /repos/{owner}/aiqt/private-vulnerability-reporting -> HTTP 404 (enable attempt also rejected)"
    - "GET /repos/{owner}/aiqt/vulnerability-alerts -> HTTP 404: 'Vulnerability alerts are disabled.'"
    - "GET /repos/{owner}/aiqt -> security_and_analysis: null"
    - "Verified via live gh api calls, 2026-07-20 (M21 governance micro-closure)."
  rationale: >
    Private vulnerability reporting and the dependency graph/vulnerability
    alerts it depends on are both gated the same way branch protection is
    on this repository -- unavailable while private on the current GitHub
    plan. An API enable attempt was made and rejected, confirming this is
    a platform gate, not a missed configuration step. SECURITY.md states
    this gap honestly rather than claiming an inactive feature works.
  revisit_when:
    - "The repository is made public, or"
    - "The GitHub plan is upgraded to one that includes these features for private repositories."
```

## Dependency and supply-chain monitoring

`.github/dependabot.yml` (added in M21-WU04) requests weekly, capped,
grouped update pull requests for the npm ecosystem and GitHub Actions.
Dependabot does not auto-merge anything; every update PR requires the same
manual review and CI run as any other change.

Dependabot itself is confirmed active (it opened three real update PRs on
2026-07-20: `actions/checkout` 4->7, `pnpm/action-setup` 4->6,
`actions/setup-node` 4->7). Repository-level **vulnerability alerts** and
the **dependency graph**, however, are confirmed disabled (see
"Vulnerability reporting decision" above) -- these are a related but
distinct GitHub setting from Dependabot version updates, and enabling one
does not enable the other. Enabling vulnerability alerts/dependency graph
remains an explicit owner action.
