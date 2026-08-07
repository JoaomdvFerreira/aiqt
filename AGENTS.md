# AGENTS.md

Provider-neutral instructions for coding agents working on this repository.

## AIQT self-development rule

**This repository is the AIQT product itself.** Do not use `aiqt init`,
`aiqt plan`, `aiqt next`, `aiqt checkpoint`, `aiqt review`, `.aiqt/`, or any
other AIQT self-management state to plan or govern development of AIQT.

Repository development instead uses ordinary engineering governance:
specifications, Git branches, commits/tags, CI, focused tests, closure
reports, pull requests, and GitHub Releases, organized around Work Unit
(WU) execution.

## Governance references

- [`docs/governance/milestone-protocol.md`](docs/governance/milestone-protocol.md)
  — milestone classification, validation scope, reporting limits.
- [`docs/governance/versioning.md`](docs/governance/versioning.md) —
  SemVer policy, version-bump requirements, tag conventions, and the
  milestone branch/release lifecycle.
- [`docs/governance/repository-owner-map.json`](docs/governance/repository-owner-map.json)
  — the index of which source file owns which contract; verify an entry
  against current source before relying on it.

Do not duplicate these documents' contents — read them directly when their
subject matter is relevant to the current task.

## Working rules

- Work one Work Unit at a time. Do not start a second WU before the current
  one is committed and tagged.
- Inspect only the repository areas relevant to the current WU. Avoid broad
  rereads of the whole repository or of old milestone history unless a
  specific check requires it.
- Prefer focused, impacted validation during a WU (`tsc --noEmit`,
  `eslint .`, the affected test files). Do not run the full test suite
  (`pnpm test` / `pnpm validate`) after every WU unless the change is
  genuinely cross-cutting or high-risk (see milestone-protocol.md §4).
- Broader/full validation belongs primarily at milestone closure.
- Summarize successful command output; do not retain large logs. Retain
  detailed evidence for failures.
- Do not use subagents by default. Use one only when parallel, independent
  investigation materially helps, or independent review of a finished
  change is explicitly required.
- After each completed WU: create one detailed commit and one WU tag. Keep
  the working tree clean at WU boundaries — no stray untracked files, no
  uncommitted state.
- Do not push unless explicitly instructed.
