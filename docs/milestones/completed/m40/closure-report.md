# M40 — Release Governance, Risk Assessment, and Provenance — Closure Report

**Status:** Closed on branch `milestone/m40-release-governance`. Not merged. No PR opened yet.

## Baseline / final commits

- Branch created from `main` at `b4ef7a6` (`Merge pull request #7 from JoaomdvFerreira/governance/four-band-risk-scale`).
- M39 entry baseline verified: `docs/milestones/completed/m39/{AIQT_Milestone_39_Build_Specification.md,closure-report.md}` present; no `.aiqt/` self-management state existed at branch creation; working tree was clean. (M40's own build specification was normalized to `docs/milestones/completed/m40/build-spec.md` during pre-PR documentation hygiene, post-dating this line's original wording.)
- Package version: `0.33.1` → `0.34.0` (minor: new backward-compatible public capability, the `aiqt release` command family; no breaking change, no schema change).
- Schema version: unchanged (`0.5.0`) — M40 introduced no canonical `.aiqt/state.json`/`project.json` schema change. Local release-governance evidence is deliberately persisted outside `.aiqt/` (under `.aiqt-release/`), so no `AIQT_SCHEMA_VERSION` bump was needed or made.

## WU commits/tags/risk

| Unit | Commit | Tag | Risk |
|---|---|---|---|
| WU40-01 — Release Intent, Candidate, and Provenance Contract | `10f0261` | `m40-wu01-release-candidate-provenance` | 15/100 Green |
| WU40-02 — Explainable Risk Scoring and Approval Authority | `79ffe0d` | `m40-wu02-release-risk-approval-authority` | 20/100 Green |
| WU40-03 — Release Readiness CLI and Visual Release Notes | `25e8b5c` | `m40-wu03-release-readiness-cli-notes` | 25/100 Yellow |
| WU40-04 — Controlled GitHub Release Draft Integration | `feb9978` | `m40-wu04-github-release-draft` | 30/100 Yellow |
| WU40-05 — Integration Dogfood, Closure, Release-Decision Proof | *(this commit)* | `m40-wu05-release-governance-dogfood-closure`, `m40-release-governance-risk-provenance` | 20/100 Green |

## Implemented contract outcomes

- **One release-governance contract owner**: `src/schema/release-governance.schema.ts` defines `ReleaseCandidate`, `ReleaseIdentity`, `ReleaseMilestoneRef`, `ReleaseEvidence(Item/Status)`, `ReleaseProvenance`, `ReleaseReadinessAssessment`, `ReleaseBlockingFinding`/`ReleaseWarning`, `ReleaseRiskAssessment`, `ReleaseApprovalAuthority`/`ReleaseApprovalEvidence`/`ReleaseWaiver`, `ReleaseDraftState`, and the top-level `ReleaseDecision` envelope.
- **Explicit intent, never implicit**: `buildReleaseCandidate` (release-candidate.ts) is the sole candidate constructor; it requires explicit identity/tag/commit/milestone inputs and fails closed on any missing field. No milestone-completion, checkpoint, or review command anywhere in the repository creates or references a `ReleaseCandidate`.
- **Multi-milestone support**: candidates carry `milestones: ReleaseMilestoneRef[]` (≥1), each with its own tag/closure-commit-derived evidence status, independently verified against real Git facts.
- **Provenance**: `release-provenance.ts` binds candidate/CI commit, package/schema version, included milestones, and evidence digests into a deterministic SHA-256 digest (`computeCanonicalPayloadDigest`, reused from M23) and detects candidate/CI/milestone provenance mismatches as blocking findings.
- **Deterministic risk scoring**: `release-risk.ts` implements the exact 9-category, 100-point model from build spec Sec 7.2 (20/15/15/15/10/10/5/5/5), driven by fixed lookup tables over evidence states and bounded enum/boolean signals — no field anywhere lets a caller set the total score directly.
- **CLI surface**: `aiqt release assess|validate|notes|prepare|status|draft` — 6 commands, all M33-compliant (human/JSON parity, exit codes, `--json`).
- **GitHub draft integration**: `aiqt release draft` — the repository's first-ever network call, narrowly scoped to 3 fixed GitHub REST operations behind one shared `fetch` call site, hardcoded `draft: true`, credential via environment variable only, idempotency-aware (detects an existing release by tag).

## Risk-model boundary evidence (all four-band boundaries, real assertions)

Verified in `tests/integration/m40-release-governance-dogfood.test.ts` (scenarios 4-6) via the real scorer, not stubbed:

| Score | Status | Approval authority | Waiver |
|---:|---|---|---|
| 24 | Green | Agent permitted | No |
| 25 | Yellow | Agent permitted | No |
| 49 | Yellow | Agent permitted | No |
| 50 | Orange | Human required | No |
| 74 | Orange | Human required | No |
| 75 | Red | Human required | Yes |
| **49** (dogfood scenario 4) | Yellow | **Agent permitted** | No |
| **50** (dogfood scenario 5) | Orange | **Human required** | No |
| **76** (dogfood scenario 6) | Red | **Human + waiver required** | Yes |

(The first 8 rows are `tests/unit/release-risk.test.ts`'s exhaustive `it.each` boundary matrix; the last 3 are WU40-05's independently-constructed evidence combinations, arithmetically derived from the real category tables and asserted against the real scorer output.)

## Release-intent, readiness, and approval behavior

- Milestone completion alone never creates a release candidate (build-time architecture tests in 4 boundary-scan files + dogfood scenario 1: an unreferenced completed milestone leaves `release status` reporting zero candidates).
- Candidate integrity (`ready` / `ready_with_warnings` / `blocked` / `insufficient_evidence`) and publication authority (`agent_approval_permitted` / `human_approval_required` / `human_waiver_required`) are reported as two separate fields on every decision — never conflated.
- A stale/mismatched CI commit blocks readiness (and therefore blocks `release draft`) before any network call (dogfood scenario 7).
- `not_applicable` vs `missing` are structurally distinct: an operator-declared-not-applicable optional artifact (breaking changes, migration, rollback, known limitations, release notes) produces no warning; an undeclared one produces a warning, never a fabricated pass.

## GitHub draft integration outcome

`aiqt release draft` requires: explicit invocation, non-blocked/non-insufficient-evidence readiness, an `owner/repo`-shaped identity, a `GITHUB_TOKEN` (or named) environment variable, a real repository-identity match, and an existing-release-by-tag check before ever creating a draft. `draft: true` is hardcoded in the one `createReleaseDraft` call site with no caller-reachable override; no publish/merge/deploy endpoint exists anywhere in the codebase.

**Real-GitHub dogfood was blocked by unavailable credentials in this sandbox** (no `GITHUB_TOKEN` present) — honestly recorded, not fabricated (dogfood scenario 9; build spec Sec 12 explicitly permits this). The safe placeholder path (missing-credentials → `MissingDependency` exit code, clear operator action list, zero network calls attempted) was validated instead, alongside 6 further fully-network-mocked scenarios (successful draft creation, prerequisite blocking, repository-identity mismatch, existing-release idempotency, and token redaction on a simulated API failure) using an injected fake `GithubReleaseClient` — the same dependency-injection pattern this repository already uses for the M36 `AgentAdapter` interface.

## Dogfood evidence (build spec Sec 12, all 12 required scenarios)

All 12 scenarios are real, passing tests in `tests/integration/m40-release-governance-dogfood.test.ts`, run against disposable, fictional `acme/rocket-widgets`-style fixture repositories (never the AIQT repository itself):

1. Completed milestone, no release requested → zero candidates, zero artifacts. ✅
2. One-milestone candidate → deterministic assessment (identical provenance digest across two runs) and notes. ✅
3. Multi-milestone candidate → each milestone keeps its own distinct, independently-verified closure commit. ✅
4. Score 49 → `agent_approval_permitted`. ✅
5. Score 50 → `human_approval_required`. ✅
6. Score 76 → `human_waiver_required`. ✅
7. Stale CI/candidate mismatch → draft blocked, zero network calls. ✅
8. Missing `GITHUB_TOKEN` → safe failure, clear operator action list. ✅
9. Real-GitHub draft dogfood → honestly recorded as blocked-by-unavailable-credentials; safe path validated. ✅ (not "success" — see above)
10. No publication occurs → `ReleaseDraftStatusSchema` has exactly `["not_created","created","exists"]`, structurally no `"published"` state. ✅
11. Human/JSON outputs aligned → notes markdown's risk/approval lines match the JSON decision byte-for-byte on the relevant fields. ✅
12. M37/M38 safety controls not weakened → M40 files import nothing from the autonomous-run/sandbox execution surface (verified by grep-based test); the full M36-M38 boundary-scan suites (93 tests) re-run and pass unmodified.

## Validation evidence

- Focused/impacted vitest across every WU: 154 M40-specific tests, all passing (39 WU40-01, +29 WU40-02, +39 WU40-03, +21 WU40-04, +12+dogfood WU40-05, plus the moved/reclassified integration files).
- `tsc --noEmit`: clean throughout.
- `eslint .`: clean throughout (repo-wide, zero warnings/errors).
- `git diff --check`: clean throughout (no whitespace errors).
- `pnpm version:check` (comparison mode vs `origin/main`): **PASSED** — minor bump correctly detected and required-bump-present confirmed.
- Authoritative full suite (`pnpm validate`, Node 24, this machine): **3123/3127 tests passed** (297/302 files), 32 pre-existing skips (Docker-dependent tests self-skipping without a local Docker daemon, unrelated to M40). 4 failures, all verified non-M40:
  - 3 timeouts (`evidence-advisory-hardening.test.ts`, `evidence-gate-simulate.test.ts`, `execution-external-import.test.ts`) — none of these files were touched by M40; each passed cleanly in isolation (individual test times 2.5s-15s, well under their timeouts) when run outside full-suite parallel-worker contention. Classified as local Windows-machine load flakiness, the same category of issue this repository's own M34/M35 validation-workload documentation already characterizes extensively.
  - 1 reproducible failure (`m34-validation-workload-inventory.test.ts`'s "trailing-line inline-timeout shape" baseline, specifically `tests/integration/cli.test.ts`) — root-caused to this Windows development machine's `core.autocrlf=true` git config converting the repository's LF-stored `20000,\n  );` sequence to CRLF on checkout, which the test's `\n`-literal regex does not match. Confirmed present identically at the WU40-04 tip *before* any WU40-05 change (not an M40 regression), and confirmed this repository has no `.gitattributes` forcing LF. `.github/workflows/validate.yml` runs exclusively on `ubuntu-latest` (ciWorkflows owner-map entry), where checkout is LF-native and this pattern will match correctly. Not fixed in M40 (out of scope: touching unrelated pre-M40 test infrastructure/git config is a broader repository-governance decision, not a release-governance concern).
- Real GitHub Actions CI has not yet run for this branch (triggers on `push: [main]` or `pull_request`; no PR has been opened per the "prepare for human review" closure instruction — PR creation is left to the human).
- M36-M38 boundary-scan/safety suites (93 tests: `autonomous-run-boundary-scan`, `sandbox-wu01/wu02-boundary-scan`) re-run and pass unmodified, confirming M40 did not weaken those controls.

## Defects found/fixed during integrated review (WU40-05)

1. A doc comment in `github-release-client.ts` incidentally contained the literal substring `sandbox-docker-command-runner.ts`, false-positiving the WU40-01/WU04 boundary-scan tests' own forbidden-pattern regex — reworded, no functional change.
2. `autonomous-cli-registration.test.ts`'s "no raw-output bypass" check used a lazy regex bounded only by `return program;`, which (correctly, since it was never scoped to `autonomous` specifically) began absorbing the new `release` command section — including `release notes`'s legitimate specialized-text `process.stdout.write` — once WU40-03 added it after the `autonomous` block. Fixed by bounding the match at whichever comes first, `const releaseCommand` or `return program;`.
3. `release-governance-service.test.ts`, `release-cli.test.ts`, and `release-draft.test.ts` were originally placed under `tests/unit/` but transitively spawn a real `git` subprocess via the shared `initGitFixtureRepo` fixture helper — violating this repository's established "`tests/unit/` is entirely the fast-unit, spawn-free workload class" invariant (`m34-validation-workload-inventory.test.ts`). Reclassified to `tests/integration/` with the standard `vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS })` override, and the M34/M35 recorded baselines (`KNOWN_SPAWNING_FILES`, the classifier's `DOMAIN_RULES`) were updated deliberately to reflect the new files.

This is the one narrowly-scoped stabilization pass build spec Sec 16 permits; no further stabilization was required.

## Known limitations

- Real (non-mocked) GitHub draft creation is unverified end-to-end in this environment — only the safe failure path and a fully network-mocked success/idempotency/error matrix were exercised. A human with real `GITHUB_TOKEN` credentials against an authorized disposable repository should perform one live confirmation before this capability is relied upon in production.
- Release notes' "Delivered Capabilities" and "Important Fixes" sections are explicit placeholders directing the operator to milestone documentation — M40 does not synthesize changelog prose from milestone/commit history (out of scope; would require the M44 historical-reconstruction capability this milestone explicitly excludes).
- Per-milestone tag/closure-commit evidence is entirely operator-declared at candidate-construction time (via CLI/JSON input), then independently Git-verified — there is no structural field on `Milestone` (state.schema.ts) itself for a tag/closure commit, so this remains an explicit-intent input rather than something read automatically from canonical project state.
- The pre-existing CRLF/Windows-local-checkout test-baseline mismatch (see Validation evidence) remains unresolved, as it is outside M40's scope.

## Final risk score/status

**M40 aggregate risk: 30/100 — 🟡 Yellow.** Derived the same way the milestone's own risk-scoring product feature would score similar work: highest single-WU contribution was WU40-04's 30/100 (the repository's first network surface, though delivered narrower than its 45/100 budget); no WU exceeded its target; the M37/M38-safety and no-publication invariants were verified, not merely asserted.

## Residual risk

- The unverified live-GitHub path (see Known limitations).
- The two pre-existing, non-M40 local-validation discrepancies (documented above) mean this specific Windows development machine cannot currently produce an all-green `pnpm validate` run; the authoritative Linux CI is expected to be unaffected.

## PR readiness

**READY FOR PR.** Working tree clean, all WU tags pushed, closure commit/tag to follow this report. `main` should be re-verified as unchanged before PR creation (no conflicting work landed on `main` during M40 development, per `git log origin/main` checked at each WU boundary).

## M41 entry recommendation

M40 is complete and self-contained. M41 (adaptive test selection, per the build spec's out-of-scope list) may begin once this branch is merged and formally closed — no blocking dependency from M40 back onto M41 exists.
