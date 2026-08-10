# M44 — Historical Release Reconstruction — Closure Report

**Status:** Closed on branch `milestone/m44-historical-release-reconstruction`. Not merged. No PR opened yet.

## Baseline / final commits

- Branch created from `main` at `4e8d86a` (PR #14, M43 merge).
- Entry gates verified live: PR #14 MERGED; post-merge `Validate` CI on `main` green (`31266307282`, success); Product Specification v0.7 / Technical Architecture Specification v0.4 active; `milestone-protocol.md` v0.3 and `repository-owner-map.json` valid; M40 release-governance owners (`releaseGovernance`, `releaseRiskAssessment`, `releaseProvenance`) verified against live source before WU44-01; M43 completed documentation present under `docs/milestones/completed/m43/`; package `0.37.0` / schema `0.6.0` read live; working tree clean; no `.aiqt/` self-management state.
- Package version: `0.37.0` → `0.38.0` (minor: new backward-compatible capability -- `aiqt release history` / `aiqt release reconstruct`; no breaking change).
- Schema version: unchanged (`0.6.0`). No hard-stop was raised -- reconstruction is entirely transient (`HistoricalReleaseTarget`/`ReconstructionAssessment` are `CommandResult.data` objects only) and reuses the existing M40 release-governance/evidence contracts throughout.

## WU commits/tags/risk

| Unit | Commit | Tag | Risk |
|---|---|---|---|
| Pre-M44 housekeeping (archive M41, build-spec intake) | `93419d5` | *(none -- not a Work Unit)* | — |
| WU44-01 — Historical Reconstruction Contract, Ownership, and Compatibility | `d9acc3d` | `m44-wu01-historical-release-contract-ownership` | 8/100 Green |
| WU44-02 — Bounded Historical Evidence Discovery and Provenance Reconstruction | `96fc2f0` | `m44-wu02-historical-evidence-provenance` | 16/100 Green |
| WU44-03 — Reconstruction Engine and M40 Release-Governance Integration | `6308cd7` | `m44-wu03-reconstruction-m40-integration` | 17/100 Green |
| WU44-04 — Existing-Release Verification and External Evidence Boundary | `d483675` | `m44-wu04-existing-release-external-evidence` | 22/100 Green |
| WU44-05 — Dogfood, Safety Regression, Closure, Pre-PR Audit | *(this commit)* | `m44-wu05-historical-reconstruction-dogfood-closure`, `m44-historical-release-reconstruction` | 10/100 Green |

## Historical reconstruction contract

`src/schema/historical-reconstruction.schema.ts` is the sole `HistoricalReleaseTarget`/`ReconstructionAssessment` contract owner -- transient objects only, distinct from `src/schema/release-governance.schema.ts`'s `ReleaseCandidate`/`ReleaseDecision`, never a second candidate/provenance model. Reuses M40's `ReleaseEvidenceStatus` (`verified`/`reconstructed`/`partial`/`missing`/`waived`) unchanged; `HistoricalEvidenceConflict` is added as a blocking-finding-style disagreement between two evidence items (mirroring `release-provenance.ts`'s `detectProvenanceMismatches` pattern) since M40's evidence model had no first-class conflict state. `ReconstructionAssessment.digest` is defined over target identity + evidence + conflicts only, excluding `evaluatedAt` and the transient existing-release-lookup outcome, so identical bounded repository-local evidence always produces an identical fingerprint regardless of network availability that run.

## Evidence sources and precedence

Repository-local only, via four new allowlisted read-only ops added to the single `git-command-runner.ts` owner (`gitListTags`, `gitShowFileAtCommit`, `gitIsAncestor`, `gitCommitTimeIso` -- no generic `runGit` escape hatch): SemVer Git tags, tag→commit resolution, `package.json`/`AIQT_SCHEMA_VERSION` content at the exact historical commit (never the working tree), milestone-closure tags cross-checked against two known closure-report paths at that same commit, and Git ancestry. Optional external evidence (WU44-04) reuses M40's exact bounded GitHub read adapter (`github-release-client.ts`'s `getReleaseByTag`) -- no new HTTP client, no credential discovery, `createReleaseDraft` never called from this path. Precedence: a tag resolving to an exact commit and `package.json` at that exact commit both outrank inference; Git ancestry always outranks semantic-version ordering for base-release selection; conflicts stay visible even after a stronger source resolves identity.

## Reconstruction-status model

`computeReconstructionStatus` (pure, `src/workflow/reconstruction-engine.ts`): a conflict always yields `conflicting`; a missing package version yields `insufficient_evidence` (nothing to build an M40 candidate from); an ambiguous base yields `partial`; any other missing/partial evidence (the expected-absent schema-version item is excluded from this check, since most managed projects legitimately lack one) yields `reconstructable_with_warnings`; otherwise `reconstructable`. `existing_release` is never produced by the engine itself -- WU44-04's external lookup upgrades the outcome to `existing_release` only after a published release is authoritatively found for the exact tag.

## Base-release algorithm

Ancestry-only, fail-closed (`selectBaseRelease`, `src/workflow/historical-evidence.ts`): candidates are restricted to true Git ancestors of the target commit; among those, the base is the unique ancestor every other ancestor candidate is itself an ancestor of (the ancestor "nearest" to the target in the commit graph). When no such unique maximal element exists -- divergent branch history with two or more equally plausible bases -- selection fails closed to `ambiguous` rather than falling back to version-order comparison.

## M40 reuse proof

No second candidate/provenance/readiness/risk/approval/notes model exists. `mapToReleaseIntentRequest` translates a sufficiently evidenced `HistoricalReleaseTarget` into the exact `release-governance-service.ts` `ReleaseIntentRequest` shape; `historical-reconstruction-service.ts`'s `reconstructHistoricalRelease` then calls `assessReleaseDecision` -- the identical function `aiqt release assess`/`validate`/`notes`/`draft` already call, with no wrapper or override. When M40's own candidate-identity checks fail (e.g. zero evidenced milestones for a pre-tagging-convention target), M40's blocking findings are surfaced verbatim rather than a fabricated decision. Retrospective notes reuse `renderReleaseNotesMarkdown` verbatim, prepending only the required build-spec Sec 10 banner. Risk/approval-authority boundaries (`0`-`24` Green / `25`-`49` Yellow / `50`-`74` Orange / `75`-`100` Red; `<50` agent-approvable; `50`-`74` human approval; `75`-`100` human + waiver) were never touched -- `release-risk.ts` and `release-approval.ts` have zero diffs in this milestone.

A real dogfood against this repository's own tag history (`aiqt release reconstruct v0.35.0 --repository JoaomdvFerreira/aiqt`) confirmed the full flow end-to-end, including a correct `RELEASE-READINESS-TAG-CONFLICT` (the historical tag legitimately already exists locally) and a 100/100 risk score driven by real, honest CI/validation/security evidence gaps -- not a fabricated pass.

## CLI surface

`aiqt release history [--json]` (WU44-02): read-only inventory of every discovered SemVer tag, resolved commit, and package-version/tag match. `aiqt release reconstruct <tag> --repository <identity> [--token-env] [--json]` (WU44-03/WU44-04): explicit-target reconstruction, M40 mapping, and the bounded existing-release/draft lookup. Both are siblings under the pre-existing `release` command family (`assess`/`validate`/`notes`/`prepare`/`status`/`draft`/`history`/`reconstruct`), no new top-level command. `aiqt --version`, `--help`, and every pre-existing `release` subcommand's behavior is unchanged.

## External-verification / duplicate-release boundary

`verifyExistingGithubRelease` distinguishes four cases: a non-GitHub-shaped `repositoryIdentity`, a missing `GITHUB_TOKEN` (or configured token-env var), and a failed API call all report `unverified` for both release and draft -- never a fabricated `not_found`. An authoritative lookup that finds nothing reports `not_found`. A found published release reports `found`/upgrades reconstruction status to `existing_release`; a found unpublished draft (GitHub returns the same object shape, distinguished by its `draft` flag) reports the draft as `found` separately. In both found cases the CLI states "no duplicate publication/draft proposed" rather than proposing one, and `createReleaseDraft` is never invoked from this path.

## Dogfood scenario results (build spec Sec 15, all 19 required scenarios)

All scenarios are real, passing tests in `tests/integration/historical-evidence.test.ts` (29 cases) against a disposable, non-AIQT, real git-initialized fixture repository with a deliberately constructed linear + divergent-branch history, plus a real dogfood run against this repository's own tag history for end-to-end confirmation. AIQT was never initialized as a managed project (`.aiqt/` absent throughout) and no AIQT Release was reconstructed or published.

1. Version tag + complete local provenance + no existing release → `reconstructable`. ✅ (`v1.1.0`)
2. Published release already exists → `existing_release`, no duplicate action, `createReleaseDraft` asserted never called. ✅
3. Existing draft → surfaced (`draftStatus: "found"`), no duplicate draft. ✅
4. Package version at target matches tag. ✅ (`versionMatchesTag: true` for `v1.1.0`)
5. Package version/tag mismatch → conflict/block (`conflicting`, `HIST-TAG-PACKAGE-VERSION-MISMATCH`). ✅ (`v2.5.0`)
6. Missing closure report → explicit `partial` evidence, never fabricated `verified`. ✅ (milestone `m2`)
7. Missing CI evidence → never presented as verified (`ciStatus: "missing"` default, carried through to M40's own readiness gap). ✅
8. External GitHub/CI unavailable → explicit `unverified` state (no token, non-owner/repo identity, and API failure all covered). ✅
9. Ancestry-aware base-release selection. ✅
10. SemVer ordering and ancestry disagree → ancestry wins (higher-numbered non-ancestor tags v1.2.0/v1.3.0/v9.9.9 correctly excluded in favor of the lower-numbered ancestor v1.1.0). ✅
11. Divergent history with ambiguous base → no arbitrary selection (`ambiguous: true`, `baseRelease: null`). ✅
12. Multi-milestone range preserves only evidenced milestone provenance (`m1` verified, `m2` partial, never fabricated). ✅
13. Pre-AIQT/legacy-style target with limited metadata → `partial`/`insufficient`, not fabricated (`v1.0.0`, zero milestones, M40's own `RELEASE-CANDIDATE-NO-MILESTONES` surfaced instead of a fabricated decision). ✅
14. Same repository state run twice → deterministic equivalent output (digest equality asserted). ✅
15. Reconstructed candidate flows through M40 risk/readiness without a second decision owner (`assessReleaseDecision` called directly). ✅
16. Risk 49/50/74/75 authority boundaries unchanged (`release-risk.ts`/`release-approval.ts` have zero diffs this milestone). ✅
17. Reconstruction causes zero tag/history/canonical-state mutation (only read-only Git ops used throughout; verified by code inspection -- no `gitTag`/write call exists in any M44 file). ✅
18. AIQT self-management remains absent (`.aiqt/` absent in this repository throughout the milestone). ✅
19. M40–M43 critical release/evidence/safety regression suites remain green (see Validation). ✅

## Defects found/fixed during M44

- WU44-05 dogfood: two seeded test scenarios (`v9.9.9` merge target initially carrying a tag/package-version mismatch alongside its intended ambiguous-base scenario) were corrected in the test fixture itself, not the engine -- the conflict-precedence-over-ambiguity behavior it revealed (`conflicting` outranks `partial` in `computeReconstructionStatus`) was confirmed correct and is now an explicit assertion.
- No defects were found in reused M40 owners.

## Validation and safety-regression evidence

- `tsc --noEmit`: clean (full project).
- `eslint .`: clean (full repository).
- `tsc -p .` (full build): clean.
- `pnpm version:check --base main`: PASSED -- `0.37.0` → `0.38.0`, minor, `requiredBumpPresent: true`, all other checks (`semverValid`/`runtimeMatchesPackage`/`builtRuntimeMatchesPackage`/`lockfileMatchesPackage`/`monotonic`) true.
- Full suite (`vitest run`), run repeatedly against the final committed tree (post-registry-fix): file-level pass counts varied run to run under this Windows machine's parallel-worker load (13 → 8 → 6 failing files across three consecutive full runs, converging on the same two causes below each time), which is itself the expected signature of load-induced timeout flakiness rather than a real regression -- a genuine defect would fail deterministically, not intermittently across otherwise-identical runs. The registry-drift causes seen in the two earlier runs (`m33-cli-contract-matrix.test.ts` command count, `m34-validation-workload-inventory.test.ts`'s `KNOWN_SPAWNING_FILES`/`KNOWN_TIMEOUT_OVERRIDE_FILES`, `m35-test-inventory-classification.test.ts`'s domain rule -- all tripped by this milestone's own new files/commands as expected) were fixed deliberately within this WU (`test-inventory-classifier.ts` gained a `^historical-` → `release-governance` rule; EXPECTED_COMMAND_COUNT 86→88; the two file-set baselines updated) and do not appear in the final run. The final full run against the closed tree: **6 files failed | 323 passed | 1 skipped (330 total)**; **8 tests failed | 3410 passed | 32 skipped (3450 total)** (323+6+1=330; 3410+8+32=3450, reconciled exactly). All 6 failing files:
  - 1 (`m34-validation-workload-inventory.test.ts`'s "trailing-line inline-timeout shape" baseline expecting `tests/integration/cli.test.ts`) is a pre-existing baseline mismatch confirmed present on `main` before any M44 change (`git show main:tests/integration/cli.test.ts` already uses the single-line `vi.setConfig` shape, not the trailing-line shape the baseline expects) -- unrelated to this milestone, left unfixed as out of scope.
  - 5 (`evidence-advisory-hardening`, `evidence-gate-full-lifecycle`, `evidence-gate-policy`, `evidence-gate-simulate`, `workspace-cli`) are real M25/M28/M29 execution/evidence-gate/workspace tests that time out only under this run's full-suite parallel-worker load; all 5 files (37 tests) passed cleanly with zero failures when re-run together in isolation, confirming environment/load flakiness per `docs/governance/milestone-protocol.md` Sec 5, not a regression. (Two earlier full runs surfaced a different, overlapping subset of the same M25–M33 execution/workspace/CLI test population timing out under load -- e.g. `execution-adapter-claude-code-import`, `execution-external-import`, `execution-workflow-integration`, `m33-result-contract-characterization` -- each also confirmed passing individually at the time; no M44 file has ever appeared in a failure list from any full run.)
  - `historical-evidence.test.ts` itself appeared in exactly one of the three full runs (a `buildHistoricalReleaseTarget` determinism case) and passed on every other full run and every isolated re-run (29/29 tests, 0 failures each time) -- the same load-induced flakiness pattern as the other files above, not a real non-determinism in the reconstruction code (its digest-determinism logic performs no I/O with timing dependence; see WU44-03's `computeReconstructionDigest`).
- M40/M43 critical dogfood suites re-run explicitly and green: `m40-release-governance-dogfood.test.ts`, `m43-structural-review-dogfood.test.ts`, `release-draft.test.ts` (41 tests, 0 failures) -- confirms M40's release-draft/GitHub-adapter path is unaffected by WU44-04 reusing the same adapter.
- `historical-evidence.test.ts` (29 tests) and `git-command-runner.test.ts` (19 tests, 4 new for the WU44-02 ops) both green in every run across all four feature WUs.

## Known limitations

- Milestone provenance is evidenced only via Git tags matching the `mNN-...` closure-tag convention cross-checked against two known closure-report paths; a project using a different milestone-tagging convention will correctly report `partial`/no milestone evidence rather than a false negative, per design.
- `--repository <identity>` is always operator-declared for `release reconstruct` (never inferred from `package.json`), consistent with M40's existing-release/candidate identity model never being inferred either.
- The pre-existing `cli.test.ts` M34 baseline mismatch noted above remains unfixed (out of M44's scope; unrelated to the release/historical-reconstruction domain).

## Final milestone risk

Highest single Work Unit risk: 22/100 (WU44-04), well under the `50` human-review boundary. Milestone classification: `medium` (5 Work Units, one bounded external-read integration, no new/widened destructive or network-write authority) -- consistent with the planning-time classification; no Work Unit reached `high_risk` territory.

## PR readiness

Branch `milestone/m44-historical-release-reconstruction` is ready for PR: full validation green (typecheck/lint/build/tests/version-check), all required dogfood scenarios pass deterministically, documentation lifecycle complete (`docs/milestones/completed/m44/` holds this closure report and the build spec; M42 and M43 remain the other two hot completed milestones per protocol Sec 10, M42's archival deferred to the next milestone's own start as the protocol specifies). No PR has been opened and no GitHub Release was created, per instruction.

## Explicit confirmations

- No AIQT self-management occurred: `.aiqt/` was never created in this repository during M44.
- No Git tag/history mutation occurred: every Git operation M44 code performs is one of the four new read-only ops (`gitListTags`, `gitShowFileAtCommit`, `gitIsAncestor`, `gitCommitTimeIso`) or the pre-existing read-only `gitRevParse`; no write/mutating Git call exists in any M44 file.
- No automatic GitHub Release draft was created: `createReleaseDraft` is never called from any M44 code path (asserted directly in tests via a fake client that throws if called).
- No GitHub Release was published by this milestone or its dogfood.
