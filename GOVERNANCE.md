# AIQT Repository Governance

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

## Dependency and supply-chain monitoring

`.github/dependabot.yml` (added in M21-WU04) requests weekly, capped,
grouped update pull requests for the npm ecosystem and GitHub Actions.
Dependabot does not auto-merge anything; every update PR requires the same
manual review and CI run as any other change.

Repository-level Dependabot alerts and the dependency graph are GitHub
account/repository settings, not files in this repository. Their current
state was not independently re-verified beyond what the GitHub API exposed
during Gate A and is recorded as an owner action in the M21 final report,
not claimed as enabled.
