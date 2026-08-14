# Post-visibility operator checklist

Immediately after changing repository visibility, the maintainer should:

1. Enable GitHub Private Vulnerability Reporting and verify the private report path described in `SECURITY.md`.
2. Enable or review secret scanning; evaluate code scanning for the repository.
3. Create or re-enable `main` protection/rulesets: require Pull Requests, require successful `validate`, block force-push and branch deletion, and review bypass permissions.
4. Verify the default GitHub Actions token remains read-only and review fork-PR workflow behaviour.
5. Verify that no unexpected repository Actions secrets or variables exist.
6. Inspect public Actions history and logs for sensitive exposure.
7. Verify that intended Issues, PRs, Releases, and tags are publicly exposed.
8. Repair the community-profile/documentation branch URL if it still points at `master`.
9. Retain the separate development-only transitive `js-yaml` Dependabot alert backlog item; do not fold it into this visibility change.

This checklist does not authorize a Release, dependency change, or repository-setting change by an automated agent.
