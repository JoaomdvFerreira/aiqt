# IH-01 — Flake/Timeout Isolation Evidence

Companion to [`ih01-baseline.md`](ih01-baseline.md) §5. Produced per
`docs/governance/milestone-protocol.md` §5: an unexplained local
full-suite failure is **isolated and classified**, never resolved by
re-running the full suite until it goes green.

## Method

1. One full local baseline run (`vitest run --reporter=json`, default
   16-way `threads` pool) — 17 failing tests across 12 files.
2. One re-run of the 11 files carrying the 16 timeout failures, with
   **`--no-file-parallelism`** (single worker, no concurrent contention),
   same commit, same machine, same timeout constants. No timeout value was
   changed, no assertion was touched, no test was re-run more than once.

Each file therefore appears exactly twice: once under contention, once
isolated. Nothing was re-run to obtain a green result.

## Result

| File (`tests/integration/`) | Contended | Isolated | Ratio |
| --- | --: | --: | --: |
| `evidence-advisory-hardening.test.ts` | 94.0s / **2 fail** | 41.7s / 0 fail | ×2.25 |
| `evidence-gate-full-lifecycle.test.ts` | 44.6s / **1 fail** | 18.4s / 0 fail | ×2.43 |
| `evidence-gate-policy.test.ts` | 87.9s / **1 fail** | 36.8s / 0 fail | ×2.39 |
| `evidence-gate-simulate.test.ts` | 159.1s / **2 fail** | 66.4s / 0 fail | ×2.40 |
| `execution-adapter-claude-code-full-lifecycle.test.ts` | 43.2s / **1 fail** | 18.2s / 0 fail | ×2.37 |
| `execution-adapter-claude-code-import.test.ts` | 140.5s / **3 fail** | 53.6s / 0 fail | ×2.62 |
| `execution-external-import.test.ts` | 123.0s / **1 fail** | 50.9s / 0 fail | ×2.42 |
| `execution-hardening.test.ts` | 85.1s / **1 fail** | 36.5s / 0 fail | ×2.33 |
| `execution-workflow-integration.test.ts` | 66.5s / **2 fail** | 27.4s / 0 fail | ×2.43 |
| `m33-result-contract-characterization.test.ts` | 191.6s / **1 fail** | 80.3s / 0 fail | ×2.39 |
| `workspace-cli.test.ts` | 87.5s / **1 fail** | 38.0s / 0 fail | ×2.30 |
| **Total** | **1123s / 16 failures** | **468s / 0 failures (93 tests)** | **×2.40** |

## Classification

**Family A — load-induced timeout, not a correctness defect.** All 16
failures reproduce only under concurrency, all 93 tests pass in isolation,
and the amplification factor is strikingly uniform (×2.25–×2.62, mean
×2.40) across eleven independently-written files. A genuine functional
regression does not distribute itself that evenly across unrelated
suites; a shared per-process cost multiplied by worker count does.

**Root cause (not a symptom):** every one of these files spawns the CLI
via `tsx src/index.ts`, at a measured **2882 ms per spawn** versus
**1076 ms** for the already-built `dist/index.js`
(`ih01-baseline.md` §4.3). Under N concurrent workers the machine is
executing N simultaneous full TypeScript transforms, so the
15000 ms/25000 ms class budgets in `tests/workload-timeout-policy.ts` are
consumed by process startup rather than by the assertions they were sized
for.

**Explicitly rejected remedies** (per the intervention's §7 flake policy
and `test-rationalization-policy.md` §5's "Flaky" row):

- raising `SPAWNING_SUITE_TEST_TIMEOUT_MS` / adding per-file overrides —
  reactive escalation, forbidden as a primary fix;
- lowering worker concurrency alone — trades the symptom for wall-clock
  and does nothing about the 2882 ms;
- re-running until green — forbidden, and never done here.

**Accepted remedy:** remove the per-spawn transform cost itself (IH-04).

## CI-side flake cost

The last 20 `Validate` runs (`main` pushes and milestone PRs, 2026-08-07
→ 2026-08-09) are all `success` with **no rerun and no timeout failure**;
CI's 4-core/3-shard split keeps per-runner worker pressure below the
threshold this local 16-way run crosses. Measured rerun/flaky-run cost
over that window: **0 runner-minutes**.

This matters for IH-02: consolidating to one job raises per-runner worker
pressure back up, so the concurrency setting and the IH-04 spawn-cost fix
must be validated together, not independently.

## Family B — one pre-existing, environment-specific guard failure

`tests/unit/m34-validation-workload-inventory.test.ts` →
*"the 'trailing-line' inline-timeout shape … matches the recorded 2-file
baseline exactly"*.

Reproduced in isolation (`vitest run tests/unit/m34-validation-workload-inventory.test.ts`
→ 1 failed / 8 passed, 806 ms), so it is **not** a load flake. It fails on
unmodified `main` at the base commit.

Cause: the guard matches `/\n\s*(\d{4,7}),\n\s*\);/`. Under
`core.autocrlf=true` the working tree is CRLF, so `,\n` cannot match
`,\r\n` and `tests/integration/cli.test.ts:127` (which does carry that
shape) goes undetected — one of the two recorded files is found instead of
two. On CI's Linux/LF checkout both match and the guard passes, which is
why every `Validate` run is green.

Classified as a **line-ending sensitivity in a repository guard**: a real
defect in the guard's portability, not a regression, not a product defect,
and not caused by this intervention. Recorded here; remediated in IH-04
by making the guard line-ending-agnostic without changing what it asserts.
