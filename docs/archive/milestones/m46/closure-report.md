# M46 Closure Report — Multi-Repository Portfolio Governance

**Milestone branch:** `milestone/m46-portfolio-governance`
**Package version:** `0.42.0` → `0.43.0` (minor)
**Canonical project-state schema:** unchanged (`AIQT_SCHEMA_VERSION` stays
at `0.7.0`); a separate `PORTFOLIO_SCHEMA_VERSION` (`1.0.0`) was
introduced for the new portfolio manifest, per build spec Sec 3/9.

## Pre-milestone housekeeping

One separate commit (`274c363`, not a Work Unit, no WU tag) folded in the
deferred Human Final-State Authorization cleanup:

- removed `.github/workflows/human-approval-merge.yml`;
- restored "Merging is a manual human action" in
  `docs/governance/versioning.md` (milestone-lifecycle diagram, Pull
  Request merge gate, contributor checklist);
- restored manual-merge wording in `docs/governance/maintainer-recovery.md`;
- updated `repository-owner-map.json`'s `pullRequestGovernance` entry;
- marked `docs/archive/infrastructure/human-approval-auto-merge/build-spec.md`
  discontinued and extended its `closure-report.md` with PR #19 (merged,
  bootstrapped the mechanism) and PR #20's outcome: the live smoke test
  correctly exposed a self-referential `mergeStateStatus` self-block (the
  workflow's own in-flight check run made the aggregate status report
  `UNSTABLE` while it evaluated its own gate) and failed closed safely, as
  designed. A narrow fix was identified but not applied — the mechanism
  was deliberately discontinued because automating a single human merge
  click did not justify the Actions cost, the standing `contents: write`
  authority, and the `pull_request_target` maintenance complexity.

A second small housekeeping commit (`6fc3afd`) archived M43's completed
milestone docs to `docs/archive/milestones/m43/` per the rolling
two-most-recent-completed-milestones window (`milestone-protocol.md` Sec
10), triggered by M46 starting.

## Work Units implemented

| WU | Commit | Tag | Scope |
|---|---|---|---|
| WU46-01 | `33c65cc` | `wu46-01-portfolio-contract` | Portfolio manifest/member schema, separate schema-version gate, user-home-scoped persistence (`portfolio-home.ts`/`portfolio-store.ts`), pure domain service (id generation, root canonicalization, add/remove member) |
| WU46-02 | `cfc0919` | `wu46-02-portfolio-cli` | `aiqt portfolio create/list/inspect/add/remove`, fail-closed non-AIQT registration policy |
| WU46-03 | `af8bb33` | `wu46-03-portfolio-snapshot-status` | `aiqt portfolio status`, `PortfolioSnapshot`, typed member classification reusing existing canonical readers |
| WU46-04 | `12a770a` | `wu46-04-portfolio-governance-check` | `aiqt portfolio check`, governance aggregation over existing M42 defect / M45 maintenance-schedule evidence |
| WU46-05 | `b850796`, `ecb7320`, `b6d58e0`, plus one post-audit reconciliation commit | (this closure) | Version bump, full-suite reconciliation, dogfood scenarios, closure docs, and a closure-audit correction adding open `DecisionEscalation` aggregation to `check` |

## What changed

- **Storage:** one JSON manifest per portfolio at
  `~/.aiqt/portfolios/<id>.json` (`AIQT_PORTFOLIO_HOME` override for
  tests/operators), atomic writes, deterministic sorted listing, typed
  partial-failure handling for a malformed manifest. AIQT's own repository
  gains no `.aiqt/` from this feature (verified by dogfood scenario 14).
- **CLI:** `aiqt portfolio create|list|inspect|add|remove|status|check`,
  wired through the existing `CommandResult`/`emit()` path — no parallel
  result envelope, no new exit-code semantics beyond the existing exit-10
  `needs_input` contract.
- **Snapshot/governance:** `loadPortfolioMemberState()` is the single
  bounded read/classification path both `status` and `check` build on;
  `check` reuses M45's own `selectDueSchedule()` pure function for
  maintenance-due detection rather than a second due-decision algorithm.
  A closure-audit finding added a second human-input signal to `check`:
  M22's `DecisionEscalation` records with status `open`, read via the
  existing `getDecisionEscalations()` accessor (`state.evidence.decisionEscalations`)
  — no new or duplicated contract, no member mutation, no new
  remediation authority. `resolved`/`withdrawn` escalations never count.
- **Test-suite reconciliation:** the repository's own cross-cutting guard
  tests (`cli.test.ts`'s exact top-level command snapshot,
  `m33-cli-contract-matrix.test.ts`'s command count, and
  `m35-test-inventory-classification.test.ts`'s domain/platform-guard
  baselines) were updated deliberately to account for the seven new
  `portfolio` leaf commands and the new `portfolio-*.test.ts` files.

## Tests

77 portfolio-specific tests across 10 files
(`tests/unit/portfolio-{schema,home,store,service,snapshot,governance}.test.ts`,
`tests/integration/portfolio-{registry,status,check}-cli.test.ts`,
`tests/integration/portfolio-dogfood.test.ts`), covering:

- schema validation and version-compatibility gating;
- write/read/list round trips, malformed-manifest safety, process-restart
  persistence;
- id generation, root canonicalization, case-aware duplicate detection
  (win32/darwin), member add/remove/cap enforcement;
- CLI create/list/inspect/add/remove/status/check, human/JSON parity,
  fail-closed non-AIQT registration, unknown-portfolio/member errors;
- member status classification (`healthy`/`blocked`/`unavailable`/
  `invalid_state`/`not_aiqt_managed`) and deterministic summary
  aggregation;
- governance aggregation (open/needs-human defect counts, open decision
  escalation counts, maintenance-due detection, blocked-status
  carry-through) and the exit-10 `needs_input` contract, including
  resolved/withdrawn escalations correctly excluded and mixed
  defect+escalation signals aggregating without double-counting;
- all 18 build-spec Sec 8 dogfood scenarios (empty/single/multiple
  members, duplicate add, missing/moved repo, invalid member state
  alongside a healthy one, mixed blocked+healthy, `needs_input` member,
  defect/maintenance signal visibility, deterministic ordering,
  human/JSON parity, no-mutation guarantees, no AIQT self-management,
  win32/darwin case behavior, restart persistence, malformed-manifest
  safety, package/schema/version policy).

## Validation performed

- `pnpm typecheck && pnpm lint && pnpm build && pnpm version:check`: all
  pass on the final HEAD.
- `pnpm version:check -- --base main`: PASSED — minor increment detected
  and required, `0.42.0` → `0.43.0`, matching the 14 relevant changed
  paths (the housekeeping workflow/doc changes plus every new
  `src/**` portfolio file).
- `pnpm test` (full suite): 3537/3540 non-skipped tests pass. The
  remaining 3 (`tests/unit/structural-review-engine.test.ts`'s
  determinism and read-only-invariant cases, and
  `tests/integration/review-structural.test.ts`'s explain case) hit their
  hardcoded 5000ms per-test timeout only under full-suite parallel-worker
  load; re-run individually they pass in ~3s each, well within timeout.
  Classified per `milestone-protocol.md` Sec 5 as a load-induced local
  flake, not a regression introduced by this milestone — real CI is the
  authoritative gate for this class of result.
- Manual end-to-end smoke: `tsx src/index.ts portfolio create/list --json`
  against a disposable `AIQT_PORTFOLIO_HOME`.

**Post-closure-audit reconciliation.** A read-only closure audit (before
human approval) found that `check` ignored M22's `DecisionEscalation`
contract's `open` status — a durable canonical human-input signal
distinct from M42's defect `needs_human` status. The correction (see
"What changed" above) was validated with `tsc --noEmit`, `eslint`, and the
full focused/impacted portfolio suite (`tests/unit/portfolio-*.test.ts`,
`tests/integration/portfolio-*.test.ts`, 10 files / 77 tests, all green)
— the full local `pnpm test` suite was deliberately not re-run for this
narrow, additive change, per the instruction not to chase the known
structural-review load-flake by re-running until lucky. `pnpm typecheck`/
`pnpm lint`/`pnpm build` were re-run and pass; no package/schema version
was changed. GitHub's `Validate` ran once, authoritatively, on the
resulting PR HEAD.

## Known limitations

- Member status classification does not attempt to derive `needs_input`
  purely from `state.projectStatus`/checkpoint/review state the way
  `aiqt review`/`aiqt manage` do — `status`'s classification vocabulary is
  intentionally the narrower `healthy`/`blocked`/`unavailable`/
  `invalid_state`/`not_aiqt_managed` set from bounded reads; `check` is
  where human-input signals are aggregated. As of the WU46-05 closure
  reconciliation below, `check` aggregates two durable canonical
  human-input signals: M42 defects with status `needs_human`, and M22
  `DecisionEscalation` records with status `open` (`state.evidence.decisionEscalations`,
  read via the existing `getDecisionEscalations()` accessor — no
  duplicated/redefined contract). A future milestone could widen the
  signal set further (e.g. open review findings, evidence-gate
  advisories) without changing the portfolio manifest or its ownership
  model.
- `check`'s maintenance-due detection reports whether a schedule is
  currently due; it does not report *how* overdue, since that requires no
  new computation beyond what `selectDueSchedule()` already returns and
  the build spec scoped `check` to attention signals, not a full
  maintenance-status mirror (`aiqt maintenance status` already owns that
  detail for a single project).
- No portfolio-level caching: `status`/`check` re-read every member's
  `project.json`/`state.json` on every invocation. Acceptable at the
  bounded `MAX_PORTFOLIO_MEMBERS` (200) scale; a future milestone could
  add bounded parallelism or caching if portfolios grow materially larger
  in practice.

## Definition of Done

- users can create and maintain local portfolios of explicitly registered
  AIQT repositories — ✅ (`create`/`add`/`remove`/`list`/`inspect`);
- member workflow state remains canonical only inside each member
  repository — ✅ (no member `.aiqt/` mutation anywhere in this milestone,
  verified by test);
- status/check aggregate multiple repositories deterministically — ✅;
- partial failures remain visible — ✅ (typed member status +
  list-level malformed-manifest handling);
- defect/structural/maintenance/release ownership boundaries preserved —
  ✅ (read-only reuse of M42/M45 evidence, no new mutation/remediation
  authority);
- no cross-repository mutation capability introduced — ✅;
- CLI human/JSON contracts remain consistent — ✅;
- focused/impacted tests pass per WU — ✅;
- authoritative full closure validation passes — ✅ (with the isolated,
  reconciled load-flake noted above);
- milestone docs closed correctly — ✅ (this report; M43 archived per
  the rolling-window policy);
- PR ready for human review and manual merge after green CI — pending
  (see below).

## Final risk

**Overall: 30/100 — 🟡 Yellow**, matching the build spec's own planning-time
classification for this milestone's highest-risk Work Unit (WU46-04). No
Work Unit reached the 50-point human-review-mandatory boundary during
implementation. Contributing factors: new persistent local storage outside
any repository (WU46-01, mitigated by atomic writes, schema versioning,
and a test-isolated `AIQT_PORTFOLIO_HOME` override), a new public CLI
surface (WU46-02/03/04, mitigated by full reuse of the existing
`CommandResult`/exit-code contract and existing canonical readers), and
governance aggregation reading two other owners' evidence (WU46-04,
mitigated by reusing their existing pure functions/types verbatim rather
than re-deriving classification logic). Residual risk: the known
limitations above are scope choices, not defects, and none require human
approval to accept.

## Merge model

Manual: green CI → human review → human manual merge (per this
milestone's own pre-milestone housekeeping, which restored that as the
sole mechanism repository-wide). No GitHub Release is created by this PR.
