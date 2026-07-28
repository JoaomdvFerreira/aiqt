# M30 Correction — Node 22 Integration Test Timeouts

Records the diagnosis and fix for the three Node 22-only CI timeouts observed
in the real CI run for the M30-WU07 version-bump commit (`81ec79c`), and the
narrow per-file correction applied. Not a milestone re-open — M30 remains
closed; this is a small, standalone reliability correction on top of it.

```yaml
correction:
  trigger: real CI run 30387515721, validate (22) job, Test step
  failed_tests: 3
  failure_signature: "Error: Test timed out in 5000ms"
  files:
    - tests/integration/execution-adapter-claude-code-import.test.ts
    - tests/integration/execution-external-import.test.ts
    - tests/integration/execution-hardening.test.ts
  root_cause: >
    Each failing test drives the real CLI through 4-5 real subprocess spawns
    (tsx transpile + Node startup per spawn, no build cache in the test path,
    plus real `git commit` subprocesses in two of the three files). Measured
    isolated runtime on this repository's fastest available Node runtime
    (Node 24) is already 4.9-6.2s for these specific tests -- inherently
    close to or above the vitest default 5000ms testTimeout even with zero
    concurrent load. Under CI's Node 22 leg, running inside the full 221-file
    suite, the same tests exceed the budget.
  classification: genuinely long-running due to real multi-subprocess CLI
    workload; not duplicated setup, not a product or test defect, not
    generic shared-machine flakiness (reproduces in isolation on the
    fastest available runtime).
  fix: >
    Added `vi.setConfig({ testTimeout: 15000 })` at the top of each of the
    three affected files only. This is a per-file scoped override (Vitest's
    documented mechanism for this), not a change to vitest.config.ts and not
    a global timeout increase. 15000ms was chosen to match the ad hoc
    validation budget already used throughout M30's own local/CI validation
    runs, giving roughly 2.4x headroom over the worst measured runtime
    (6.2s) for this exact workload class.
  production_code_changed: false
  assertions_changed: false
  lifecycle_steps_removed: false
  tests_added_or_removed: false
  global_timeout_changed: false
  residual_risk: 6/100
```

## Measurement evidence

Isolated, Node 24, no concurrent load, default (unset) testTimeout:

| Test | Isolated runtime |
|---|---|
| `execution-adapter-claude-code-import.test.ts` — "a limited (max-turn) result..." | ~5.2s |
| `execution-external-import.test.ts` — "agent switching..." | ~5.1s |
| `execution-hardening.test.ts` — "sequential envelopes..." | ~4.9s |

All three fail under the vitest default 5000ms testTimeout even in isolation
on the fastest available runtime — confirming this is inherent subprocess
cost for this workload class, not machine-load-induced flakiness alone (load
narrows the margin further, but the margin was already near zero).

## Why this is the narrowest correct fix

- No production code was touched.
- No assertion, lifecycle step, or test was removed, weakened, or skipped.
- The override is scoped to exactly the three files whose tests structurally
  share the same workload (the same `runCli` subprocess-spawning helper,
  4-5 invocations per affected test) and whose tests were the ones CI
  actually reported as failing.
- `vitest.config.ts`'s global `testTimeout` was left untouched; no
  repository-wide timeout change was made.
- The value (15000ms) is not arbitrary: it is the same budget already used
  as this repository's working validation headroom throughout every prior
  M27R/M28/M29/M30 local and clean-clone validation run.
