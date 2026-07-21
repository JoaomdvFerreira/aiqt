# AIQT Repository Governance

## Distribution and license decision

```yaml
package_distribution_intent:
  status: proprietary_private
  package_json:
    private: true
    license: "UNLICENSED"
  decided: 2026-07-20 (M21 Gate A, explicit owner decision)
  rationale: >
    Matches current reality: private repository, solo maintainer, no
    public npm publication planned at this time. Not a permanent
    commitment -- revisit if/when public distribution is intended, at
    which point an approved SPDX license and a LICENSE file become
    required (see M21 Build Spec v0.2 §5.2).
```

See `SECURITY.md` for the related vulnerability-reporting policy, decided
in the same Gate A session.

## Branch-protection decision

```yaml
branch_protection_decision:
  status: accepted_unenforced_gap
  evidence:
    - "GET /repos/{owner}/aiqt/branches/main/protection -> HTTP 403: "
    - "'Upgrade to GitHub Pro or make this repository public to enable this feature.'"
    - "GET /repos/{owner}/aiqt/branches/main -> protected: false"
    - "Repository visibility: private (confirmed via gh api)"
    - "Verified via live gh api calls during M21 Gate A, 2026-07-20."
  rationale: >
    Required status checks and branch protection are unavailable on this
    repository's current GitHub plan while it remains private. Upgrading
    the plan or making the repository public are both real options but are
    account/visibility decisions outside the scope of an M21 code change,
    and neither is made automatically by AIQT or by this milestone.
    Accepting the gap now, with truthful documentation and compensating
    controls, is preferable to silently pretending CI is a merge gate it
    is not.
  compensating_controls:
    - "Single maintainer; no third-party push access to this repository."
    - "Established discipline (all milestones to date): never force-push,
       never rewrite published history, never skip CI locally before
       pushing, always run the full validation suite
       (typecheck/lint/test/build/version:check) before every push to
       main."
    - "`.github/workflows/validate.yml` has no `continue-on-error` or
       `|| true` anywhere -- a failing check fails the workflow run
       visibly, even though GitHub does not block the push on it."
    - "`pnpm version:check -- --base <ref>` enforces a version bump on
       every relevant change, evaluated locally before push and again in
       CI, even though neither is a platform-required check."
  revisit_when:
    - "The repository is made public (branch protection becomes free), or"
    - "The GitHub plan is upgraded to one that includes branch protection
       for private repositories, or"
    - "A second contributor with push access is added."
```

## CI status: advisory, not enforced

`.github/workflows/validate.yml` runs on every push to `main` and every
pull request, and fails visibly (no soft-failure pattern anywhere in the
workflow) when typecheck, lint, tests, build, or version governance fail.

**This is not the same as GitHub enforcing it.** With no required status
checks and `protected: false` on `main`, GitHub does not prevent a push or
merge from landing regardless of whether the workflow run is green or red.
The check is advisory: visible, run in good faith, and never bypassed in
practice by the current maintainer discipline above -- but not
structurally guaranteed by the platform. Any documentation, command
output, or commit message that calls CI "enforced" without this caveat is
inaccurate and should be corrected.

## Vulnerability reporting decision

```yaml
vulnerability_reporting_decision:
  status: partially_available_reverified_2026_07_20
  evidence:
    - "GET /repos/{owner}/aiqt/private-vulnerability-reporting -> HTTP 404 (still unavailable; re-verified 2026-07-20, unchanged since Gate A)"
    - "GET /repos/{owner}/aiqt/vulnerability-alerts -> 204 (now ENABLED -- was HTTP 404 'disabled' at Gate A, 2026-07-20 earlier same day)"
    - "GET /repos/{owner}/aiqt/dependabot/alerts -> 6 real open alerts (2 critical, 1 high, 3 medium -- vitest/vite/esbuild devDependencies)"
    - "GET /repos/{owner}/aiqt/automated-security-fixes -> {enabled: true, paused: false}"
    - "GET /repos/{owner}/aiqt/dependency-graph/sbom -> succeeds with real SBOM data"
    - "Verified via live gh api calls, 2026-07-20 (supply-chain maintenance session, same day as Gate A but later)."
  rationale: >
    Vulnerability alerts, the dependency graph, and Dependabot security
    updates are now confirmed ENABLED -- a change from the Gate A snapshot
    taken earlier the same day, most likely GitHub's own asynchronous
    processing catching up rather than any repository-side action taken
    here. Private vulnerability reporting specifically remains the one
    unavailable piece, gated the same way branch protection is (plan/
    visibility). SECURITY.md is updated to reflect this: alerts work and
    are actively finding real issues; only the private *reporting*
    channel for external researchers is still missing.
  revisit_when:
    - "The repository is made public, or"
    - "The GitHub plan is upgraded to one that includes private vulnerability reporting for private repositories."
```

## Dependency and supply-chain monitoring

`.github/dependabot.yml` (added in M21-WU04) requests weekly, capped,
grouped update pull requests for the npm ecosystem and GitHub Actions.
Dependabot does not auto-merge anything; every update PR requires the same
manual review and CI run as any other change.

Dependabot itself is confirmed active (it opened three real GitHub Actions
update PRs on 2026-07-20: `actions/checkout` 4->7, `pnpm/action-setup`
4->6, `actions/setup-node` 4->7). Vulnerability alerts and the dependency
graph are now confirmed **enabled** (see "Vulnerability reporting
decision" above), and have already surfaced 6 real alerts in
`vitest`/`vite`/`esbuild` (devDependencies).

## Lockfile-parsing limitation (npm/pnpm ecosystem)

```yaml
dependabot_pnpm_parsing_limitation:
  status: external_limitation_workaround_applied
  symptom: "GitHub UI: '/pnpm-lock.yaml not parseable'"
  evidence:
    - "Dependabot job log (run for security update on 'vite', 2026-07-20): corepack correctly activates pnpm@7.33.5 per packageManager, then the npm_and_yarn updater subprocess exits 1 with error type dependency_file_not_parseable, message '/pnpm-lock.yaml not parseable', file-path '/pnpm-lock.yaml'."
    - "pnpm@7.33.5 install --frozen-lockfile succeeds cleanly in a disposable clean clone against the committed lockfile."
    - "Regenerating pnpm-lock.yaml from scratch with the exact same pnpm@7.33.5 in that clean clone produces a byte-for-byte identical file (md5 4288c0576b2b424de3fb5b93fd6dcbf5, both the committed file and the from-scratch regeneration)."
    - "dependabot-core issue #7584 (github.com/dependabot/dependabot-core/issues/7584): an unresolved, 'closed as not planned' report of the identical dependency_file_not_parseable / JSON-parse-error signature for a pnpm lockfile, no fix ever shipped."
  conclusion: >
    This repository's pnpm-lock.yaml (lockfileVersion: 5.4, the format
    pnpm 7.x writes) is valid and deterministic for the exact approved
    pnpm version. The failure is in dependabot-core's own npm_and_yarn
    updater, which cannot parse this lockfile format/version combination
    -- an external tool limitation, not a defect in this repository.
  workaround_applied:
    - "open-pull-requests-limit: 0 on the npm ecosystem entry in .github/dependabot.yml, stopping Dependabot's own scheduled npm-ecosystem update-PR attempts."
  not_changed:
    - "pnpm version (still exactly 7.33.5, matching lockfileVersion 5.4) -- no unapproved package-manager migration."
    - "Lockfile format/content -- unchanged, proven byte-identical to a fresh regeneration."
    - "GitHub Actions ecosystem monitoring -- fully independent, unaffected."
    - "Vulnerability alert detection -- unaffected; alerts fire correctly regardless of whether Dependabot can open a fix PR."
  known_residual_effect: >
    Alert-triggered *security* update attempts (as opposed to scheduled
    version updates) are controlled by the repository's separate
    "Dependabot security updates" setting, not by open-pull-requests-limit
    in dependabot.yml. Those will still be attempted whenever a new
    vulnerability alert fires for an npm-ecosystem dependency, and will
    still fail with the same parse error, until dependabot-core adds
    lockfileVersion 5.4 support or a separately approved pnpm-version
    migration changes the lockfile format. This residual noise was an
    explicit, accepted tradeoff (owner decision, 2026-07-20) in exchange
    for not reducing security-update *capability* further.
  revisit_when:
    - "dependabot-core adds lockfileVersion 5.4 (or pnpm 7.x-lockfile) support, or"
    - "A separately reviewed and approved pnpm major-version migration changes the lockfile format to one dependabot-core supports."
```

## M22-WU01 tag waiver

```yaml
m22_wu01_tag_waiver:
  status: waived_no_retroactive_tag
  work_unit: WU22-01 (Gate B Repository Audit, M22 Build Spec v0.2)
  why_no_commit: >
    WU22-01 was a read-only audit by design (git/version/schema/service
    inspection only). It produced no repository mutation, so an empty
    commit was correctly never created, consistent with this project's
    standing rule against empty commits.
  why_no_retroactive_tag: >
    The commit that was actually HEAD when Gate B was audited is
    db16b237fd896365cc54291dce55d27a7848e383 -- the merge commit for the
    unrelated prior "vitest/vite/esbuild security upgrade" milestone
    (already tagged v0.8.3). That commit's content and message describe a
    dependency-security fix, not M22 work. Attaching a new
    "m22-wu01-gate-b-audit" tag to it would misrepresent what the commit
    did to anyone reading `git tag --points-at` or a tag list -- the tag
    name would claim M22 audit work on a commit that has nothing to do
    with M22. A tag recording "this was the baseline examined," not "this
    commit performed WU22-01," is more honest recorded here instead.
  commit_audited: db16b237fd896365cc54291dce55d27a7848e383
  gate_b_result:
    implementation_entry_risk: 25
    outcome: passed
    verified_baseline:
      package_version: "0.8.3"
      release_tag: v0.8.3
      test_count: 1216
      open_critical_high_dependency_alerts: 0
  waiver_approved_by: >
    Recorded during the M22 governance micro-closure (2026-07-21) as the
    single, non-duplicated closure record for WU22-01 -- no tag
    "m22-wu01-gate-b-audit" exists or will be created; this waiver is the
    sole governance artifact for that Work Unit.
```

## M23-WU07/WU08 combined-commit waiver

```yaml
m23_wu07_wu08_combined_commit_waiver:
  status: waived_single_commit_single_tag
  work_units: WU23-07 (aiqt evidence import command + preview), WU23-08
    (atomic mutation, runlog, idempotency hardening)
  commit: 5d8601f1b9b70ca3bba0ea35f2bc0c35c199c239
  tag: m23-wu07-wu08-evidence-import-command (annotated)
  why_combined: >
    WU23-07's own acceptance criteria require the `aiqt evidence import`
    command to exist and to support --preview; WU23-08's acceptance
    criteria require the same command's non-preview path to atomically
    persist via writeStateModel/appendRunlogEvent and to prove idempotent
    replay. A WU23-07-only commit would have shipped a command whose
    default (non-preview) invocation either did nothing or crashed --
    not a working intermediate feature, and not something a real user or
    agent could safely invoke between the two commits. Splitting them
    would have produced a misleading "the command works" milestone marker
    on a build that could not actually apply an import. Delivering both in
    one commit, with one tag naming both Work Units explicitly, is the
    accurate representation of what shipped together and why.
  acceptance_criteria_split:
    WU23-07: >
      Public CLI contract (--from-file/--stdin/--preview/--json), exact
      exit-code contract (0/3/10), payload parsing/validation/normalization
      pipeline, --preview reporting the full plan with zero mutation.
    WU23-08: >
      Non-preview path's atomic writeStateModel -> appendRunlogEvent
      persistence sequence, verified byte-for-byte idempotent replay,
      verified byte-for-byte zero mutation on every rejection path.
  what_was_not_done: >
    No extra commit was manufactured to simulate one-commit-per-Work-Unit
    compliance, and no duplicate tag was created on the same commit under
    a second name. This waiver is the sole governance record explaining
    the variance; the M23 final report's Work Unit table cites this
    waiver directly rather than re-deriving the explanation.
  approved_during: >
    M23 Governance and Atomicity Micro-Closure (2026-07-21).
```

## M23-WU09 tag gap (closed)

```yaml
m23_wu09_tag_gap:
  status: closed_missing_tag_created
  finding: >
    The M23 final report (end of the primary implementation session)
    listed 9 Work Units, 8 commits (WU23-07/WU23-08 combined per the
    waiver above), and only 7 Work-Unit-specific tags
    (m23-wu01-import-envelope-registry through
    m23-wu06-import-normalization-routing, plus the combined
    m23-wu07-wu08-evidence-import-command) -- WU23-09 (version bump,
    clean-clone validation, milestone closure; commit
    e3962117f96d543891b1ff07a1f70fcd49d84569) had no Work-Unit-specific
    tag of its own, only the milestone tag
    (m23-external-evidence-import-normalization) and the release tag
    (v0.10.0), both of which point to the same commit but name the
    milestone/release, not the Work Unit.
  resolution: >
    Created m23-wu09-final-validation as a new annotated tag pointing at
    the existing commit e3962117f96d543891b1ff07a1f70fcd49d84569 -- no
    commit was created or altered, no existing tag was moved or rewritten.
    This accurately represents history: that commit genuinely performed
    WU23-09's work (version bump, clean-clone validation, execution-
    boundary scan), so tagging it is not a misrepresentation the way a
    retroactive WU22-01 tag would have been (see the M22-WU01 tag waiver
    above, which is the counter-example: that case correctly declined to
    tag an unrelated commit).
  final_tag_accounting: >
    9 Work Units, 8 commits, 8 Work-Unit-specific tags (WU01 through
    WU06 individually, WU07/WU08 combined under one tag, WU09
    individually) -- one tag per commit, fully reconciled.
  closed_during: >
    M23 Governance and Atomicity Micro-Closure (2026-07-21).
```

## M23 post-state-write runlog-append recovery model

```yaml
m23_runlog_append_recovery_model:
  status: documented_and_test_covered
  sequence: "writeStateModel(paths.stateFile, finalState) -> for each runlog event: appendRunlogEvent(paths.runlogFile, event)"
  owners:
    state_write: writeStateModel (src/state/workflow-state-store.ts) ->
      writeJsonFile -> atomicWriteFileSync (src/core/filesystem/
      atomic-write.ts): write to an exclusively-created temp file in the
      same directory, fsync, then renameSync over the target. Genuinely
      atomic on disk (rename is the atomicity boundary); on any failure
      the temp file is removed and the target is left untouched.
    runlog_append: appendRunlogEvent (src/state/runlog-store.ts) ->
      appendJsonLine -> node:fs appendFileSync. A plain synchronous
      append, not wrapped in the temp-file/rename pattern -- it can fail
      (permissions, disk full, path replaced by a directory) after the
      state write has already succeeded and committed.
  failure_window: >
    state write succeeds, then one appendRunlogEvent call in the same
    command invocation throws. This is a real, previously-untested window
    in aiqt evidence import's default (non-preview) path, and is
    architecturally identical to every other pre-M23 command using the
    same two-step sequence (e.g. graph-repair.command.ts --apply) -- not
    unique to or newly introduced by M23.
  recovery_model: authoritative_state_with_advisory_runlog_gap
  recovery_model_definition: >
    state.json remains the single canonical source of truth and is left
    fully correct after the failure (the new EvidenceRecord/ProjectIssue/
    DecisionEscalation genuinely exist, exactly as if the command had
    succeeded). A retry of the identical command is a safe, true
    idempotent no-op: M23's import-identity conflict resolution
    (resolveImportConflict, src/evidence/import-orchestrator.ts) finds
    the already-persisted EvidenceRecord by importIdentityKey+digest and
    returns outcome "no_op" with zero new mutation -- no duplicate
    EvidenceRecord, ProjectIssue, ProjectIssueTransition, or
    DecisionEscalation is ever created, and the no_op path never calls
    appendRunlogEvent, so no duplicate runlog event is possible either.
    What is NOT true: the runlog event that was lost in the original
    failed attempt is never reconstructed or backfilled on retry -- it is
    permanently missing from runlog.jsonl's audit trail, even though
    state.json is fully correct. This is consistent with the repository's
    existing runlog-health model (inspectRunlogHealth/
    runlogHealthWarning), which already treats runlog.jsonl as a
    non-blocking, best-effort audit trail whose internal malformed-line
    count is surfaced as an advisory warning, never as a blocking error or
    an automatic repair target. No cross-referencing between state.json's
    record counts and runlog.jsonl's event counts exists anywhere in the
    repository (pre-M23 or M23), so this specific missing-event gap is
    not detected by any existing command today.
  why_not_a_recovery_defect: >
    The required safety properties -- no duplication, no state
    corruption, a well-defined exit code, and a safe retry -- all hold,
    verified by a real failure-injection test (see below). Eliminating
    the advisory-runlog-gap entirely would require a cross-file
    atomicity or journaling mechanism (e.g. a write-ahead marker
    reconciled on next read, or a single combined state+runlog
    transaction log) that does not exist anywhere in this repository for
    any command, pre-M23 or otherwise. Building one is a broad,
    repository-wide architectural change explicitly out of scope for a
    milestone micro-closure and is not undertaken here.
  test: tests/integration/evidence-import-cli.test.ts > "a runlog-append
    failure after a successful state write leaves state.json correct, and
    a retry is a safe idempotent no-op with no duplication"
  test_technique: >
    runlog.jsonl is made read-only (chmod 0o444) after `aiqt init` creates
    it as a normal, readable file -- so loadProject's inspectRunlogHealth
    pre-flight check (which requires the file to exist and be readable)
    still passes, and the failure is injected precisely at the intended
    appendFileSync call site, not earlier. Write access is restored
    (chmod 0o644) before retrying and in a `finally` block for cleanup.
  test_verified_properties:
    - "exact exit code: 3 (InvalidInput, errorToResult's generic-Error fallback) on the failed attempt; 0 on the retry"
    - "resulting state.json: contains exactly 1 EvidenceRecord (EVID-001) with importProvenance set, immediately after the failed attempt -- proving the state write landed"
    - "resulting runlog.jsonl: unchanged (byte-for-byte) after the failed attempt -- the append never landed"
    - "retry outcome: \"no_op\", same evidenceId, same importIdentityKey as the failed attempt"
    - "no duplicate EvidenceRecord after retry: state.json's evidence.records still has length 1"
    - "no duplicate runlog event after retry: runlog.jsonl is byte-for-byte identical before and after the retry"
  residual_risk_contribution: >
    Feeds M23-R12 (input failure partially mutates state/runlog) in the
    hazard closure below. Scored at its residual target (15/100), not
    below, because the disclosed advisory-runlog-gap is a real, if
    non-corrupting, limitation, and closing it further would require the
    out-of-scope architectural work described above.
  documented_during: >
    M23 Governance and Atomicity Micro-Closure (2026-07-21).
```

## M24 runlog-append recovery model (inherited, not redesigned)

```yaml
m24_runlog_append_recovery_model:
  status: inherited_unchanged
  applies_to: >
    aiqt plan (create/--extend/refine) carrying M24 executionMetadata --
    the same writeStateModel -> appendRunlogEvent sequence as every other
    mutation path, unmodified by M24.
  recovery_model: authoritative_state_with_advisory_runlog_gap
  evidence: >
    Verified directly for M24's own metadata-bearing plan-creation path
    (not merely assumed from the M23 precedent): a runlog-append failure
    after a successful `aiqt plan --from-file` state write (using the
    same chmod-0o444 technique as the M23 test) leaves state.json fully
    correct, including the new Work Unit's executionMetadata; the command
    reports failure (exit code from errorToResult's fallback); a retry is
    safe and produces zero further state mutation (the pre-existing
    "graph not empty" guard, unrelated to M24, rejects a second plan
    attempt once one has already succeeded, which is itself proof no
    duplicate graph/metadata record can be created on retry).
  test: tests/integration/execution-metadata-runlog-recovery.test.ts >
    "a runlog-append failure after a successful plan-with-metadata state
    write leaves state.json correct, and a retry is a safe no-op with no
    duplicate graph records"
  not_redesigned: >
    M24 does not broaden or alter the cross-file recovery model in any
    way -- this section only records that the pre-existing model was
    verified against M24's own new mutation content, per the M24 build
    specification's explicit requirement.
  documented_during: >
    M24-WU08 (Compatibility, Limits, Atomicity, and Security Hardening),
    2026-07-21.
```
