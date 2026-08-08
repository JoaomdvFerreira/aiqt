# M42 — Defect Discovery, Triage, and Remediation Queue — Closure Report

**Status:** Closed on branch `milestone/m42-defect-remediation-queue`. Not merged. No PR opened yet.

## Baseline / final commits

- Branch created from `main` at `29013af` (`Merge pull request #11 from JoaomdvFerreira/governance/pr-review-template`).
- M41/PR #11 entry baseline verified live: PR #11 MERGED; post-merge `Validate` CI on `main` green at `29013af`; Product Specification v0.7 / Technical Architecture Specification v0.4 active; M41 merged and `v0.35.0` published (tag present); package/schema versions read live from `main` (`0.35.0`/`0.5.0`), not assumed; working tree clean; no `.aiqt/` self-management state in this repository.
- Pre-M42 housekeeping (`b4d093c`): M39 archived `docs/milestones/completed/m39/` → `docs/archive/milestones/m39/` per the rolling hot-completed policy; the one live reference in `repository-owner-map.json` repaired; M40/M41 remain hot.
- Package version: `0.35.0` → `0.36.0` (minor: new backward-compatible capability -- the `aiqt defects` command family; no breaking change).
- Schema version: `0.5.0` → `0.6.0` (new canonical `StateModel.defects` section introduced -- additive, optional, absent entirely on pre-M42 state; see WU42-01 and the dedicated compatibility test).

## WU commits/tags/risk

| Unit | Commit | Tag | Risk |
|---|---|---|---|
| Pre-M42 housekeeping (archive M39) | `b4d093c` | *(none -- not a Work Unit)* | — |
| WU42-01 — Defect Contract, Canonical Queue, and Compatibility | `2135f12` | `m42-wu01-defect-contract-canonical-queue` | 12/100 Green |
| WU42-02 — Bounded Discovery, Deduplication, and Freshness | `82d3148` | `m42-wu02-bounded-discovery-dedup-freshness` | 18/100 Green |
| WU42-03 — Deterministic Triage and Remediation Queue | `5b2faba` | `m42-wu03-deterministic-triage-remediation-queue` | 22/100 Green |
| WU42-04 — Controlled Remediation and Validation Closure | `1f9740d` | `m42-wu04-controlled-remediation-validation-closure` | 24/100 Green |
| WU42-05 — Dogfood, Safety Regression, Closure, Pre-PR Audit | *(this commit)* | `m42-wu05-dogfood-safety-closure`, `m42-defect-remediation-queue` | 15/100 Green |

## Defect contract and persistence outcome

`src/schema/defect.schema.ts` is the sole defect/remediation-queue schema owner: `DefectRecord`/`DefectSourceKind`/`DefectSeverity`/`DefectConfidence`/`DefectStatus`/`DefectEvidenceRef`/`DefectTriageDecision`/`RemediationDecision`/`RemediationEvidence`/`DefectResolution`/`DefectState`. `RemediationQueueEntry` is deliberately not a separate stored list -- the remediation queue is `state.defects` filtered to queue-eligible status (`src/workflow/defect-transitions.ts`'s `QUEUE_ELIGIBLE_STATUSES`), so no parallel canonical file/database was introduced anywhere in M42. `src/workflow/defect-transitions.ts`'s `DEFECT_TRANSITIONS` table governs the full Section 4.2 lifecycle; illegal transitions fail closed (tested). `src/workflow/defect-fingerprint.ts`'s `computeDefectFingerprint` is the sole, deterministic (canonical-JSON + sha256) dedup identity, built only from structural fields (source kind, affected Work Unit, validation target, a bounded evidence signature) -- never from free text, so unrelated failures with similar wording never collide (tested). `AIQT_SCHEMA_VERSION` 0.5.0→0.6.0 is the only schema change across all of M42; old (pre-M42) state with no `defects` key parses and every `aiqt defects` command behaves correctly against it (dogfood scenario 8, plus `tests/unit/versioning.test.ts`'s dedicated `0.5.0`-as-`older_compatible` case).

## Discovery/triage/dedup outcome

- **Discovery** (`src/workflow/defect-discovery.ts`, WU42-02): supported sources are `failed_validation` (checkpoint `validationCommands` with result `failed`/`partial`) and `checkpoint_issue` (open checkpoint issues), plus explicit `human_reported` input. `review_finding`, `autonomous_execution_failure`, and `imported_external_evidence` are explicitly reported unsupported (`assessDiscoverySource`), never silently ignored or fabricated. Discovery never scans source files -- it only ever reads already-canonical checkpoint evidence or explicit CLI input.
- **Freshness**: a checkpoint superseded by a newer checkpoint for the same Work Unit is reported `stale` with an explicit reason (never a silent current confirmation); triage (`computeTriageDecision`) downgrades reproducibility exactly one level when evidence is stale.
- **Dedup**: `src/services/defect-discovery-service.ts`'s `applyDiscoveryCandidates` collapses identical fingerprints deterministically -- a match enriches the existing canonical record (evidence appended, bounded to `MAX_EVIDENCE_REFS_PER_DEFECT`, history preserved) regardless of the record's current status, so an `invalid` disposition is never silently reopened by new matching evidence.
- **Triage** (`src/workflow/defect-triage.ts`, WU42-03): pure, deterministic function of a defect's own canonical fields -- severity is never reinvented by triage (stays the defect's own recorded value, Section 3.4); disposition rules route `insufficient_evidence` confidence and `suspected`-confidence critical/high defects to `needs_human` (never fabricating certainty); `approvalAuthority` (defect-triage authority) is a separate contract from remediation implementation risk (WU42-04). Queue ordering (`sortByQueuePriority`) is priority-descending, then age-ascending, then `defectId`-ascending -- fully deterministic and input-order-independent (tested).

## Remediation integration outcome

`src/workflow/remediation-risk.ts` (WU42-04) computes remediation implementation risk from scope alone (path breadth, foundational-path touch, Work-Unit boundedness) -- completely independent of defect severity/confidence, using the exact repository four-band boundaries (0-24/25-49/50-74/75-100, human boundary at 50). `src/services/defect-remediation-service.ts`'s `prepareRemediation` requires status `"queued"`; risk ≥50 requires an explicit `--approved-by` human identity or nothing is persisted and the defect is left completely untouched (fail-closed, zero side effect). No live execution occurs anywhere in M42 -- `prepareRemediation` performs no process spawn, sandbox call, or filesystem mutation beyond the defect record itself; this is the Section 8 bounded external-agent handoff/request path, honestly implemented as a request-preparation step (no live M36/M38 sandbox/autonomous execution surface was wired in, since no real coding-agent invocation exists in this milestone's scope -- wiring a live pass-through would have meant fabricating an integration this milestone does not actually exercise). `recordRemediationValidation` makes validation evidence, never agent assertion, the sole resolution authority: `"passed"` resolves with bound evidence; `"failed"` returns the defect to `"queued"`, preserving the failure evidence, never silently closing it.

## CLI surface

One coherent family, `aiqt defects ...` (8 subcommands, all human/`--json` parity from the identical canonical `DefectRecord`/queue data): `discover`, `list`, `inspect`, `triage`, `queue`, `transition`, `remediate`, `record-validation`. Read-only surfaces (`list`, `inspect`, `queue`) never mutate state. No command auto-merges a PR, deploys, or publishes a Release.

## Dogfood scenario/measurement results (build spec Sec 10)

All 12 required scenarios plus the M43 boundary proof are real, passing tests in `tests/integration/m42-defect-lifecycle-dogfood.test.ts`, run against disposable non-AIQT fixture project directories (never this repository's own state):

1. Current failed focused test → defect candidate with evidence. ✅
2. Checkpoint/review acceptance failure → defect candidate. ✅
3. Identical defect from two supported sources → one canonical defect plus linked evidence (2 evidence refs, 1 record). ✅
4. Stale prior failure → not treated as current confirmed defect without an explicit reason. ✅
5. Ambiguous evidence (`suspected` confidence, critical severity) → `needs_human`, evidence gap recorded, remediation attempt rejected with zero side effect. ✅
6. Confirmed critical defect → deterministic higher queue priority than a confirmed low-severity one. ✅
7. Explicit false positive → `invalid` disposition preserved with evidence; new matching evidence enriches but does not silently reopen it. ✅
8. Queue persists/resumes across a canonical reload, including the pre-M42 (0.5.0, no `defects` key) compatibility path. ✅
9. Low-risk bounded remediation → automatic controlled/handoff path (no approval required). ✅
10. Remediation risk ≥50 → blocked with zero side effect until `--approved-by` is supplied, then proceeds. ✅
11. Remediation validation failure → defect remains open (`queued`), failure evidence preserved. ✅
12. Remediation validation success → defect `resolved` with bound validation evidence. ✅
13. Boundary proof: a checkpoint with no failures/issues yields zero defects even though "the code" could contain arbitrary code smells; `review_finding` (structural-review-shaped evidence) remains explicitly unsupported -- M43 scope, not discovered by M42. ✅

**Measurements** (honest, from the dogfood run and full defect-suite, never invented): 91 M42-specific tests (14 unit/integration files), 100% pass; queue sizes observed across scenarios ranged 0-2 (small, deterministic fixtures, as required -- M42 is a lifecycle proof, not a load test); 1 duplicate-collapse observed (scenario 3: 2 evidence refs on 1 canonical record, 0 duplicate queue entries); 1 explicit human-gate observed and exercised end-to-end (scenario 5's `needs_human` triage disposition, scenario 10's risk-based approval gate); remediation outcomes observed: 1 auto-proceed (green), 1 blocked-then-approved (orange/red), 1 validation-failed-reopen, 1 validation-passed-resolve.

## Human-gate and unauthorized-side-effect proof

Zero remediation side effects occurred without an explicit eligible queue/approval decision in any test, including the dedicated blocked-attempt assertions (scenario 5's remediate-on-`needs_human` rejection, scenario 10's remediate-on-unapproved-high-risk rejection, both asserting the defect record is byte-for-byte unchanged after the rejected attempt).

## Validation and safety-regression evidence

- `pnpm typecheck` / `pnpm lint` / `pnpm build`: clean throughout every WU and at closure.
- `pnpm version:check` (local): **PASSED** (`currentVersion: 0.36.0`, all checks true).
- `pnpm version:check -- --base main`: **PASSED** (`baseVersion: 0.35.0` → `currentVersion: 0.36.0`, `increment: minor`, `relevantChangesDetected: true`, `requiredBumpPresent: true`).
- `tests/unit/package-version.test.ts` (focused, required since package version changed): **PASSED**.
- Authoritative full suite (`pnpm validate`, Node 24, this machine): **3294/3330 tests passed** (317/321 files), 32 pre-existing Docker-dependent skips (unrelated, same class already reconciled at M38/M40/M41 closure). 4 failures, all reconciled:
  - **1 real M42 regression, found and fixed by this WU's own closure validation**: `tests/unit/m35-test-inventory-classification.test.ts`'s "no file falls through to uncategorized" guard caught 5 new `defect-*.test.ts` files with no matching domain rule. Fixed in `src/tooling/test-inventory-classifier.ts` (one new `defect-lifecycle` domain rule); re-run confirmed green.
  - **1 pre-existing, already-documented Windows-only artifact** (identical to the one reconciled at M40/M41 closure, not caused by M42): `tests/unit/m34-validation-workload-inventory.test.ts`'s "trailing-line inline-timeout shape" baseline expects `tests/integration/cli.test.ts` among 2 matching files but finds only 1 on this machine, because `git config core.autocrlf=true` converts the file's LF-stored trailing-comma-timeout shape to CRLF at checkout, changing the regex match; `cli.test.ts` was not touched by M42, and this is expected to pass on the Linux-only `.github/workflows/validate.yml` CI.
  - **2 pre-existing timeout flakes** (`tests/integration/evidence-advisory-hardening.test.ts`, 2 tests): both files are untouched by M42; both tests re-run individually and pass cleanly (13.4s and 16.3s respectively, well under the 30s timeout) once full-suite parallel-worker contention is removed -- the same class of Windows-dev-machine load flakiness already reconciled in M40/M41's own closure reports.
- M36-M38 boundary-scan/safety suites and M39-M41 suites (`autonomous-run-boundary-scan.test.ts`, `sandbox-wu01/02-boundary-scan.test.ts`, execution-guidance/test-impact suites, etc.) all ran as part of the full authoritative suite above and pass unmodified -- M42 touched none of those files, confirming no weakening of existing safety invariants.
- Real GitHub Actions CI has not yet run for this branch (no PR opened yet).

## Defects found/fixed during M42 itself

1. **Transition-table gap** (found by WU42-03's own tests): `DEFECT_TRANSITIONS.triaged` (defined in WU42-01) omitted `"needs_human"`, making the entire human-gate path unreachable from `triaged`. Fixed in `src/workflow/defect-transitions.ts`; no WU42-01 test asserted the old (incomplete) set, so the fix was purely additive.
2. **Test-inventory classification gap** (found by WU42-05's own closure validation): 5 new `defect-*.test.ts` files fell through to `"uncategorized"`, tripping the M35 "no silent uncategorized file" guard. Fixed with one new domain rule in `src/tooling/test-inventory-classifier.ts`.

No other defects found. No stabilization Work Unit was required.

## Known limitations / residual risk

- Discovery covers 3 of the 6 sources listed in the build spec's Section 5 "narrowest practical subset" (`failed_validation`, `checkpoint_issue`, `human_reported`); `review_finding`, `autonomous_execution_failure`, and `imported_external_evidence` are explicitly reported unsupported rather than implemented, matching Section 5's "unsupported evidence sources must be reported as unsupported" requirement -- a real future need for these sources is a natural follow-up, not a silent gap.
- Remediation risk scoring uses a fixed, literal path-pattern/breadth heuristic (`FOUNDATIONAL_PATH_PATTERNS`), the same style of bounded, deterministic classifier this repository already uses elsewhere (e.g. M41's blast-radius list) -- it is not a static-analysis engine and will not catch every real high-risk change shape a human reviewer would.
- `prepareRemediation` prepares a bounded remediation request but does not launch a live sandboxed/autonomous execution -- Section 8's "delegate to a live controlled-execution path where applicable" was not exercised because no such path currently accepts a defect-shaped, bounded remediation input; this is an honest scope boundary, not a fabricated integration, and is the natural next integration point for a future milestone.
- The same two pre-existing, non-M42 local-validation discrepancies (documented above, both already reconciled at M40/M41 closure) mean this specific Windows development machine cannot currently produce an all-green `pnpm validate` run; the authoritative Linux CI is expected to be unaffected.

## Pre-PR audit result

Performed in one pass before this report:
- Every Definition of Done item (build spec Sec 15) verified against live implementation/test evidence in this report's sections above.
- Supported defect lifecycle/status transitions verified (`DEFECT_TRANSITIONS` table, illegal-transition tests, the WU42-03 transition-gap fix).
- Canonical persistence and schema compatibility verified (WU42-01 compatibility tests, dogfood scenario 8's explicit 0.5.0-state reload).
- Package `0.36.0` / schema `0.6.0` confirmed live via `package.json` and `schema-version.ts`.
- Four-band risk boundaries and approval behavior verified for both defect triage (`approvalAuthority`) and remediation risk (`classifyRemediationRiskBand`, dogfood scenarios 5/10) -- confirmed independent contracts (Section 3.4).
- WU commits/tags and milestone tag confirmed against `git tag -l` output (below); working tree clean at time of this report.
- Dogfood metrics and seeded-defect evidence recorded above, honestly measured, no invented numbers.
- Safety regressions: none attributable to M42 (see Validation section).
- `docs/milestones/active/m42/` removed; `docs/milestones/completed/m42/{build-spec.md,closure-report.md}` present; no stale reference to the original `AIQT_Milestone_42_Build_Specification_v0.1.md` filename remains (moved directly, no intermediate stale path).
- No untracked/generated evidence remains staged; only reviewed source/test/doc changes are committed.
- Package-version focused test, `pnpm version:check` (local), and `pnpm version:check -- --base main` all run and passed (see Validation section).
- No automatic PR/merge/release behavior introduced anywhere in M42 -- every `aiqt defects` command is local, canonical-state-only, and requires an explicit human-initiated CLI invocation.

## Final risk score/status

**M42 aggregate risk: 20/100 — 🟢 Green.** Highest single-WU contribution was WU42-04's 24/100 (the remediation risk gate itself, still green: the default/unapproved path for risk ≥50 is a strict no-op, and the gate introduces no new execution/filesystem/network authority). No WU exceeded its own target; discovery/triage/remediation preparation are pure/additive; the one live-mutating surface (`aiqt defects` state writes) reuses the existing canonical `writeStateModel`/transition-validation pattern verbatim.

## Documentation/archive status

- `docs/milestones/completed/m39/` → `docs/archive/milestones/m39/` (pre-M42 housekeeping, `b4d093c`).
- `docs/milestones/active/m42/build-spec.md` → `docs/milestones/completed/m42/build-spec.md` (this commit); `docs/milestones/active/` is now empty and removed.
- `docs/milestones/completed/m42/closure-report.md` (this file).
- M40 and M41 remain hot in `docs/milestones/completed/`; M40 archives when M43 starts, per the rolling two-completed-milestone policy.
- A separate Governance Baseline Reconciliation (owner map, versioning policy, maintainer runbook, milestone protocol, prompt template, test-rationalization policy, machine contract, coverage baseline) was explicitly scoped and deferred by the user to run once, coordinated, against M42's final `main` state after this branch merges -- not performed during M42 itself, to avoid two moving baselines during a milestone that itself changed canonical schema shape.

## PR readiness

**READY FOR PR.** Working tree clean, all 5 WU tags pushed (`m42-wu01`…`m42-wu05`), closure commit/tag to follow this report. `main` re-verified unchanged since branch creation (PR #11 merge commit `29013af` remains `main`'s tip).

## M43 entry recommendation

M42 is complete and self-contained; it introduces no dependency M43 needs to unwind. M43 (Project Structural Review and Issue Discovery, per M42's own Section 2 out-of-scope boundary) may begin once this branch is merged and formally closed. Recommended M43 entry sequence: (1) merge this PR, (2) run the deferred Governance Baseline Reconciliation pass against the merged `main` (owner map now needs a `defectContract`/`defectRemediationQueue` entry in addition to the M40/M41 entries it is already missing), (3) archive M40 to `docs/archive/milestones/m40/` per the rolling policy, (4) start M43 from the reconciled baseline -- entering M43 with a stale owner map (missing M40-M42 owners) would be exactly the kind of documentation drift M43 itself is designed to catch by accident rather than by design.
