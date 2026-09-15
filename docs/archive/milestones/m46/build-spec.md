# AIQT M46 — Multi-Repository Portfolio Governance

**Milestone:** M46
**Classification:** Medium (5 Work Units)
**Status:** Complete

## Objective

Add a deterministic, local-first portfolio layer that registers multiple
AIQT-managed repositories and provides a bounded governance/status view
across them, without duplicating or mutating each repository's canonical
workflow state.

## Problem

AIQT reasoned about one managed project/repository at a time. Users
managing several AIQT projects needed a deterministic way to answer which
projects are registered, which are healthy/blocked/stale/unavailable/need
human input, what each project's current milestone/Work Unit is, which
repositories expose defect/maintenance signals, and which member
repositories cannot be loaded and why — without the portfolio layer
becoming a second source of truth for any member's workflow state.

## Core principles

- **Member repositories remain authoritative.** Each member's
  `.aiqt/project.json`, `.aiqt/state.json`, and `.aiqt/runlog.jsonl` stay
  canonical; the portfolio manifest stores only membership and
  portfolio-specific metadata.
- **Explicit registration only.** No recursive filesystem crawling, no
  automatic `.aiqt/` discovery, no GitHub organization discovery, no
  remote clone/fetch management.
- **Read-first governance.** Registration, inspection, aggregation, and
  governance evaluation only — no cross-repository execution, autonomous
  mutation, automatic remediation, PR creation/merge, or release/deployment
  orchestration.
- **Partial failure is first-class.** One broken member never hides the
  rest of the portfolio; member outcomes are typed
  (`healthy` / `blocked` / `unavailable` / `invalid_state` /
  `not_aiqt_managed`).
- **Deterministic output.** Same manifest + member states always produce
  the same ordering, classifications, and summaries.

## Portfolio persistence and identity

No existing user-level/config persistence convention was found in the
repository (`.aiqt/` is exclusively a per-repository, project-scoped
concept). M46 introduces the narrowest platform-appropriate local
registry: one JSON manifest file per portfolio under a user-home-scoped
directory (`~/.aiqt/portfolios/<portfolioId>.json`, overridable via
`AIQT_PORTFOLIO_HOME` for tests/operators), separate from any
repository's own `.aiqt/`.

```ts
type PortfolioManifest = {
  schemaVersion: string; // PORTFOLIO_SCHEMA_VERSION, independent of AIQT_SCHEMA_VERSION
  id: string;
  name: string;
  members: PortfolioMember[];
  createdAt: string;
  updatedAt: string;
};

type PortfolioMember = {
  id: string;
  root: string; // canonicalized absolute path
  alias?: string;
  addedAt: string;
};
```

Portfolio IDs are deterministic slugs of the portfolio name, disambiguated
against existing ids; member IDs use the repository's existing
`nextId("M", ...)` convention. Root canonicalization uses `path.resolve()`
with case-insensitive duplicate detection on win32/darwin. Introducing
this schema never bumps `AIQT_SCHEMA_VERSION`.

## CLI surface

```text
aiqt portfolio create --name <name>
aiqt portfolio list
aiqt portfolio inspect <portfolio>
aiqt portfolio add <portfolio> <repo> [--alias <alias>]
aiqt portfolio remove <portfolio> <member>
aiqt portfolio status <portfolio>
aiqt portfolio check <portfolio>
```

`add` is fail-closed for non-AIQT repositories: a root without
`.aiqt/project.json` is rejected before it ever enters a manifest. `remove`
only ever rewrites the portfolio manifest.

## Portfolio snapshot and governance check

`status` loads each member's canonical `project.json`/`state.json` via the
exact same readers every project-scoped command uses, classifying each
member and producing a deterministic `PortfolioSnapshot` with a compact
per-status summary. `check` layers a governance/attention aggregation on
top, reading each member's existing M42 defect records and M45 maintenance
schedules (reusing M45's own pure `selectDueSchedule()` function) to
surface open defects, `needs_human` defects (mapped to the CLI's exit-10
`needs_input` contract), and due maintenance — without creating any new
mutation, triage, or remediation authority. M42 remains the owner of
defect/remediation authority, M43 of structural-review authority, M45 of
maintenance scheduling/execution authority.

## Work Units delivered

- **WU46-01** — portfolio contract, identity, persistence.
- **WU46-02** — portfolio registry CLI (create/list/inspect/add/remove).
- **WU46-03** — multi-project snapshot and `status`.
- **WU46-04** — portfolio governance `check`.
- **WU46-05** — dogfood, integration, docs, closure.

## Non-goals

Remote repository discovery, clone/fetch lifecycle, cross-repository
execution, portfolio-wide remediation/PR creation/automatic merge, release
publication, deployment, multi-repository atomic transactions, M47
Controlled Pull Request Integration, and M48 autonomous/nightly maintenance
sessions are all explicitly out of scope.

## Pre-milestone housekeeping

The deferred Human Final-State Authorization / automatic-merge cleanup was
folded into the M46 branch as one separate housekeeping commit (not a
product Work Unit): removed `.github/workflows/human-approval-merge.yml`,
restored manual-merge semantics in `docs/governance/versioning.md`,
`docs/governance/repository-owner-map.json`, and
`docs/governance/maintainer-recovery.md`, and extended
`docs/archive/infrastructure/human-approval-auto-merge/closure-report.md`
with the PR #19/#20 live outcome and the deliberate discontinuation
decision. See that closure report for full detail.
