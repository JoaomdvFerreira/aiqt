# M48 Build Specification — Night Project Review & Issue Generation

**Protocol:** [`docs/governance/milestone-protocol.md`](../../../governance/milestone-protocol.md) v0.4
**Aligns with:** [AIQT Product Specification v0.8](../../../product/AIQT_Product_Specification_v0.8.md) §13-14, §17, §24; [Technical Architecture Specification v0.5](../../../product/AIQT_Technical_Architecture_Specification_v0.5.md) §16-17, §29
**Classification:** `high_risk` (see §0)
**Status:** Planning complete. Implementation not started.

This is a delta-only specification. It states what is new; it references prior owners by name via [`repository-owner-map.json`](../../../governance/repository-owner-map.json) rather than repeating their contracts.

---

## 0. Classification

M48 combines, per the Lean Milestone Protocol's `high_risk` criteria:

- long-running, resumable autonomous review (a session spanning up to 3 hours, unattended);
- a new external GitHub **write** capability (Issue creation) — a materially new mutation surface, not a reuse of an existing one;
- resource/token budgets and diminishing-return stop logic;
- idempotency/deduplication against three separate sources of truth;
- scheduling/resumability across process restarts.

Classified **high_risk**. Per protocol §1, this is a planning-time scope classification, separate from per-Work-Unit implementation risk (§1's `>= 50` human-review boundary applies independently and is not overridden by this classification).

High risk does not imply every Work Unit requires deep-reasoning effort — see §12 (Milestone Execution Profile). WU48-05 (external Issue mutation, idempotency) is the one Work Unit where reasoning difficulty is genuinely concentrated; the rest follow established patterns from M42/M43/M45/M47 closely enough to execute at the baseline profile.

---

## 1. Objective

Give a project a bounded, unattended, evidence-backed overnight review: read what has changed or gone unreviewed, produce small independent findings, pass them through an explicit quality gate, deduplicate against everything already known, and publish only what clears the bar as a GitHub Issue — leaving a compact morning result. Never touch source, never open a Pull Request, never remediate.

## 2. Product boundary (non-goals, restated from Product Spec §24)

M48 does **not**: modify project source; remediate defects; create implementation commits; create Pull Requests; merge; deploy; publish Releases; select issues for autonomous fixing. Any Work Unit whose design would require one of these is out of scope and must be flagged, not implemented.

---

## 3. Existing owners

Verified against current source (`main` at `4625444`, PR #23 merged) as of this planning pass, per protocol §1 "High-risk planning fields."

| Concern | Existing owner | Reuse / extend / new | Reason |
|---|---|---|---|
| Durable defect record, fingerprint, lifecycle | `defectContract` (`src/schema/defect.schema.ts`) | **Extend** (additive `externalIssueRef` field) | M48 must not create a second durable defect/fingerprint authority (build spec directive). A published GitHub Issue is provenance *on* the existing defect record, not a parallel list. `DefectSourceKindSchema` already has `"review_finding"`; no new source kind needed. |
| Defect discovery intake from a transient finding | `structuralFindingDefectIntake` (`src/services/structural-finding-intake-service.ts`) | **Reuse the pattern; new adapter** | M43's adapter is hard-bound to `StructuralFinding`'s exact shape. M48 needs the same discipline (freshness-bound, `applyDiscoveryCandidates`-based, produces only `candidate`-status defects) applied to its own finding shape — a new adapter function calling the same `applyDiscoveryCandidates`, not a new intake pipeline. |
| Deterministic fingerprint discipline | `defectContract`'s `computeDefectFingerprint` / `structuralReviewContract`'s `computeStructuralFindingFingerprint` | **Reuse the pattern; new function** | Both existing fingerprints are `computeCanonicalPayloadDigest` over structural-identity-only fields, explicitly excluding narrative text and (for structural findings) the reviewed commit. M48's finding fingerprint follows the identical discipline: `{ domain, checkId, evidenceSignature }`, never `{ title, explanation }`. |
| Transient, non-canonical review finding | `structuralReviewContract` / `structuralReviewEngine` (`src/schema/structural-review.schema.ts`, `src/workflow/structural-review-engine.ts`) | **Reuse discipline; new schema/domain; optional call-through** | M43's 7 domains are deterministic, offline, rule-based (ownership divergence, dependency coupling, etc.) — no domain covers code quality, documentation quality, or governance/config judgment, which require an agent actually reading the material, not a rule engine. M48 defines its own `AuditFinding` contract and `NightReviewDomain` enum (§6.C), built on the exact same transient/non-persisted/freshness-bound/fingerprinted discipline `StructuralFinding` established. Where a ReviewTask's domain overlaps `structuralReviewEngine`'s coverage (tests, repository structure, architecture), the task **may** invoke `aiqt review structural` as one bounded evidence source; M48 never reimplements `structuralReviewEngine`'s rule sets. |
| Scheduling / due-occurrence / active-occurrence singleton | `maintenanceScheduling` (`src/schema/maintenance-schedule.schema.ts`, `src/workflow/maintenance-due-engine.ts`, `src/services/maintenance-run-service.ts`) | **Reuse the pattern; new session contract** | M45's schedule is coupled to its 3 fixed `MaintenanceTaskKind`s and its occurrence record has no concept of budget/coverage/findings. M48 does **not** add `night_review` as a fourth `MaintenanceTaskKind` — that would incorrectly couple a 2-3 hour bounded review session to M45's synchronous, single-occurrence-completes-immediately task-handler contract (`maintenance-task-handlers.ts` assumes a handler returns before the lock's short claim window elapses; a Night Audit session cannot). M48 defines its own `NightAuditSession`/`NightAuditActiveSession` contract, reusing M45's **pattern** directly: a nullable active-session singleton (structural "only one running" guarantee), the same workspace-operation lock reused only for the short claim sequence, and the same stale-claim-reconciles-to-failed discipline (§9). A future milestone may wire "start a Night Audit if due" as a scheduled trigger; M48 itself only builds the session, not the trigger. |
| Repository/member resolution for a selected portfolio target | `pullRequestStatusValidation`'s `pr-source-resolution-service.ts` member-resolution half, backed by `portfolio-service.ts` | **Reuse verbatim** | `resolvePortfolioMemberRoot(portfolioId, memberId)` already resolves exactly one member id to one repository root with no fan-out. M48's `--repository <path>` / `--portfolio-member <id>` selection reuses this function directly, exactly as M47's `pr prepare --portfolio-member` does. Portfolio membership remains a directory, never authority. |
| GitHub provider client discipline (fixed operations, no retry, token redaction, `GithubApiOutcome`) | `pullRequestPreflight`'s `github-pull-request-client.ts`, mirroring `releaseProvenance`'s `github-release-client.ts` | **Reuse the pattern; new client file** | Neither existing client exposes an Issues endpoint. M48 adds `github-issue-client.ts` following the identical discipline: encoded path templates, one request per operation, no retry loop, `redactToken` reused verbatim, `GithubApiOutcome` imported not redefined. This is the only new external write surface in the repository (Issue creation); it is additive, not a modification to the PR or Release clients. |
| Exact repository identity verification, credential handling | `pullRequestPreflight` (`src/workflow/pr-remote-identity.ts`), `pullRequestCreation`'s token-env discipline | **Reuse verbatim** | Same remote-URL-to-`owner/repo` parsing, same environment-variable-only token convention (never a flag, never persisted), same redaction discipline. |
| Ambiguous-result / never-blind-retry mutation discipline | `pullRequestCreation` (`src/services/pr-create-service.ts`) | **Reuse the pattern directly** | "A lookup ALWAYS precedes a create; a create is NEVER retried blind" transfers to Issue creation verbatim (§8). |
| Bounded context manifest / path-safety budgeting | `executionGuidance`'s `execution-context-manifest.ts` (`deriveContextProfile`, `isPathWithinApprovedRoots`, token-estimate budgeting) | **Reuse the pure primitives; do not reuse Work-Unit-specific fields** | A ReviewTask is not a Work Unit and is never added to the work graph — it has no acceptance criteria or dependencies. Only the context-budgeting primitives (path-safety check, token-estimate heuristic, profile sizing) are reused for a ReviewTask's bounded context; `composeExecutionGuidance`'s Work-Unit fields do not apply. |
| Bounded external-agent handoff packaging / result normalization | `packetLifecycle` (`src/services/agent-packet-service.ts`), `externalExecutionAdapters` (`src/workflow/claude-code-result-normalizer.ts`) | **Reuse the packaging/handoff mechanics; new result schema** | A ReviewTask is packaged and handed off the same way a Work Unit packet is (bounded prompt/context, structured expected-result format), but its result is a list of candidate findings and evidence, not a diff/commit — a new, M48-owned result schema, not a repurposing of the Work Unit result shape. |
| Sandboxed/isolated live execution | `sandboxBackendContract`, `workspaceLifecycle` | **Not reused** | Both exist to make repository **mutation** safe. M48 never mutates the repository under review (§2) — a ReviewTask reads the existing checked-out working tree directly, exactly as `aiqt review structural` already does today with no workspace isolation. Introducing sandbox/workspace machinery for a read-only path would be new, unjustified authority. |
| Budget/exhaustion checking (AND-of-limits over independent dimensions) | `autonomousRunContract`'s `autonomous-run-budget.ts` | **Reuse the pattern; new schema** | `AutonomousBudgets`/`AutonomousBudgetUsage` are `.strict()` and shaped around a repair run's dimensions (diff lines, changed files, retries). M48's `NightAuditSessionBudget` has different dimensions (`targetDurationMinutes`, `hardStopMinutes`, `maxReviewTasks`, `maxNewIssues`, `maxOpenAuditIssueBacklog`, optional token budget) but reuses the exact independent-AND-of-limits check function shape. |
| Canonical JSON digest / sha256 | `canonicalJson`, `sha256Digest` | **Reuse verbatim** | `computeCanonicalPayloadDigest` is the sole canonicalization implementation; the finding fingerprint (§6) is built on it directly, no new digest logic. |
| Command-result/exit-code contract | `commandResultContract`, `exitCodeOwner` | **Reuse verbatim** | `aiqt review night *` commands render through the existing `CommandResult`/`renderJson`/`renderHuman` machinery, no new output contract. |
| `review` CLI command family | `reviewCommand` (`src/cli/commands/review.command.ts`) | **Extend** | New subcommand group `aiqt review night run\|status\|cancel\|coverage`, nested exactly as `aiqt review structural` already is — not a new top-level command. |

**Owners explicitly inspected and rejected**, per protocol requirement to name why:

- `autonomousRunContract` (M36) as the session/execution owner — rejected for the same reason M47 rejected it for PR integration: it is `.strict()` and structurally bound to a repair *run* (candidate/safety/sandbox/execution-policy), and M48 never remediates or mutates.
- `maintenanceScheduling`'s `MaintenanceTaskKind` as the session-kind owner — rejected in the table above (synchronous single-occurrence assumption incompatible with an hours-long session).
- A new standalone `.aiqt/night-audit.*` file — rejected; canonical `StateModel` already has the additive-section precedent this needs (§7).

---

## 4. Session and budget contract (Resolved: B)

`NightAuditSession` (transient in-memory orchestration object; its durable projection is `NightAuditActiveSession` in canonical state, §7):

```text
NightAuditSession
  id
  target: { repositoryRoot, portfolioRef: { portfolioId, memberId } | null }
  startedAt
  budget: NightAuditSessionBudget
  usage: NightAuditSessionUsage        // updated as the session runs
  status: "running" | "completed" | "interrupted" | "cancelled"
```

`NightAuditSessionBudget` (all fields explicit at session start; no product-policy default is hard-coded into the engine — CLI defaults may pre-fill `targetDurationMinutes: 120, hardStopMinutes: 180` but the schema requires the caller to supply the full budget object):

```text
targetDurationMinutes     // soft target; session finishes early once nothing useful remains
hardStopMinutes           // absolute ceiling; session force-stops regardless of remaining queue
maxReviewTasks
maxNewIssues
maxOpenAuditIssueBacklog  // see §11
maxContextTokensPerTask?  // optional; only enforced where a provider exposes token telemetry (§13)
```

A session finishes when any of: useful-review queue exhausted (§8's priority queue empty); `maxNewIssues` reached; `maxOpenAuditIssueBacklog` reached (publication suppressed, but review may continue — §11); diminishing-return stop reached (§10); `targetDurationMinutes` elapsed with no remaining priority-due scope; `hardStopMinutes` reached (unconditional). Budget checking reuses the AND-of-limits pattern from `autonomous-run-budget.ts` (§3), applied to `NightAuditSessionUsage`.

No daemon is required. `aiqt review night run` runs synchronously in the invoking process for up to `hardStopMinutes`; a second invocation while one is active reports busy (§9), exactly like `aiqt maintenance run-due`.

## 5. ReviewTask contract (Resolved: C)

```text
ReviewTask
  taskId
  domain: NightReviewDomain     // one of the 6 domains below
  scope: string                  // one bounded area/path prefix, never "the whole repository"
  repositoryCommit                // exact commit the task executes against
  contextManifest                 // built via execution-context-manifest.ts primitives (§3)
```

`NightReviewDomainSchema = z.enum(["code_quality", "tests", "documentation", "repository_structure", "architecture", "governance_config"])` — exactly the six domains named in the milestone brief, no more. `tests`/`repository_structure`/`architecture` tasks may invoke `aiqt review structural` as one evidence source (§3); `code_quality`/`documentation`/`governance_config` tasks are agent-executed reads with no deterministic rule-engine equivalent today.

A ReviewTask is never added to the work graph and never appears in `aiqt next`. It is packaged and handed off using the same bounded-packet mechanics as a Work Unit (§3), with a result schema built for findings rather than a diff (§14).

## 6. Coverage Ledger (Resolved: D) and persistence (Resolved: Persistence/schema decision)

New additive canonical `StateModel` sections (WU48-01-owned schema change):

```text
nightAuditCoverage: NightAuditCoverageEntry[]     // bounded, e.g. MAX_NIGHT_AUDIT_COVERAGE_ENTRIES = 2000
nightAuditActiveSession: NightAuditActiveSessionRecord | null   // nullable singleton, mirrors maintenanceActiveOccurrence
```

`NightAuditCoverageEntry`:

```text
{ domain, scope, lastReviewedCommit, lastReviewedAt, outcomeSummary, findingsProduced: boolean }
```

one entry per `(domain, scope)` pair, upserted after each completed ReviewTask. This directly answers "what area/domain was reviewed, at which commit, when, outcome, whether findings were produced." It lives inside the **target repository's own** canonical state — the same repository `aiqt defects`/`aiqt maintenance` already govern — never a separate home-scoped store, because (unlike the portfolio manifest or a PR integration plan) coverage is per-project operational history, not cross-repository membership or a Git/GitHub side-effect record. A portfolio-selected target's coverage lives in *that member's* `.aiqt/state.json`, resolved via `resolvePortfolioMemberRoot` (§3) exactly as M45/M43 already operate against whatever repository root the command is pointed at.

`nightAuditActiveSession` is the resumability anchor (§9): a session in progress is a durable claim, not in-memory-only state, so a crash is reconciled rather than silently forgotten.

**Published-issue provenance** does not get its own ledger: it is the additive `externalIssueRef` field on `DefectRecord` (§3), because the defect record is already the fingerprinted, canonical, single-source-of-truth home for "is this known" — a second list would be exactly the dual-source-of-truth this planning pass was told to avoid.

**Schema version**: `AIQT_SCHEMA_VERSION` bumps `0.7.0 -> 0.8.0` (minor). This follows the established precedent (§7.1 of the Architecture Specification): every prior milestone that added a new top-level `StateModel` section (M42's `defects`, M45's `maintenanceSchedules`/`maintenanceActiveOccurrence`) paired it with a minor schema bump; M48 adds two such sections (`nightAuditCoverage`, `nightAuditActiveSession`) plus one additive field to an existing section (`defects[].externalIssueRef`), all backward-compatible and optional, so the bump is minor, decided and recorded at WU48-01.

## 7. Finding lifecycle (Resolved: E)

```text
AuditFinding (candidate, transient)
  -> quality gate (§8: accept | reject)
  -> dedup check (§9: against M42 fingerprint, GitHub search, defect.externalIssueRef)
  -> [accepted + not duplicate] M42 intake (new adapter reusing applyDiscoveryCandidates,
     sourceKind "review_finding") -> candidate-status DefectRecord
  -> GitHub Issue publication is a PROJECTION of that DefectRecord (title/summary/evidence/
     fingerprint), never a projection of the raw AuditFinding directly
  -> on successful create/reconcile: DefectRecord.externalIssueRef written back
```

`AuditFinding` never becomes canonical state on its own — exactly like `StructuralFinding`, it is a `CommandResult.data` payload only, for the duration of one ReviewTask's execution. The single source of truth for "is this a known, tracked issue" is the M42 defect list; GitHub Issues are a downstream, one-way projection of that list, never a second place that can independently answer "is this new."

## 8. Finding quality gate (Resolved: F)

Pure function, `evaluateAuditFinding(finding) -> "accept" | "reject"`, reusing `StructuralFindingConfidence`/`StructuralFindingSignificance`-equivalent typed fields on `AuditFinding` (not the same enums verbatim — different domain vocabulary — but the identical two-axis confidence × significance discipline). Rejects when: `disposition !== "actionable"`; `confidence` is below `strong_signal`-equivalent; `evidence` is empty; `significance` is `informational`-equivalent AND governance has not explicitly opted that class in (none does at M48). No finding is published merely because an agent asserted it — the gate is evaluated the same way regardless of which task produced the finding.

## 9. Deduplication and idempotency (Resolved: G, and Failure/idempotency semantics)

Three checks, in order, before intake:

1. **M42 fingerprint** — `computeAuditFindingFingerprint({ domain, checkId, evidenceSignature })` (never title/explanation text, mirroring `computeDefectFingerprint`/`computeStructuralFindingFingerprint`) is compared against existing defect fingerprints. A match means "already known" regardless of GitHub state.
2. **`defect.externalIssueRef` presence** — if the matched (or newly-intaken) defect already carries a recorded Issue reference, publication is skipped; the defect is not re-published.
3. **GitHub search** — only reached when (1)/(2) find nothing locally: search the target repository's issues for the fixed `aiqt-night-audit` label (§11) plus the fingerprint marker embedded in the issue body (§14). This is the safety net for a prior run that created an Issue but crashed before recording `externalIssueRef` — never the primary dedup mechanism, exactly because semantic "looks similar" search is explicitly disallowed as a sole safety mechanism.

**State table — Issue create:**

| Situation | Outcome |
|---|---|
| No local match, GitHub search finds nothing | Create. Verify via a second lookup (`getIssue`) before finalizing. |
| No local match, GitHub search finds exactly one match (label + fingerprint marker) | Reconcile: adopt the existing Issue onto the defect's `externalIssueRef`, do not create. |
| No local match, GitHub search finds more than one match | **Ambiguous.** Block; do not create; do not guess. Surfaced in the session result as an unresolved item requiring manual reconciliation. |
| Create call fails (network/timeout) | Re-run the GitHub search (never blind-retry the create). Found → adopt. Not found → ambiguous, record as `push_ambiguous`-equivalent `create_ambiguous`, retry only on a **later invocation** after reconciliation, never within the same session. |
| Local match found, `externalIssueRef` present | Skip publication entirely; not a duplicate-detection failure, this is the expected common case. |
| Local match found, `externalIssueRef` absent (defect known, never published) | Proceed to GitHub search (step 3) before create — the defect existing locally does not prove no Issue exists. |

**State table — partial/session failure:**

| Situation | Outcome |
|---|---|
| Process crash mid-session, `nightAuditActiveSession` left non-null | Next invocation detects the stale claim (age check, mirroring `maintenance-run-service.ts`'s `STALE_OCCURRENCE_MS` pattern, scaled to session-length budgets), reconciles it to `interrupted`, records what coverage/findings/publications happened before the crash (durable — already-written coverage entries and defect/Issue records are not rolled back), and clears the slot. Never resumes an in-memory execution state that no longer exists. |
| Session hits `hardStopMinutes` mid-ReviewTask | The in-flight task is abandoned (not force-completed); its target `(domain, scope)` is **not** marked reviewed in the coverage ledger (partial work is not recorded as coverage) — it remains eligible for the front of the queue next session. |
| A single ReviewTask's external agent handoff errors | Recorded as an attempted-but-failed task in the session result; does not stop the session; the `(domain, scope)` is not marked reviewed (retry-eligible next session). |

## 10. Diminishing returns (Resolved: K)

Explicit, explainable stop condition — never an opaque model self-assessment: stop early when **5 consecutive ReviewTasks produce zero accepted findings** *and* the priority queue (§ WU48-02) has no remaining priority-1/2 (changed-since-last-review / never-reviewed) scope — i.e. only stale-rotation-priority scope remains. The exact "5" is a configuration constant owned by WU48-02, adjustable by measurement, not hard product policy baked into the engine.

## 11. Backlog-aware behavior (Resolved: J)

The fixed `aiqt-night-audit` label is both the idempotency marker (§9) and the backlog-count mechanism: at session start, one bounded GitHub search (open issues, that label) returns the current count. If `count >= maxOpenAuditIssueBacklog`, the session sets `issuePublicationSuppressed = true` for its duration — ReviewTasks, coverage-ledger updates, and quality-gated/deduped findings still happen normally (their value is not backlog-limited), but no `create` call is ever issued. The suppression state and the measured backlog count are both surfaced in the morning result (§14) so a human sees *why* no new Issues appeared.

## 12. GitHub Issue mutation boundary (Resolved: H)

New capability, `github-issue-client.ts` (§3), exposing exactly:

- `searchIssues(owner, repo, label, token)` — read, bounded to the fixed label;
- `getIssue(owner, repo, number, token)` — read, single-issue verification;
- `createIssue(owner, repo, title, body, labels: ["aiqt-night-audit"], token)` — write, the **only** mutating call.

Explicitly, permanently out of scope for this client and this milestone (no schema field or function makes any of these expressible): edit an existing issue's title/body; close/reopen; delete; assign a developer; add any label other than the one fixed `aiqt-night-audit` label; comment on an issue; create a Pull Request; anything under GitHub's merge or review endpoints. `requestReviewers`-style "separate side effect, independently recoverable" does not apply here — Issue creation has exactly one side effect (the Issue itself); there is no second sub-step to partially fail.

## 13. GitHub Issue format (Resolved: I)

```text
Title:    concise, <= 256 chars (mirrors MAX_PR_TITLE_CHARS bound)
Body:
  ## Review domain
  <domain>
  ## Why it matters
  <finding.explanation, bounded>
  ## Evidence
  <finding.evidence: path/locator list, bounded, never raw file content dumps>
  ## Impact
  <finding.significance-equivalent, human phrase>
  ## Suggested remediation direction
  <finding.recommendedNextAction, bounded>
  ## Validation idea
  <one bounded suggestion, not a full test plan>
  <!-- aiqt-fingerprint: sha256:... -->
  <!-- aiqt-defect-id: ... -->
Labels:   ["aiqt-night-audit"]
```

The HTML-comment fingerprint/defect-id marker is the provenance the GitHub-search dedup fallback (§9) parses; it is never rendered as visible Issue text. No agent reasoning transcript, no raw log dump, no full diff — bounded, structured fields only, mirroring the Pull Request body-digest discipline (§3) rather than inventing a new verbosity model.

## 14. Morning result (Resolved: L)

`NightAuditResult` (the primary operator-facing output of `aiqt review night status` / the completion of `run`):

```text
{
  sessionId, startedAt, finishedAt, stopReason,   // "budget_exhausted" | "queue_exhausted" |
                                                    // "diminishing_returns" | "hard_stop" | "cancelled"
  tasksAttempted, tasksCompleted,
  domainsReviewed: NightReviewDomain[],
  candidateFindings, acceptedFindings, rejectedFindings,
  duplicatesSuppressed: { byFingerprint, byExistingIssueRef, byGithubSearch },
  newIssuesCreated: { number, url }[],
  issuePublicationSuppressed: boolean, currentAuditIssueBacklog,
  budgetRemaining: NightAuditSessionUsage,          // vs. NightAuditSessionBudget
  unreviewedHighPriorityScope: string[],            // what's still queued, not what ran
  ambiguousReconciliationsNeeded: string[],          // §9's ambiguous-create/search cases
}
```

## 15. Telemetry (Resolved: M)

Per `ReviewTask`, recorded where the external adapter actually reports it (never fabricated): `domain`, `scope`, context manifest size (always available — computed locally, not provider-dependent), execution profile used (§16), provider/model identity where the adapter reports one, wall-clock duration (always available), token usage **only** when `externalExecutionAdapters`' normalizer surfaces an authoritative count, finding outcome (accepted/rejected/none). `tokens per accepted finding` is a derived report-time metric, not a stored field, and is omitted (not zero-filled) for sessions where no task reported authoritative token usage. M48 does not build a router or a cross-provider cost model — that is M49's explicit scope.

---

## 16. Work Unit decomposition

| WU | Objective | Owners touched | Non-goals | Risk target |
|---|---|---|---|---|
| **WU48-01** | Session/budget contract, `ReviewTask` contract, `NightAuditCoverageEntry`/`NightAuditActiveSession` schema, `defects[].externalIssueRef` additive field, schema bump 0.7.0→0.8.0 | New `night-audit.schema.ts`; extend `state.schema.ts`, `defect.schema.ts` | No engine logic, no CLI command yet, no GitHub client | green/yellow |
| **WU48-02** | Change-aware coverage queue: priority scoring (changed-since-review → never-reviewed → stale → recent-defect-signal → high-churn → rotation), diminishing-return counter, deterministic budget-aware selection | New `night-audit-coverage-queue.ts`, `night-audit-budget.ts` (reusing `autonomous-run-budget.ts`'s AND-of-limits shape) | No task execution yet | green/yellow |
| **WU48-03** | Bounded ReviewTask execution: context manifest (reusing `execution-context-manifest.ts` primitives), packaging/handoff (reusing `agent-packet-service.ts`), result normalization into `AuditFinding[]`, `aiqt review structural` call-through for overlapping domains, coverage-ledger upsert | New `night-audit-review-task-execution.ts`; extend `agent-packet-service.ts` call sites | No repository mutation (enforced: the execution path never invokes a write-capable adapter) | yellow |
| **WU48-04** | Quality gate, fingerprint, M42 intake adapter (`applyDiscoveryCandidates`, `sourceKind: "review_finding"`), local dedup (fingerprint + `externalIssueRef` presence) | New `night-audit-quality-gate.ts`, `night-audit-fingerprint.ts`, `night-audit-defect-intake-service.ts` | No GitHub calls yet | yellow |
| **WU48-05** | `github-issue-client.ts` (search/get/create), lookup-before-create/ambiguity-reconciliation service, session orchestration (`aiqt review night run\|status\|cancel\|coverage`, resumability via `nightAuditActiveSession`, stale-claim reconciliation), backlog-aware suppression, `NightAuditResult` | New `github-issue-client.ts`, `night-audit-issue-publication-service.ts`, `night-audit-session-service.ts`, CLI commands | No new label types, no edit/close/assign capability (must be structurally absent, not just untested) | **orange** — this is the Work Unit with the actual new irreversible external-mutation authority; escalation-eligible per §12 |
| **WU48-06** | Live night-audit dogfood (§17), telemetry evidence, closure validation | — | No AIQT-repository usage; no fabricated defect | orange (live external write, bounded by design) |

Each WU: focused validation per protocol §4 (own tests, `tsc --noEmit`, `eslint .`, affected suites); full suite + typecheck + lint + build only at closure. `pnpm version:check -- --base main` run before the PR, per WU48-01's schema bump.

---

## 17. Validation matrix

| Layer | Coverage |
|---|---|
| Unit | Fingerprint determinism (excludes narrative text, matches `computeDefectFingerprint`/`computeStructuralFindingFingerprint` discipline); quality-gate accept/reject boundary; budget AND-of-limits; priority-queue ordering and diminishing-return counter; coverage-entry upsert idempotency; schema `.strict()` round-trip for the two new sections and the extended `defects[].externalIssueRef` field. |
| Integration | `night-audit-session-service.ts` stale-claim reconciliation (mirroring `maintenance-run-service.ts`'s test pattern); M42 intake adapter produces exactly one `candidate` defect per fingerprint across repeated runs; `aiqt review structural` call-through from a `tests`/`architecture` ReviewTask. |
| Local Git/provider fixture | `github-issue-client.ts` against a fixture/mock provider: create, search-finds-none, search-finds-one (reconcile), search-finds-many (ambiguous/block), create-then-network-error-then-reconcile-search. Token redaction on every returned/thrown message. |
| Live GitHub dogfood | WU48-06, §18. |
| Closure | Full suite, typecheck, lint, build, `pnpm version:check` (schema bump + package version consistency), clean-clone per `high_risk` ceremony. |

---

## 18. Live dogfood design (WU48-06)

**Never the AIQT repository itself** (self-management prohibition, Product Spec §10/§21).

**Target**: a disposable or existing external AIQT-managed test project (an already-`aiqt init`-ed repository with real source/docs/tests small enough to review meaningfully within a bounded session but substantial enough to produce at least one legitimate finding — e.g. an existing portfolio-registered sample project, or a freshly created disposable fixture repository pushed to a throwaway GitHub repo the operator controls). GitHub Actions is not exercised by the dogfood itself (no CI is triggered by an Issue-only write).

**Proves, at minimum** (mapped to the milestone's required list):

1. bounded session starts, and a deliberately-interrupted session resumes/reconciles correctly (kill the process mid-session; re-run; confirm `interrupted` reconciliation, not silent loss);
2. `nightAuditCoverage` entries are recorded with correct commit/timestamp/outcome after real execution;
3. ReviewTasks stay small (scope is one bounded area, never the whole repository — asserted from the actual manifest sizes used);
4. at least one finding is produced, passes (or is correctly rejected by) the quality gate;
5. running the same session twice against unchanged state does not re-publish or re-intake the same finding (duplicate suppression proven, not assumed);
6. with `maxOpenAuditIssueBacklog` set artificially low, publication suppression is observed and reported, while review continues;
7. at least one real GitHub Issue is created from a **legitimate** finding the fixture project actually contains — never a fabricated defect planted to force the path; if the fixture genuinely contains nothing that clears the quality gate, the dogfood proves the suppression/rejection paths instead and this is reported honestly, not worked around;
8. repeated execution against the same repository state does not duplicate that Issue (re-run after step 7, confirm skip via `externalIssueRef`, and separately confirm the GitHub-search fallback path with a scenario where the local record is deliberately cleared);
9. `git status`/`git diff` on the target repository shows zero changes at every point — no repository content is ever modified;
10. no PR, merge, or Release occurs at any point;
11. token/cost telemetry fields are populated only where the actual adapter response carried them, and are visibly absent (not zero) otherwise.

---

## 19. Milestone Execution Profile (Resolved: §7 answered)

```yaml
baselineCapability: balanced
baselineEffort: high
escalationCapability: deep_reasoning
```

One continuous milestone session where feasible, targeted owner/context loading per WU, a compact continuation capsule at any natural session boundary, no broad reinvestigation between WUs. Validation: focused + impacted per WU, full authoritative validation only at closure (protocol §4/§12).

**Does M48 actually need escalation points?** Reviewed against the milestone's real architecture, decided in this planning pass: **mostly no.** WU48-01 through WU48-04 and WU48-06 follow established, closely-analogous precedent (M42 intake, M43 transient-finding discipline, M45 session/lock/reconciliation pattern, M47's ambiguity-never-retry-blind discipline) closely enough that the baseline profile should carry them without escalation. The one place genuine escalation-worthy reasoning difficulty remains is **inside WU48-05**: the exact ambiguous-search-result reconciliation logic (§9's "more than one match" and "create-then-network-error" cases) is a new instance of an idempotency/partial-side-effect pattern, not a mechanical copy of M47's — GitHub's Issues search API has different pagination/consistency behavior than the PR-lookup endpoints M47 used, and getting the "never guess toward success" boundary exactly right here is the kind of decision this milestone should not leave to routine implementation judgment.

**Escalation triggers, pre-named** (per protocol §12; `risk >= 50` alone is explicitly not one):

- resolving the exact ambiguous-search/ambiguous-create reconciliation semantics in WU48-05 before implementing them (a single bounded escalation, not a standing elevated tier for the whole WU);
- any point where the coverage-ledger/defect-schema interaction in WU48-01 does not cleanly resolve the way §6/§3 predict once the actual `state.schema.ts` structure is touched (an unresolved state-owner conflict);
- if the dogfood (WU48-06) surfaces an irreversible-mutation edge case not covered by §9's state tables.

No other Work Unit is pre-authorized to escalate merely for being part of a `high_risk` milestone.

---

## 20. Unresolved decisions

None. Every decision Phase 3 (A-M) of the planning brief required has a resolution above (§4-§15), each traceable to an existing owner or a named, reasoned new owner. WU48-01 does not need to invent architecture; it implements §4-§7 as specified.

---

## 21. Files changed by this planning pass

`docs/product/AIQT_Product_Specification_v0.8.md` (new), `docs/product/AIQT_Technical_Architecture_Specification_v0.5.md` (new), `docs/archive/historic-baseline/AIQT_Product_Specification_v0.7.md` (moved), `docs/archive/historic-baseline/AIQT_Technical_Architecture_Specification_v0.4.md` (moved), `docs/governance/milestone-protocol.md` (one cross-reference number fix), `README.md` (roadmap delta), `package.json` (version bump), `docs/milestones/active/m48/build-spec.md` (new, this file).

No product source changed. No `.aiqt/` state created anywhere. No schema bump applied yet — `AIQT_SCHEMA_VERSION` remains `0.7.0` until WU48-01 actually implements the additive sections this spec designs; this planning pass only records the decision to bump when that happens.
