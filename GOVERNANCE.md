# AIQT Repository Governance

## Distribution

AIQT is open source under Apache-2.0. `package.json` remains `private: true`: source availability does not authorize npm publication, and no package publication is currently intended.

## Durable engineering governance

- AIQT uses ordinary engineering governance—specifications, branches, commits/tags, focused validation, PRs, and Releases—not its own `.aiqt/` state—to develop AIQT.
- Risk is scored 0–100: green 0–24, yellow 25–49, orange 50–74, red 75–100. Scores below 50 may permit automation once other gates pass; 50+ requires human approval, and 75+ also requires an explicit waiver.
- Every PR requires local `pnpm pr:ready` before creation, hosted `Validate` remains authoritative, and merges are human actions. AIQT does not approve, merge, or auto-merge PRs.
- Releases are separate, explicit human decisions; a merge or package bump never creates one automatically.
- Contributors should keep changes bounded, preserve provenance, run validation proportional to risk, and use Issues/PRs for public review.

## Public repository controls

After visibility changes, maintainers must enable Private Vulnerability Reporting, review secret/code scanning, protect `main`, and review Actions permissions, secrets, variables, and fork PR behaviour. See [the public-readiness operator checklist](docs/public-readiness/post-visibility-checklist.md).

## Security backlog

Retain the separate security backlog item for the development-only transitive `js-yaml` Dependabot alert. It is not changed by public-readiness work and should be handled independently if it becomes a release blocker.

## Historical records

Detailed historical closure, exception, and process records remain in `docs/archive/`; they are provenance, not current distribution policy.
