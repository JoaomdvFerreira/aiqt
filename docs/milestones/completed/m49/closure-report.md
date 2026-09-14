# AIQT M49 — Trustworthy Qualification Core

**Closure report**

| Field | Value |
|---|---|
| Milestone | M49 |
| Classification | `medium / core-correctness` |
| Branch | `milestone/m49-trustworthy-qualification-core` |
| Baseline | `main` @ `8df9b31` |
| Package version | `0.46.4 → 0.47.0` (minor) |
| Canonical schema version | `0.9.0 → 0.10.0` |
| Build specification | v1.2, canonical completed copy at `docs/milestones/completed/m49/build-spec.md` |
| Overall implementation risk | **58/100 — orange** |

## Work Unit provenance

| WU | Accepted endpoint | Annotated tag |
|---|---|---|
| WU1 Honest Completion | `761aaf3e4eca975eab52ae355eaab26823fa6f1f` | `m49-wu1-honest-completion` |
| WU2 Revision-Bound Evidence | `2252d1980d227f7762471841e07f8f468d6a637e` | `m49-wu2-revision-bound-evidence` |
| WU3 Reliable Mutation Boundary | `fa137c7f5230b8fb828b84f375258914cb0906ab` | `m49-wu3-reliable-mutation-boundary` |
| WU4 Derived Qualification & Readiness | `ae6a7e5de117da7ea040e26809a925b726aa4c2b` | `m49-wu4-derived-qualification-readiness` |
| WU5 Canonical Handoff / Context | `d2b22f5bed784f4ddc8d645a2e7d6a6827161ea7` | `m49-wu5-canonical-handoff-context` |

All five tags dereference exactly to the accepted commits, form one ordered ancestry chain, and are ancestors of the closure state.

## Invariant assessment

- `done` remains implementation completion and still releases development dependencies; qualification is a separate derived result.
- `QUALIFIED` and production verification remain separate, with production verification derived as `VERIFIED`, `FAILED`, `UNKNOWN`, or `NOT_APPLICABLE` by applicability and observation.
- Claims, evidence outcomes/trust, and authority decisions remain separate. A scoped exception can permit progression while preserving the underlying `FAIL`/`UNKNOWN`; it never rewrites it to `PASS`.
- Missing, stale, untrusted, or revision-incomparable evidence preserves `UNKNOWN`; failed evidence cannot satisfy a pass requirement.
- Qualification is bound to work identity plus exact revision and is recomputed rather than persisted as timeless truth.
- Historical `done` records remain done. Historical projects without sufficient observation/revision proof derive qualification `UNKNOWN` and are not destructively rewritten by read-only views.
- Supported same-project canonical mutations are project-locally serialized; durable initial digests and an interruption marker make partial mutation detectable. Recovery emits one idempotent generic audit fact and retains the marker if audit persistence fails.
- Canonical handoff derives contract, effective amendments, implementation root/revision/diff, evidence/trust, blockers, decisions, qualification, and next authority from repository/project facts. It does not depend on prior chat history; estimated context size is never labelled measured.

## Compatibility and scope

The new binary accepts historical canonical versions, including 0.9.0, and preserves historical completion. Schema 0.10.0 protects M49's new persisted nested evidence/policy facts from older binaries: they reject the newer canonical file instead of reading and later stripping fields they do not understand. `productionReady` remains as a compatibility projection; `legacyProductionReady` makes the transition explicit while the canonical `productionReadiness` view owns truth.

No lifecycle status, parallel-WU execution, multi-agent orchestration, policy framework, retrieval/memory system, CI/security/deployment integration, database/event sourcing, or subsystem extraction was introduced. Existing specialized workspace, maintenance, Night Audit, PR, and remote-side-effect recovery remains intact.

## Closure validation

- Final `pnpm validate` executed the canonical chain in order. `typecheck`, `lint`, and `build` passed. The full Vitest run covered all 375 files: **4,031 passed, 40 expected conditional skips, 1 timeout, 0 assertion/functional failures**. The one timed-out file, `tests/integration/plan-extend-existing-graph.test.ts`, had passed in both prior full runs and immediately passed in isolation: **1 file, 4/4 tests**, each case about one second. This is reconciled as Windows parallel-worker contention under `milestone-protocol.md` §5; hosted PR CI remains the clean-environment authority.
- Earlier close-gate discovery: two real failures (unclassified new M49 tests; stale all-done recommendation characterization) were corrected. Focused verification: **2 files, 14/14 tests passed**. The subsequent full run contained only load timeouts; all nine affected files passed sequential isolation: **9 files, 109/109 tests**.
- Final schema/version/contract focus: **12 files, 154/154 tests passed**, covering version compatibility, unknown-field preservation, package/version consistency, evidence, completion, mutation, qualification, handoff, and recommendation parity.
- `pnpm version:check`: **PASSED**, current `0.47.0`; runtime, built runtime, lockfile, and SemVer checks green.
- `pnpm version:check -- --base main`: **PASSED**, base `0.46.4`, increment `minor`, monotonic and required bump present.
- `git diff --check`: **PASSED**.
- Owner-map JSON parse: **PASSED**.

## Close-gate corrections

1. Registered the two new M49 test families in the canonical inventory classifier and updated the stale M32 recommendation characterization to use M49's derived readiness.
2. Corrected product versioning from successive patches (`0.46.8`) to the governance-required minor `0.47.0` for new workflow behavior and additive JSON output.
3. Advanced `AIQT_SCHEMA_VERSION` to `0.10.0` because M49 adds durable nested evidence/policy fields; updated compatibility and boundary checks plus current product/architecture baselines.
4. Added canonical owner-map entries for implementation completion, mutation boundary, production qualification, and handoff.
5. Removed the superseded v1.0 M49 spec, retained v1.2 canonically, archived overdue M46 documentation, and removed a regenerable local pnpm cache artifact. A pre-existing August roadmap note about possible future parallel execution was inspected and deliberately excluded as unrelated to M49.

## Residual risk

**58/100 — orange.** M49 changes high-blast-radius core semantics and the canonical mutation boundary, but adds no new external mutation authority. The main residuals are clean-environment CI confirmation, the documented legacy `productionReady` transition window, and the inherent fact that qualification remains only as strong as available evidence. Per governance, human review is required before merge. No post-M49 pilot was started.
