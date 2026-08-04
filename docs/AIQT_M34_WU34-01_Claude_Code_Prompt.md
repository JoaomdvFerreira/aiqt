# AIQT M34 WU34-01 — Claude Code Prompt

Ready-to-paste prompt for starting AIQT Milestone 34, Work Unit 01. Do not
edit the bracketed baseline values without re-verifying them against the
live repository first.

```text
You are implementing AIQT Milestone 34: Deterministic Test Execution and
Validation Gate Hardening.

Read first:

docs/engineering/AIQT_Milestone_34_Build_Specification.md

Treat it as the authoritative delta specification.

Operating constraints

This is the AIQT product repository itself.

Do not use AIQT commands or create .aiqt/ state to govern AIQT's own
implementation.

Use repository specifications, the maintained owner map, Git, tests, CI,
detailed commits/tags, and structured reports.

Implement one Work Unit at a time.

Stop after WU34-01. Do not begin WU34-02 until explicitly instructed.

Current task

Implement:

WU34-01 — Validation Workload Characterization and Policy Contract

This is a measurement, classification, and policy-definition Work Unit.

Do not implement systemic timeout or concurrency changes yet.

Do not patch any individual test file's timeout as part of this Work Unit
-- per-file vi.setConfig() patches are the exact reactive pattern this
milestone exists to replace, not extend.

Required starting checks

Before modifying anything:

Confirm branch is main.

Confirm working tree is clean.

Confirm no product .aiqt/ exists in the AIQT repository.

Record:

starting commit SHA;

package version;

canonical schema version;

Node version (record which major version is actually running locally);

pnpm version.

Confirm M33 closure:

closure commit de02cb4 (or its verified full SHA);

closure tag m33-unified-cli-result-contract;

closure report docs/engineering/m33-closure-report.md;

package version 0.19.0;

canonical schema version 0.5.0.

Read:

M34 specification;

owner map (docs/engineering/repository-owner-map.json);

governance documents (docs/engineering/milestone-protocol.md);

M33 closure report;

vitest.config.ts and every per-file vi.setConfig({ testTimeout }) override
currently in the test suite.

Do not rely on historical audit line numbers or prior milestones' measured
runtimes -- re-measure on the current baseline.

If the baseline differs materially from the stated M33 closure baseline,
stop and report the difference.

WU34-01 objective

Establish the evidence base and the target policy before any runtime
change. Characterize exactly why and how `pnpm test` fails to pass
reliably, classify every test file into a workload class, and define
(in a new policy document) what timeout/concurrency/isolation contract
each class requires -- without yet implementing it.

Required investigation

1. Inventory every test file under tests/unit/ and tests/integration/.
   For each, record: file, approximate test count, whether it spawns a
   real CLI subprocess (grep for spawnSync/execFileSync against tsx or
   dist/index.js), whether it touches a real Git repository/worktree,
   whether it exercises evidence-gate/execution/workspace command
   families, and whether it already carries a per-file
   vi.setConfig({ testTimeout }) override (list every one found, with its
   configured value).

2. Run the official full validation command (`pnpm test`, i.e.
   `vitest run` with no flags -- the exact command CI and
   package.json#scripts.test invoke) at least twice in a row on this
   machine. For each run, capture: total files/tests passed and failed,
   and for every failure, whether it is a bare
   "Test timed out in 5000ms" with zero assertion output, or something
   else. Do not average these into a single number -- report each run's
   raw result.

3. Run a representative sample of the process-heavy files identified in
   step 1 in isolation (no concurrent load) and measure wall-clock time
   per test, to establish each workload class's actual floor cost
   independent of concurrency.

4. Run the same full suite under at least two different Vitest
   concurrency/worker settings (e.g. current default pool vs. a reduced
   maxWorkers/fileParallelism setting) and record whether failure count
   changes, to characterize how much of the instability is concurrency-
   induced versus inherent per-test cost.

5. If a second Node major version (22 or 24, whichever this environment
   does not default to) is available via nvm, volta, corepack, or a
   system install, run the same full command under it and record the
   comparison. If genuinely unavailable in this environment, state that
   explicitly rather than fabricating a result -- do not skip reporting
   this requirement silently.

6. Compare the exact command `.github/workflows/validate.yml` runs
   against the exact command a local contributor runs
   (`pnpm test`/`pnpm validate`). Record any divergence in flags,
   environment variables, or invocation shape.

7. Inventory the existing static architecture/security allowlist tests
   (the M27/M27R/M28 boundary-scan tests, and the M33
   local-failure-helper/raw-text-bypass architecture guards) and record,
   for each, whether it discovers its file set dynamically (e.g. via
   readdirSync over a directory) or from a frozen, hand-maintained
   literal list that a new file could silently bypass.

Required workload classification

Assign every test file to one of the six classes in the M34 specification
Sec 5.1 (fast unit; filesystem integration; process-spawning CLI
integration; Git/worktree integration; evidence/execution integration;
built-binary smoke -- note the last class does not exist yet and should be
recorded as "not yet populated, owned by WU34-03"). For each class that
does have files, propose (in the new policy document, not in code):
expected runtime range, a justified timeout value, a concurrency
recommendation, isolation requirements, supported platforms, and what
failure diagnostics should distinguish (timeout vs. assertion vs.
spawn failure vs. environment failure).

Required policy document

Create one new document -- suggested path
docs/engineering/m34-wu01-validation-workload-policy.md -- containing:
the full file-by-file inventory and classification from the steps above;
the measured runtime/failure evidence (raw, not summarized away); the
Node 22 vs. 24 comparison or explicit unavailability statement; the
CI/local command comparison; the architecture-guard dynamic-vs-static
inventory; and the target policy per workload class that WU34-02 will
implement. This document is the primary deliverable of WU34-01.

Update docs/engineering/repository-owner-map.json only if a new durable
ownership fact needs recording (e.g. naming the future owner of a shared
timeout-policy module WU34-02 will introduce) -- do not restate content
that belongs in the new policy document instead.

Implementation boundaries

WU34-01 should:

add the workload-characterization policy document;

add or update an owner-map entry if a genuinely new durable ownership
fact was established;

add characterization evidence (raw command output, tables) to that
document;

report Node-version and CI/local comparisons honestly, including
"unavailable" where genuinely unavailable.

WU34-01 should not:

change vitest.config.ts;

add, remove, or change any per-file vi.setConfig({ testTimeout }) call;

change any test's assertions, skip any test, or exclude any platform;

change package.json scripts or CI workflow files;

change schema version, package version, or any runtime dependency;

touch dist/index.js or add built-binary smoke tests (WU34-03 scope);

use AIQT commands or create .aiqt/ state in this repository.

Required validation

- corepack pnpm typecheck
- corepack pnpm lint
- corepack pnpm build
- corepack pnpm version:check
- git diff --check
- Report the official full test command's result honestly (per the
  measurement steps above) -- do not conceal or average away the known
  timeout-class baseline, and do not claim it is fixed. WU34-01 does not
  fix it.

Git discipline

After validation:

Confirm only WU34-01-related files changed (the new policy document,
and the owner map only if genuinely updated). No test file's runtime
behavior or timeout configuration should appear in this diff.

Create one detailed commit.

Commit body must include: the workload classification summary; the raw
measured evidence (or a pointer to where it lives in the new document);
Node 22/24 comparison result or explicit unavailability; CI/local
command comparison result; residual risks; a risk score from 0-100.

Create tag:

m34-wu01-validation-workload-policy

Do not push.

Required final report

Return:

Baseline (branch, starting commit, package/schema versions, Node/pnpm
versions, confirmation product .aiqt/ is absent, M33 closure
confirmation).

Inventory (file-by-file workload classification, existing timeout-
override inventory).

Measurements (raw full-suite run results across at least two runs;
isolated per-class timing; concurrency-setting comparison; Node 22 vs.
24 comparison or explicit unavailability; CI/local command comparison).

Policy (the workload-class timeout/concurrency/isolation contract
proposed for each class, to be implemented in WU34-02 -- not yet
implemented here).

Architecture-guard inventory (dynamic vs. static discovery per existing
guard).

Validation (typecheck/lint/build/version-check/diff-check results; full
test command's honest raw result).

Scope control (explicitly confirm no timeout configuration, test
assertion, schema, package version, or dependency was changed).

Git evidence (commit SHA, tag, final status).

Risk (implementation risk score; residual risks; whether WU34-02 may
begin).

Begin with baseline verification and the test-file inventory. Do not
change any timeout or concurrency configuration until the policy
document is written and the current failure mode is fully evidenced.
```
