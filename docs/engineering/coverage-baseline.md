# AIQT Coverage Baseline

**Status:** Baseline only (M21-WU05) -- no global or per-module threshold is
enforced by CI or by `vitest.config.ts`. This document records a
reproducible starting point for a future, separately reviewed decision
about which modules deserve a numeric gate; it is not that decision.

## How to reproduce

```bash
pnpm coverage
# or, when pnpm run is unavailable in a sandboxed environment:
node_modules/.bin/vitest run --coverage
```

Provider: `@vitest/coverage-v8` (v8-native, no source instrumentation
rewrite). Report formats: `text` (console), `json-summary`, `html` --
written to `coverage/`, which is gitignored and never committed.

## Baseline (generated 2026-07-20, 1201/1201 tests passing)

| Scope | % Statements | % Branch | % Functions | % Lines |
|---|---:|---:|---:|---:|
| **All files** | 83.23 | 88.38 | 93.04 | 83.23 |

### Critical modules (M21 Build Spec v0.2 §5.5)

| Module area | % Statements | % Branch | Notes |
|---|---:|---:|---|
| `core/filesystem` (atomic writes) | 92.08 | 90.00 | `atomic-write.ts` itself: 79.31% stmts / 50% branch -- uncovered lines are failure-path cleanup branches; M21-WU07 adds the collision/failure-injection regression suite that exercises them directly. |
| `state` (canonical stores, versioning) | 89.07 | 83.20 | `versioning.ts` and `ids.ts`: 100%/100%. |
| `workflow` (transitions, next-action, effective readiness) | 93.64 | 92.85 | `effective-readiness.ts`, `status-transitions.ts`, `dependency-graph.ts`: 100%/100%. |
| `tooling` (git/version governance) | 61.62 | 80.44 | Lower overall because `version-check-cli.ts` and `resolve-push-base-cli.ts` are thin process entrypoints exercised through integration/process-level tests, not unit instrumentation -- `git-utils.ts`, `push-base.ts`, `relevant-paths.ts`, `semver.ts` (the actual logic) range 76.67-100%. |
| `services/issue-service.ts` | 100.00 | 95.83 | |
| `services/checkpoint-amendment-service.ts` | 100.00 | 88.88 | |

## Candidate module-level thresholds (not enforced -- for future review)

These are observations from the baseline, not commitments:

- `core/filesystem/atomic-write.ts` and `state/workflow-state-store.ts` are
  the two lowest-branch-coverage modules directly on the crash-safety path
  and are reasonable first candidates for a future module-specific
  threshold, once M21-WU07's hardening lands and the baseline is
  re-measured.
- `tooling/*-cli.ts` entrypoints are unlikely to ever benefit from a unit
  coverage threshold -- they are process-boundary shims already covered by
  integration tests that spawn the real CLI.

## Compatibility

`coverage/` was already listed in `.gitignore` before this milestone;
generated coverage output has never been and is not now part of canonical
state or source control.
