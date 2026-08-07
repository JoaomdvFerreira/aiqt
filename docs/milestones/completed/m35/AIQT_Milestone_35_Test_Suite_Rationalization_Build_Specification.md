# AIQT Milestone 35 Build Specification

## Test Suite Rationalization and CI Acceleration

**Product:** AIQT CLI  
**Milestone:** M35  
**Status:** Ready for implementation review  
**Risk classification:** High-risk  
**Protocol:** Lean Milestone Protocol  
**Work Units:** 4  
**Primary objective:** Reduce AIQT CI duration from more than 11 minutes toward a reliable target below 5 minutes while preserving critical regression coverage and improving the relevance, maintainability, and architectural placement of the 2,000+ test suite.

---

## 1. Source Alignment

M35 follows M34 — Deterministic Test Execution and Validation Gate Hardening.

M34 established workload-scoped timeout policy, built-binary smoke coverage, repeated-run tooling, dynamic architecture discovery, and build-before-test validation ordering.

M35 addresses the next bottleneck:

> The AIQT test suite contains more than 2,000 tests and CI duration exceeds 11 minutes. The suite likely contains duplicated, obsolete, misplaced, brittle, over-mocked, or unnecessarily expensive tests.

The governing principle is:

```text
reduce waste
preserve signal
measure everything
```

Do not use AIQT commands or create `.aiqt/` self-management state inside the AIQT repository.

---

## 2. Runtime Support and CI Decision

### Node 24

Node 24 is the mandatory per-commit CI runtime.

### Node 22

Node 22 is removed from the mandatory per-commit CI matrix.

WU35-01 must inspect and reconcile:

- `package.json` `engines.node`;
- README support statements;
- CI matrix;
- versioning policy;
- release policy.

Choose one explicit policy:

```text
Preferred:
Official runtime: Node 24
Node 22: unsupported
```

or:

```text
Transitional:
Per-commit CI: Node 24
Node 22: periodic compatibility only
```

The repository must not promise Node 22 support while never validating it.

---

## 3. Milestone Objective

M35 must establish that:

1. Every test has a known purpose and workload classification.
2. Critical regression coverage is explicitly protected.
3. Obsolete tests are removed only with evidence.
4. Duplicated tests are merged or reduced.
5. Low-signal tests are rewritten or decommissioned.
6. Tests are moved to the correct layer where beneficial.
7. Expensive CLI, Git, worktree, and process tests are minimized without losing end-to-end confidence.
8. CI topology avoids unnecessary duplication.
9. Node 24 is the mandatory per-commit runtime.
10. CI completes in less than five minutes where safely achievable.
11. No test is removed merely to improve the headline runtime.

---

## 4. Success Metrics

Primary target:

```text
Authoritative per-commit CI duration < 5 minutes
```

Required quality conditions:

- zero known critical regression gaps;
- zero skipped tests introduced for speed;
- zero hidden assertion regressions;
- critical test set preserved;
- built-binary smoke retained;
- Node 24 green;
- no per-file timeout proliferation.

Before and after M35, record:

- total CI wall-clock;
- test execution and collection time;
- build time;
- slowest files and tests;
- process and worker counts;
- total test/file counts;
- duplicate candidates;
- flaky tests;
- timeout and assertion counts;
- built-binary coverage;
- critical coverage map.

---

## 5. Criticality Model

Classify tests as:

- **Critical**
- **High-value**
- **Normal**
- **Low-signal**
- **Duplicate**
- **Obsolete**
- **Misplaced**
- **Flaky**
- **Performance-heavy**

Critical coverage includes canonical state, schema compatibility, persistence, runlog recovery, workflow assessment, corruption repair, CLI machine contract, exit-code invariants, built-binary behavior, security boundaries, Git/worktree safety, evidence binding, and execution lifecycle.

Critical and high-value tests require explicit owner review before semantic reduction.

---

## 6. Evidence Before Removal

Every removed or merged test must record:

```text
test or suite
→ behavior covered
→ reason
→ equivalent remaining coverage
→ criticality
→ risk
→ validation evidence
→ runtime impact
```

Deletion without equivalent coverage is allowed only when the tested behavior is demonstrably obsolete or invalid.

Raw test count is not a quality metric.

---

## 7. Work Units

## WU35-01 — Test Inventory, Criticality, Runtime Baseline, and Node Contract

**Risk:** 30/100  
**Objective:** Build the complete evidence base before changing the suite.

### Scope

- inventory all tests;
- classify workload and criticality;
- measure runtime;
- identify duplicate, obsolete, low-signal, misplaced, flaky, and expensive candidates;
- identify process, filesystem, Git/worktree, evidence/execution, and built-binary tests;
- review Node support contract;
- define deletion-evidence policy;
- do not delete tests.

### Required artifacts

```text
docs/engineering/m35-test-suite-inventory.md
docs/engineering/m35-test-rationalization-policy.md
```

### Tag

```text
m35-wu01-test-inventory-and-node-contract
```

---

## WU35-02 — Obsolete, Duplicate, and Low-Signal Test Reduction

**Risk:** 55/100  
**Objective:** Remove or merge coverage that no longer provides proportional value.

### Acceptance criteria

- every deletion has evidence;
- critical/high-value tests are preserved or explicitly reviewed;
- no skipped tests;
- no product behavior changes;
- targeted and full validation pass;
- before/after runtime and test counts recorded.

### Tag

```text
m35-wu02-test-suite-rationalization
```

---

## WU35-03 — Test Layer and Runtime Optimization

**Risk:** 60/100  
**Objective:** Move valid coverage to cheaper layers and reduce expensive repeated setup.

Examples:

```text
CLI subprocess → service-level test
full filesystem fixture → focused fixture
repeated Git setup → shared helper
repeated build → reusable build
multiple subprocesses → batched scenario
integration assertion → unit assertion where equivalent
```

A representative end-to-end spine must remain.

### Tag

```text
m35-wu03-test-layer-runtime-optimization
```

---

## WU35-04 — CI Topology, Under-Five-Minute Gate, and Closure

**Risk:** 45/100  
**Objective:** Apply the rationalized suite to per-commit CI and prove the final runtime.

### Scope

- remove Node 22 from mandatory per-commit CI;
- make Node 24 authoritative;
- align package scripts and CI;
- optimize job topology;
- reuse build outputs safely;
- parallelize by workload where beneficial;
- retain optional periodic Node 22 compatibility only if the support contract requires it;
- produce closure report.

### Acceptance criteria

- Node 24 CI passes;
- per-commit CI is below five minutes where safely achievable;
- no critical coverage loss;
- zero timeout and assertion failures;
- no skipped tests;
- built-binary smoke passes;
- CI/local commands align;
- working tree clean.

### Tags

```text
m35-wu04-ci-acceleration-and-closure
m35-test-suite-rationalization
```

---

## 8. Cross-Work-Unit Invariants

1. No AIQT self-management.
2. Default branch remains `main`.
3. One commit and tag per Work Unit.
4. Every commit includes a 0–100 risk score.
5. No test deletion without evidence.
6. No skipped tests for performance.
7. No critical coverage loss.
8. No hidden assertion failures.
9. No arbitrary timeout expansion.
10. Node 24 remains mandatory.
11. Built-binary validation remains.
12. Runtime and coverage are measured before and after.

---

## 9. Verification Gate

M35 is complete only when:

- every test file is classified;
- critical coverage is documented;
- obsolete and duplicate coverage is rationalized;
- expensive tests are optimized;
- Node support contract is explicit;
- Node 22 is removed from mandatory per-commit CI;
- Node 24 CI is authoritative;
- full validation is green;
- built-binary tests remain green;
- CI runtime is below five minutes or the best safe runtime is justified;
- all Work Unit commits/tags exist;
- final tree is clean.

---

## 10. Closure Report Requirements

Include:

- starting/ending commits;
- package/schema versions;
- Node support decision;
- Work Unit table;
- baseline/final CI times;
- test/file counts before and after;
- critical coverage map;
- removed/merged tests with evidence;
- layer migrations;
- slowest remaining suites;
- timeout/assertion counts;
- built-binary results;
- CI topology;
- residual risks;
- recommendation on whether autonomous-runner planning may resume.

---

## 11. Sequencing

The previously drafted autonomous-runner milestone moves to:

```text
M36 — Autonomous Maintenance Runner and Safety Controls
```

M36 implementation must not begin until M35 closes successfully.
