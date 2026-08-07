# M30 Gate J — Build Entry Audit

Read-only audit per `AIQT_Milestone_30_Build_Specification_v0.2.md` §3.
Creates no M30 state; committed as part of WU30-01.

## Baseline verification (confirmed against live repository)

| Item | Claim | Verified |
|---|---|---|
| Branch | main | `git branch --show-current` → `main` |
| Baseline commit | `be5c165` | `git log -1` → `be5c165877b323ffa8c50a8153add97f92460c58` |
| Package version | `0.17.1` | `package.json` `version` field |
| Release tag | `v0.17.1` | present, points at baseline commit |
| M29 milestone tag | `m29-advisory-checkpoint-evidence` | present, at `3fc335c` |
| M29 correction tag | `m29-correction-advisory-unclassified-telemetry` | present, at `be5c165` |
| Test count | 2255 | confirmed in prior session (214 files) |
| Schema version | `0.5.0` | `src/core/constants/schema-version.ts` |
| M29 merge residual risk | `10/100` | recorded in M29 closure report |
| Gate J status | open | recorded in Gate J evidence campaign |
| M30 implementation entry risk | `25/100` | recorded baseline claim |
| M30 started | false | no `M30`/`enforcement`/`required` code present prior to this commit |

## Confirmed repository owners (verified against live code, not assumed from the owner map)

- **Checkpoint candidate construction / identity**: `applyCheckpoint` (`src/services/checkpoint-service.ts`) is pure — builds the candidate `Checkpoint` record (including `createdAt`, the canonical completion timestamp) entirely in memory before any write. `checkpoint.command.ts` computes `checkpointId` via `nextId("C", ...)` and captures `timestamp` once, both *before* calling `applyCheckpoint`, so the exact candidate checkpoint ID and timestamp are known ahead of persistence.
- **Existing checkpoint result known point**: `deriveFinalWorkUnitStatus` (`src/workflow/checkpoint-completion-gate.ts`) resolves `"done"` vs `"needs_review"` from the checkpoint input's own acceptance/validation/issue state, and throws (exit 1, `ValidationFailed`) for an explicit `targetStatus: "done"` claim that fails the gate. This is the exact point at which the existing (pre-M30) result is known — required evidence must never run before this, and can only ever act when this already resolved to `"done"`.
- **M12 effective-amendment owner**: `computeEffectiveCheckpointResult` / `applyCheckpointAmendment` (`src/services/checkpoint-amendment-service.ts`), unchanged. `applyCheckpointAmendment`'s own `completionGatePasses` boolean is the exact point a `needs_review → done` transition would occur — required evidence gates precisely this decision, reusing the same function rather than reimplementing it.
- **M18 readiness owner**: `recalculateDependencyReadiness` (`src/workflow/dependency-readiness.ts`), called only when `finalStatus === "done"` in both `checkpoint-service.ts` and `checkpoint-amendment-service.ts` already. `isBlockingSourceSatisfied` treats `"done"` (and `"replanned"`) as satisfying; grandfathered work units need no special-case here since M30 never changes a historical work unit's stored status.
- **M22/M23 evidence owners**: `EvidenceRecordSchema` (`src/schema/evidence.schema.ts`) — `provider.{providerId,providerType,trustLevel}`, `workflowBinding.{workUnitId,packetId,checkpointId,implementationRootId}`, `codeBinding.{commitSha,workingTreeFingerprint,repositoryFingerprint,capturedAt}` are the canonical fields for provider/binding eligibility. `meetsTrustLevel`/`TRUST_LEVEL_ORDER` reused unchanged.
- **M28 owners**: `resolveActivePolicy` (`src/services/evidence-gate-policy-service.ts`), `buildEvidenceSnapshotEntries` (`src/workflow/evidence-gate-snapshot.ts`), `simulate`/`evaluateRule`/`aggregateOverallResult` (`src/workflow/evidence-gate-simulation-engine.ts`), all reused directly with zero copied logic.
- **M29 owners**: `checkpoint-advisory-*.ts`, `evidence-advisory-telemetry.ts` (including the just-corrected `feedback.unclassified`), all reused for advisory projection derivation and Gate K's activation-readiness metrics.
- **Review/manage/status/export owners**: `review.command.ts` (`runReviewCommand`), `manage.command.ts`, `status.command.ts`, `export.command.ts` — extended additively in WU30-05/06, never duplicated.
- **Candidate-state/atomic-write/runlog owners**: `workflow-state-store.ts` (`writeStateModel`/`readStateModel`), `runlog-store.ts` (`appendRunlogEvent`, `readRunlogEvents`, `readRunlogEventIds`), `state/ids.ts` (`nextId`), all reused unchanged. `readRunlogEvents` (added in M29-WU02) is the same reader used for Gate K's rule-observation/telemetry scans.
- **Versioning/CI owners**: `docs/versioning.md`, `src/tooling/version-check-cli.ts`, `.github/workflows/validate.yml` — unchanged.

## Required architecture decisions (approved before WU30-02)

1. **Candidate checkpoint state**: the pre-persistence state `applyCheckpoint` would produce — `{...state, checkpoints: [...state.checkpoints, candidateCheckpoint], workGraph: {...state.workGraph, workUnits: appliedWorkUnits}}` — evaluated with the *pre-computed* deterministic `checkpointId` as the M28 simulation target. Evidence need not already reference this not-yet-existent checkpoint ID for `target_or_project`-scoped rules (project/work-unit evidence already matches); `exact_target` rules require evidence pre-imported against the deterministically-predictable next checkpoint ID. This is a deliberate, documented consequence of deterministic ID assignment, not a gap.
2. **Point at which existing result is known**: immediately after `deriveFinalWorkUnitStatus` returns (or throws). Required evidence only evaluates when this equals `"done"`.
3. **M12 candidate state / effective-result owner**: `computeEffectiveCheckpointResult` plus `applyCheckpointAmendment`'s own `completionGatePasses`, unchanged. The required gate slots in exactly where `completionGatePasses` would otherwise flip a `needs_review → done` transition.
4. **M18 recalculation call**: unchanged call sites, now driven by a *possibly-downgraded* `finalStatus`/`workUnitStatusAfter` computed by feeding the required-evidence decision's outcome into the existing pure functions before they run — no second readiness engine, no duplicated call.
5. **Canonical evidence fields**: enumerated above (provider/workflowBinding/codeBinding).
6. **State owners for M30's five new record types**: additive top-level sibling fields on `StateModel` (`enforcementProfiles`, `requiredRuleRecoveryProofs`, `requiredModeActivationPlans`, `requiredModeActivations`, `requiredEvidenceExceptions`), mirroring the exact pattern M29 used (`checkpointEvidenceAdvisories`, `evidenceAdvisoryFeedback`) rather than nesting under M28's `evidenceGate` config object — keeps each concern's cap/limit independently bounded and avoids bloating an already-large existing schema. No new canonical file is created.
7. **State/runlog repair strategy**: identical to M29's `persistCheckpointAdvisoryResult` pattern — state-first write, then try/catch runlog append with gap detection via `readRunlogEvents` scan by deterministic ID, repaired on idempotent retry.
8. **Transition matrix**: frozen exactly as specified in §9.1/§9.2 of the build specification; implemented verbatim in WU30-04/05, not reinterpreted.

## Entry decision

`implementationEntryRisk = 25 <= 35` (recorded M30 baseline claim, consistent with M29's closure and the completed Gate J evidence campaign) → **proceed**.

No stop condition triggered: a candidate checkpoint state is evaluable before persistence (decision 1); M28/M12/M18 are reusable without copying logic (decisions 1/3/4); evidence provider/binding identity has canonical owners (decision 5); required mode needs no network/provider call (design constraint, enforced by static boundary scans in WU30-07); historical done work is deterministically grandfathered by snapshotting current-done work-unit IDs at activation (§4.6/§8.3); generic amendment APIs cannot bypass enforcement because the required gate is inserted at the amendment service's own `completionGatePasses` decision point, with no waiver flag anywhere in the amendment command's option surface; a safe deactivation path is defined (§5.3: returns to advisory/off, mutates only activation status, never completes/amends/deletes); no new issue lifecycle is introduced (required deficiencies reuse M22 `ProjectIssue`, per the same accepted M29 architecture correction); no High/Critical dependency alerts are outstanding (confirmed via `pnpm audit` in every prior milestone closure and re-verified at M30 closure); no breaking state migration is required (every M30 field is optional/additive).
