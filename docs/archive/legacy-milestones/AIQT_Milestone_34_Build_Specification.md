# AIQT Milestone 34 Build Specification

## Deterministic Test Execution and Validation Gate Hardening

**Product:** AIQT CLI  
**Milestone:** M34  
**Status:** Ready for implementation review  
**Risk classification:** Medium-to-high  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 4  
**Primary objective:** Make AIQT's official validation command deterministic, repeatable, and trustworthy across supported Node versions and operating systems.

---

## 1. Source Alignment

M34 follows the formal closure of M33.

### Expected baseline

- Package version: `0.19.0`
- Canonical schema version: `0.5.0`
- M33 closure commit: `de02cb4` or its verified full SHA
- M33 closure tag: `m33-unified-cli-result-contract`

M33 unified command results, exit-code/body semantics, parser-level JSON behavior, JSON stdout routing, human rendering, and the external machine contract.

M34 addresses the remaining validation-infrastructure blocker:

> The official full test command does not reliably pass on a clean baseline because process-heavy integration suites exceed Vitest's default 5000 ms timeout under full-suite concurrency.

The governing principle is:

```text
systemic workload-based validation policy
not
reactive per-file timeout patching
```

Do not use AIQT commands or create `.aiqt/` self-management state in the AIQT repository.

---

## 2. Milestone Objective

M34 must establish that:

1. The official local validation command is reliable.
2. CI and local validation use the same authoritative policy.
3. Timeout and concurrency settings are based on test workload classes.
4. Process-heavy tests do not depend on scattered per-file timeout overrides.
5. Node 22 and Node 24 behave consistently.
6. The built CLI artifact receives direct smoke coverage.
7. Repeated clean runs produce stable outcomes.
8. Validation distinguishes assertion regressions from infrastructure timeouts.
9. Architecture/security guards cannot silently omit newly added files.
10. Maintainers have one documented merge gate they can trust.

M34 must not hide slow tests behind arbitrary blanket timeouts without characterization.

---

## 3. Findings in Scope

- **HIGH-013:** Official `pnpm test` fails on a clean baseline.
- **MED-016:** The previous 15-second invocation is not reliably deterministic.
- **LOW-013:** CLI tests primarily execute TypeScript source rather than the built `dist/index.js`.
- **LOW-014:** Some architecture/security guards use frozen hand-maintained allowlists.
- Node 22 versus Node 24 variance found during characterization.
- Full-suite concurrency and subprocess startup costs.
- CI/local command drift.

---

## 4. Out of Scope

M34 must not implement:

- New product functionality.
- Workflow, schema, persistence, or result-contract changes.
- Autonomous execution.
- Broad dependency upgrades.
- Unrelated test rewrites.
- Test skipping.
- Platform exclusions.
- Extremely high global timeouts without evidence.
- AIQT self-dogfood.

---

## 5. Governing Decisions

### 5.1 Test workload classes

Classify tests into:

1. Fast unit tests.
2. Filesystem integration tests.
3. Process-spawning CLI integration tests.
4. Git/worktree integration tests.
5. Evidence/execution integration tests.
6. Built-binary smoke tests.

Each class must define:

- expected runtime;
- timeout policy;
- concurrency policy;
- isolation requirements;
- supported platforms;
- failure diagnostics.

### 5.2 Official validation command

The repository must expose one authoritative full validation command.

Preferred sequence:

```text
typecheck
lint
build
tests under supported runtime matrix
version check
```

Local and CI commands must not diverge semantically.

### 5.3 Timeout policy

Use workload-level configuration, such as:

- Vitest projects/workspaces;
- shared test helpers;
- explicit per-class timeout constants;
- controlled concurrency for subprocess-heavy suites.

Per-file `vi.setConfig()` patches are transitional only.

### 5.4 Concurrency policy

Account for:

- Node startup;
- filesystem contention;
- Git worktrees;
- Windows process cost;
- CI resource limits;
- evidence/execution setup.

Reduced concurrency is acceptable if measured and justified.

### 5.5 Repeated-run gate

A single green run is insufficient.

Closure should require at least:

```text
5 consecutive full validation runs
```

across Node 22 and Node 24 and supported CI platforms.

### 5.6 Built artifact

At least one smoke suite must execute the built CLI entry point:

```text
dist/index.js
```

or the packaged binary equivalent.

### 5.7 Failure classification

Reporting must distinguish:

- assertion failure;
- timeout;
- process-spawn failure;
- dependency/environment failure;
- platform infrastructure failure.

### 5.8 Dynamic guard coverage

Architecture/security guards should discover relevant files dynamically where practical. New files must not silently escape validation.

---

## 6. Work Units

## WU34-01 — Validation Workload Characterization and Policy Contract

**Risk:** 25/100  
**Objective:** Measure the failure class, classify workloads, and define timeout/concurrency policy before changing runtime behavior.

### Scope

- Inventory test files and helpers.
- Identify process-spawning, Git/worktree, and evidence/execution/workspace-heavy tests.
- Inventory timeout overrides.
- Measure default and targeted runs under different worker counts.
- Compare Node 22 and Node 24 where available.
- Compare CI and local commands.
- Define workload classes and policy.
- Do not implement systemic timeout changes.

### Acceptance criteria

- Every test is assigned or assignable to a workload class.
- Existing timeout overrides are inventoried.
- Dominant timeout causes are evidenced.
- Concurrency impact is measured.
- Node-version impact is measured or explicitly unavailable.
- One policy document defines timeout and concurrency requirements.
- No product behavior, schema, or package-version change.

### Commit and tag

```text
m34-wu01-validation-workload-policy
```

---

## WU34-02 — Systemic Timeout and Concurrency Controls

**Risk:** 50/100  
**Objective:** Implement workload-based runtime controls.

### Scope

- Introduce shared Vitest configuration by workload class.
- Replace scattered timeout patches where safe.
- Apply controlled worker policies to process-heavy suites.
- Preserve fast unit feedback.
- Improve timeout diagnostics.
- Align the official test script.

### Acceptance criteria

- Process-heavy tests no longer rely on 5000 ms.
- One shared policy governs the workload class.
- Fast unit tests retain fast failure.
- No tests are skipped or weakened.
- Full suite passes on the primary development platform.
- Targeted suites remain independently runnable.

### Commit and tag

```text
m34-wu02-systemic-test-runtime-controls
```

---

## WU34-03 — Built-Binary and Repeated-Run Validation

**Risk:** 40/100  
**Objective:** Add shipped-artifact coverage and prove repeated-run reliability.

### Scope

- Add smoke tests for `dist/index.js` or the packaged CLI.
- Compare source and built CLI behavior.
- Add repeated-run automation.
- Validate Node 22 and 24.
- Validate supported operating systems in CI.
- Improve dynamic architecture/security discovery where in scope.

### Acceptance criteria

- Built binary executes in CI after build.
- Representative help, JSON, parser-error, and project-state commands pass against `dist`.
- Source and built output are substantively consistent.
- Five consecutive full runs pass in required environments.
- New relevant files cannot silently escape architecture/security scans.

### Commit and tag

```text
m34-wu03-built-binary-repeated-validation
```

---

## WU34-04 — CI, Scripts, Documentation, and Closure

**Risk:** 25/100  
**Objective:** Make the hardened policy the official repository and CI contract.

### Scope

- Align package scripts and CI.
- Document local and CI validation.
- Remove obsolete timeout guidance.
- Record supported Node versions.
- Add troubleshooting guidance.
- Produce the closure report.
- Bump package version only if repository policy requires it.

### Acceptance criteria

- One documented official validation command exists.
- CI uses the same policy as local validation.
- Node 22 and 24 gates are explicit.
- Five consecutive runs pass.
- No timeout-baseline exception remains.
- Closure report records runtime trade-offs and residual risk.
- Working tree is clean.

### Commit and tags

```text
m34-wu04-validation-gate-closure
m34-deterministic-validation-gate
```

---

## 7. Cross-Work-Unit Invariants

1. No AIQT self-management state.
2. Default branch remains `main`.
3. One detailed commit and tag per Work Unit.
4. Commit body includes validation and a `0–100` risk score.
5. No unrelated product changes.
6. No skipped tests.
7. No hidden assertion regressions.
8. No arbitrary global timeout without characterization.
9. No unsupported platform exclusion.
10. Exact commands and repeated-run evidence are reported.

---

## 8. Milestone Verification Gate

M34 is complete only when:

- workload classes are documented;
- timeout and concurrency policies are centralized;
- local and CI commands align;
- the official full validation command passes;
- the built CLI is tested;
- Node 22 and Node 24 pass;
- supported CI platforms pass;
- five consecutive clean runs pass;
- no timeout-only baseline exception remains;
- architecture/security guards cover new files;
- all Work Unit commits and tags exist;
- final working tree is clean.

---

## 9. Closure Report Requirements

The closure report must include:

- starting and ending commits;
- package/schema versions;
- Work Unit commit/tag table;
- workload classification;
- timeout and concurrency policy;
- before/after runtime measurements;
- Node 22/24 results;
- operating-system results;
- built-binary results;
- five-run reliability evidence;
- CI/local alignment;
- findings closed or reduced;
- remaining validation risks;
- recommendation on whether autonomous-execution planning may resume.

---

## 10. Residual Risk

Autonomous execution remains deferred until M34 closes successfully.

After M34, autonomous-maintenance planning may resume only if canonical-state, workflow-assessment, CLI-contract, and full-validation gates remain green.
