# AIQT M48 — Night Project Review & Issue Generation

**Closure report**

| Field | Value |
|---|---|
| Milestone | M48 |
| Classification | `high_risk` |
| Branch | `milestone/m48-night-project-review` |
| Baseline | `main` @ `4625444` (PR #23 merged, post-merge `Validate` green) |
| Package version | `0.44.2 → 0.45.0` |
| Canonical schema version | `0.7.0 → 0.8.0` |
| Work Units | 6, each with one detailed commit and one annotated tag |
| Overall implementation risk | **60/100 🟠 orange** (see §12) |

## 1. What M48 added

`aiqt review night` — a bounded, resumable overnight review session nested under the existing `review` command family:

```text
aiqt review night run       # idempotent: start-or-advance one bounded step; returns the next
                             # ReviewTask or a stop reason
aiqt review night submit    # report findings for a task: quality gate -> M42 intake -> dedup ->
                             # backlog-aware GitHub Issue publication -> coverage upsert
aiqt review night status    # read-only: active session or most recent finished result
aiqt review night cancel    # bookkeeping only; no live process is signaled
aiqt review night coverage  # read-only: the incremental coverage ledger
```

**M48 never modifies project source, creates a commit or Pull Request, merges, deploys, or publishes a Release.** The only external mutation anywhere in this milestone is a single, label-scoped GitHub Issue create; GitHub's edit/close/reopen/delete/assign/comment endpoints appear nowhere in the codebase.

## 2. Work Unit table

| WU | Tag | Scope |
|---|---|---|
| WU48-01 Session/ReviewTask/coverage-state contracts | `wu48-01-session-reviewtask-coverage-contracts` | Contract-only schema, additive `nightAuditCoverage`/`nightAuditActiveSession` StateModel sections, `defects[].externalIssueRef`, schema bump |
| WU48-02 Change-aware coverage queue and budget engine | `wu48-02-coverage-queue-budget-engine` | Pure six-tier priority scoring, deterministic budget-aware selection, diminishing-return stop condition |
| WU48-03 Bounded ReviewTask execution mechanics | `wu48-03-review-task-execution` | Context manifest, handoff packet, structural call-through, result normalization, coverage upsert |
| WU48-04 Quality gate, fingerprint, M42 intake | `wu48-04-quality-gate-fingerprint-m42-intake` | Accept/reject gate, structural-identity fingerprint, M42 defect-intake adapter |
| WU48-05 GitHub Issue publication, session orchestration, CLI | `wu48-05-github-issue-publication-session-cli` | The one external-mutation surface, session state machine, `aiqt review night *` |
| WU48-06 Live dogfood, closure | (this commit) | Live external dogfood, baseline reconciliation, closure report |

Milestone tag: `m48-night-project-review` (created after this report).

## 3. Package and schema outcome

- **Package: `0.44.2 → 0.45.0` (minor).** A new public command family plus a new external-write capability (Issue creation) is a minor bump under `docs/governance/versioning.md`, recorded at WU48-01 per this repository's established precedent (M42-WU01 similarly bumped once at the schema-introducing Work Unit rather than per WU thereafter).
- **`AIQT_SCHEMA_VERSION`: `0.7.0 → 0.8.0`.** Two new additive, optional `StateModel` sections (`nightAuditCoverage`, `nightAuditActiveSession`) and one additive field on the existing M42 `defects` record (`externalIssueRef`) — matching the precedent established by M42 (defects) and M45 (maintenance schedules): a new top-level canonical section pairs with a schema bump; a transient evidence object or a separately-versioned domain does not.
- **No new schema/version domain.** Unlike M46's portfolio manifest or M47's PR-integration plan, the Coverage Ledger and session state live inside the *target repository's own* canonical `.aiqt/state.json` — coverage is per-project operational history, not cross-repository membership or a Git/GitHub side-effect record that must avoid being written into a managed repository.
- **No new runtime dependency.** `fetch` is Node 24's built-in global, used identically to the existing GitHub clients; still exactly `@inquirer/prompts`, `commander`, `zod`.

## 4. Existing-owner reuse (build spec §3)

Every new capability reuses an established pattern rather than inventing a parallel one:

- **M42 defect authority**, unchanged as the sole durable defect/fingerprint record — extended, not duplicated, by `externalIssueRef`.
- **M43's transient-finding discipline** (fingerprint excludes narrative text and the reviewed commit; a separate freshness binding) — mirrored exactly for `AuditFinding`, which needed its own contract because M48's domains (code quality, documentation, governance/config judgment) have no deterministic rule-engine equivalent in `structuralReviewEngine`'s seven domains. Where the domains genuinely overlap (tests/repository_structure/architecture), `runStructuralCallThrough()` invokes the M43 engine directly rather than reimplementing it.
- **M45's session/lock/reconciliation pattern** (a nullable-singleton active-session slot, the M25 workspace-operation lock for the short claim sequence only, stale-claim-reconciles-to-failed) — reused for `NightAuditActiveSessionRecord`, explicitly *not* added as a fourth `MaintenanceTaskKind` (see §6).
- **M46's `resolvePortfolioMemberRoot()`**, reused verbatim for `--portfolio-member` targeting.
- **M47's never-retry-blind, lookup-always-precedes-create discipline**, reused verbatim in `night-audit-issue-publication-service.ts` for GitHub Issue creation, and `github-release-client.ts`/`github-pull-request-client.ts`'s `redactToken`/`GithubApiOutcome` conventions reused directly for the new `github-issue-client.ts`.
- **`sandboxBackendContract`/`workspaceLifecycle` explicitly not reused** — M48 never mutates the repository under review, so sandbox/workspace isolation machinery would be new, unjustified authority.

## 5. Execution model (resolved during implementation)

The build spec described ReviewTask "handoff" (packaging mechanics reused from `agent-packet-service.ts`) while also describing `run` as executing "synchronously... for up to `hardStopMinutes`." Implementation confirmed only the handoff framing is consistent with the rest of the build spec's own resolved decision (§3: sandbox/workspace machinery explicitly not reused) and with the repository's hard, repeated invariant that AIQT never spawns a live coding-agent process itself outside the M38 sandboxed repair path.

Resolved as: a Night Audit session is a bounded sequence of `run` (get the next task or a stop reason) / `submit` (report findings) round-trips — the exact same shape as the product's own core `aiqt next` → agent implements → `aiqt checkpoint` loop, applied to review instead of implementation. `hardStopMinutes` is checked against the session's persisted `startedAt`, not against one blocking process call. This is recorded here as a material design clarification, not a silent departure from the build spec — it fills an implementation-level mechanism using the closest existing pattern in the same codebase, consistent with the build spec's own owner-reuse discipline.

A second, smaller simplification: `reviewTasksAttempted`/`reviewTasksCompleted` increment together at `submit` time rather than separately at `run`-hand-out time, so that calling `run` repeatedly without submitting is safely idempotent (returns the same deterministic top-of-queue task) instead of double-counting attempts.

## 6. Persistence and mutation boundaries

- Coverage Ledger and session state: additive `StateModel` sections in the target repository's own `.aiqt/state.json` (§3).
- `night_review` is deliberately **not** a fourth `MaintenanceTaskKind` — M45's occurrence contract assumes a handler completes synchronously within one lock-held claim window; a multi-hour Night Audit session cannot. A future milestone may wire "start if due" as a scheduled trigger; M48 builds only the session itself.
- The only mutating external call in this milestone is `github-issue-client.ts`'s `createIssue` — fixed to exactly one label (`aiqt-night-audit`), no edit/close/reopen/delete/assign/comment capability anywhere.
- Local dedup is two-layered before any GitHub call: (1) the structural fingerprint against the existing M42 defect list (`applyDiscoveryCandidates`'s own dedup), (2) the matched defect's `externalIssueRef` presence. GitHub search-by-label-and-fingerprint-marker is the fallback (#3), reached only when neither local check resolves it — never the sole safety mechanism.

## 7. Finding lifecycle and quality gate

```text
AuditFinding (candidate, transient)
  -> quality gate (disposition=actionable, evidence non-empty, confidence>=strong_signal,
     significance != informational)
  -> M42 intake (freshness check -> gate re-check -> applyDiscoveryCandidates verbatim)
  -> GitHub Issue publication is a PROJECTION of the resulting DefectRecord, never of the
     raw AuditFinding directly
  -> externalIssueRef written back onto the defect record on success
```

The M42 defect list remains the single source of truth for "is this known"; GitHub Issues are a one-way projection of it, never a second authority.

## 8. Live disposable dogfood

Run against **`JoaomdvFerreira/aiqt-m47-dogfood`** — an existing private, disposable sandbox repository (originally created for M47's live PR dogfood; reused here rather than creating a new one, minimizing footprint). Not the AIQT product repository. A small, real, disclosed fixture (two TypeScript files with genuinely duplicated retry/backoff logic, and a README missing setup instructions) was pushed to it explicitly for this dogfood — never presented as a pre-existing discovery. Real GitHub REST calls throughout; the provider was not stubbed. Machine-readable evidence (local-only, gitignored per `docs/engineering/*.generated.json` convention): `docs/engineering/m48-wu06-live-dogfood-evidence.generated.json`.

Proven live:

| Requirement | Result |
|---|---|
| Bounded session starts, small ReviewTasks | ✅ 3 sessions, 4 tasks total, each scoped to one domain × one bounded area |
| Accepted vs. rejected/empty findings | ✅ 1 accepted+published, 1 accepted+suppressed, 1 honest zero-finding submission |
| Incremental coverage ledger | ✅ 3 entries recorded with real commit/timestamp/outcome |
| At least one real GitHub Issue published from a legitimate finding | ✅ Issue #5, exact build-spec §13 format, correct `aiqt-night-audit` label |
| Repeated execution does not duplicate the Issue | ✅ identical finding resubmitted → `already_published`, zero duplicate created |
| Backlog-aware suppression | ✅ cap=1 (already met by Issue #5) → a second legitimate finding was intaken as a candidate defect (DEF-002) but publication correctly suppressed |
| Session resumability | ✅ `run` without an intervening `submit` is idempotent (also covered by the automated suite); a session artificially backdated past `hardStopMinutes` + 60min grace was reconciled to `interrupted` on the next `run`, never silently resumed |
| Zero project-source mutation | ✅ `git status --porcelain`/`git log` unchanged throughout; only `.aiqt/` ever appears untracked |
| Zero PR/merge/release | ✅ none created |

Not separately re-exercised live: `budget_exhausted` stop (covered in the automated integration suite with `maxReviewTasks=1`, to keep the live run within scope); provider-independent per-ReviewTask telemetry, implemented and covered by the automated integration suite in the closure-reconciliation correction below (§10 item 6), but not re-exercised against the external dogfood repository in this pass.

## 9. Validation

- **Per Work Unit:** focused tests, `tsc --noEmit`, `eslint`, run and green at each of the 5 code-bearing WUs (see individual commit messages for exact counts).
- **Closure:** `pnpm validate` (typecheck → lint → build → test → version:check).
- **Baseline self-tracking tests updated deliberately** (not silently): `EXPECTED_COMMAND_COUNT` 112→117 (`m33-cli-contract-matrix.test.ts`), `KNOWN_SPAWNING_FILES`/`KNOWN_TIMEOUT_OVERRIDE_FILES` +1 (`m34-validation-workload-inventory.test.ts`), a new `night-audit-review` domain classification rule added to `test-inventory-classifier.ts` (`m35-test-inventory-classification.test.ts`), and `pr-integration-boundary-scan.test.ts`'s schema-version literal updated `0.7.0`→`0.8.0` with a comment clarifying the assertion's real intent (M47 introduced no drift; a later milestone's own legitimate bump is expected and tracked deliberately).
- **Version:** `pnpm version:check` local mode and base-comparison against `main` both pass at `0.45.0`.

## 10. Corrections made during the milestone

1. **Execution-model clarification** (§5) — the build spec's `run`-as-one-blocking-call framing was superseded by the bounded `run`/`submit` round-trip model, resolved before WU48-03 implementation began.
2. **`reviewTasksAttempted`/`Completed` merged to increment at `submit` time** (§5) — avoids a double-count edge case from repeated no-submit `run` calls.
3. **`NightAuditStopReasonSchema` extended with `interrupted`** (WU48-05) — WU48-01's original five stop reasons did not cover a reconciled-abandoned session; added additively, no consumer depended on the exhaustive set.
4. **Milestone documentation housekeeping caught up** — `docs/milestones/completed/m45/` archived to `docs/archive/milestones/m45/` per the protocol's rolling-two-window rule, which should have run when M48's active/ directory was first created; done now as part of closure rather than left undone.
5. **Numeric risk score reconciled into the closure report** — the header and §12 previously stated the "orange" band without the accompanying `/100` number the PR body and the M47 closure-report precedent both carry. Reconciled to **60/100 🟠 orange**, consistent throughout.
6. **Provider-independent per-ReviewTask telemetry implemented** (build spec §15) — a pre-merge audit found the original closure report's claim that telemetry "was never assigned to a specific Work Unit" was factually incorrect: the committed build spec's §16 decomposition table names WU48-06's objective as including "telemetry evidence," and §20 ("Unresolved decisions") declares all of Phase 3 A–M, including telemetry (M), fully resolved with no open questions. WU48-06 had not implemented it. This correction closes that gap for the four provider-independent fields that were missing (`scope`, `contextItemCount`, `executionProfile`, honest per-task wall-clock duration) on the existing `night_audit.finding_accepted`/`finding_rejected` runlog events — `domain` and finding outcome were already captured. A new optional `currentTaskAssignedAt` field on `NightAuditActiveSessionRecord` (additive, folded into the still-unmerged 0.8.0 schema bump, no new bump) lets `submit` compute duration honestly, set only when `run` actually assigns a task and cleared once `submit` resolves it, so repeated no-submit `run` calls never reset it. Provider/model identity and token usage remain correctly unimplemented — no adapter in the shipped handoff execution model reports them, and build spec §15 requires they never be fabricated.

## 11. Limitations and residual risk

| # | Limitation | Residual |
|---|---|---|
| L1 | Provider/model identity and token usage (build spec §15) remain best-effort and provider-dependent — no adapter in the shipped handoff execution model reports them, so they are correctly never persisted or fabricated. `tokens per accepted finding` remains explicit M49 analysis scope and is never computed locally. | Accepted by design — matches build spec §15's own "never fabricated" instruction; nothing to fix. |
| L2 | Candidate scope derivation (`deriveReviewCandidates`) uses a small, fixed, existence-filtered default domain→area map, not directory discovery. | Accepted for a first pass — real, bounded, not fabricated; expected to evolve with usage. |
| L3 | `computeRecentDefectSignalScopeKeys` reads `DefectRecord.affectedFiles`, which no existing discovery source in this repository (M42, M43, or M48) currently populates — the "recent defect signal" priority tier is consequently never reachable today. | Low — an honest limitation of an existing, unrelated field, not a bug introduced here; the other five priority tiers are fully functional. |
| L4 | `budget_exhausted` was proven only in the automated integration suite, not against the live external dogfood repository. | Low — the same code path (`checkNightAuditBudget`) is exercised identically either way. |
| L5 | The dogfood repository retains one open Issue (#5) and one un-published candidate defect record (local to that repo's own `.aiqt/`, not this repository). M48 has no Issue-close capability by design. | Operator cleanup on a disposable target, exactly as M47 left branches/PRs in the same repository. |
| L6 | GitHub only, mirroring M47. A non-GitHub remote resolves to `owner=null` and takes the `no_credentials`-equivalent path, never a guess. | By design. |

## 12. Overall risk

**60/100 🟠 Orange.** M48 introduces the milestone's one genuine new external-mutation authority: real GitHub Issue creation on a real repository. The mitigations are structural rather than procedural, mirroring M47's own reasoning: the disallowed actions (edit, close, reopen, delete, assign, comment, arbitrary label) are inexpressible in `github-issue-client.ts`'s three fixed operations; a lookup always precedes a create and a failed create is resolved by a second lookup rather than retried blind; local defect-fingerprint/`externalIssueRef` dedup is checked before any network call; backlog suppression prevents unbounded Issue accumulation; and no project-source mutation, PR, merge, deploy, or Release capability exists anywhere in the milestone. The score sits below M47's 62/100: M48's external-mutation surface is narrower (one Issue-create operation, versus M47's branch-push plus PR-create plus reviewer-assignment across three call sites). Per `docs/governance/versioning.md`, orange requires human approval before merge — which the repository's manual-merge process already mandates.

## 13. Definition of Done

| Requirement | Status |
|---|---|
| Session/ReviewTask/coverage-state contracts | ✅ |
| Change-aware, priority-scored, budget-aware queue planning | ✅ |
| Bounded ReviewTask execution, no repository mutation | ✅ |
| Quality gate, fingerprint, M42 intake reuse | ✅ |
| GitHub Issue publication: lookup-before-create, never-retry-blind, backlog-aware | ✅ |
| No duplicate Issue across repeated execution | ✅ (live-verified) |
| Session resumability, stale-session reconciliation | ✅ (live-verified) |
| Live disposable dogfood, at least one real Issue | ✅ |
| AIQT self-management absent | ✅ |
| Package/schema decisions correct | ✅ |
| Authoritative closure validation green | ✅ |
| Milestone documentation lifecycle reconciled | ✅ |
| Development PR ready for human review and manual merge | pending |
