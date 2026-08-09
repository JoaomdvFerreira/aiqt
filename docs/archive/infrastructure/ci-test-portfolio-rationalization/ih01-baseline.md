# IH-01 — Measured GitHub Actions and Test-Portfolio Baseline

**Work Unit:** IH-01 (measurement only — no CI topology change, no test change)
**Branch:** `infra/ci-test-portfolio-rationalization`
**Base commit:** `679abcd` (`main`, post-M45, post-`pr:ready` governance commit)
**Package version:** `0.40.0` · **Canonical schema version:** unchanged (not read/altered by this work)
**Date measured:** 2026-08-09

Every number below is measured, not estimated. GitHub figures come from
completed-run metadata already produced by ordinary development
(`GET /repos/:owner/:repo/actions/runs/:id/jobs`); **no benchmark workflow
run was triggered for this Work Unit**, per the intervention's
Actions-cost discipline.

## 1. Entry gate

| Check | Result |
| --- | --- |
| M45 merged to `main` | ✅ `a9f06f4` "M45: Background Maintenance Scheduling" |
| M45 post-merge `main` Validate green | ✅ run `31280077450`, `success`, 6m07s |
| `main` current locally | ✅ fast-forwarded to `679abcd` |
| Working tree clean (tracked files) | ✅ — see §6.3 for two untracked test-generated artifacts |
| No M46 work started | ✅ no `m46` branch, tag, spec, or commit |
| No `.aiqt/` self-management state | ✅ absent |

## 2. Current CI topology

`.github/workflows/validate.yml` — one workflow (`Validate`), triggered on
`push` to `main` and on every `pull_request`. Four job definitions, six job
instances per run:

```text
quality        (checkout → pnpm setup → node 24 + pnpm cache → install → typecheck → lint)
build          (checkout → setup → install → build → upload dist artifact)
test (1..3)    needs: build     (checkout fetch-depth:0 → setup → install → download dist → vitest --shard=N/3)
version-check  needs: build,test (checkout fetch-depth:0 → setup → install → download dist → version:check ×3 steps)
```

No `concurrency:` block. No stale-run cancellation. `pnpm` store caching is
present and working (`actions/setup-node@v7` with `cache: pnpm`).

## 3. Measured runner-minutes

GitHub bills **per job, rounded up to the whole minute**. Runner-minutes
below apply that model to real `started_at`/`completed_at` job timestamps.

### 3.1 Representative recent successful runs

| Run | Event | quality | build | test(1) | test(2) | test(3) | version-check | **billed min** |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| `31279723051` (M45 PR) | pull_request | 1 | 1 | 5 | 5 | 5 | 1 | **18** |
| `31280077450` (M45 main) | push main | 1 | 1 | 5 | 5 | 5 | 1 | **18** |
| `31273159526` (M44 PR) | pull_request | 1 | 1 | 5 | 6 | 5 | 1 | **19** |
| `31273580834` (M44 main) | push main | 1 | 1 | 5 | 5 | 5 | 1 | **18** |
| `31264127719` (M43 PR) | pull_request | 1 | 1 | 5 | 5 | 5 | 1 | **18** |
| `31266307282` (M43 main) | push main | 1 | 1 | 5 | 5 | 5 | 1 | **18** |
| `31257458646` (M42 PR) | pull_request | 1 | 1 | 4 | 5 | 4 | 1 | **16** |
| `31258129386` (M42 main) | push main | 1 | 1 | 4 | 4 | 5 | 1 | **16** |

### 3.2 Baseline KPI

| Metric | Baseline |
| --- | --: |
| Jobs per run | **6** |
| PR validation runner-minutes (mean of 4) | **17.75** |
| Post-merge `main` runner-minutes (mean of 4) | **17.50** |
| **Runner-minutes per safely merged code change (PR + main)** | **35.25** |
| PR wall-clock feedback (mean) | **~5m55s** |
| Raw (unrounded) job-seconds per run | ~934s = 15.6 min |
| Per-run rounding overhead | ~2.4 min (15% of the bill) |

### 3.3 Where the runner-minutes go (run `31280077450`, per-step)

| Contribution | Seconds | Note |
| --- | --: | --- |
| vitest execution (3 shards) | **776** | 227 + 274 + 275 |
| checkout + pnpm/action-setup + setup-node + install | **~64** | ~10–13s × 6 jobs; **5 of the 6 are duplicate work** |
| typecheck | 11 | |
| lint | 9 | |
| build (`tsc`) | 11 | |
| artifact upload + 3 downloads | ~8 | |
| version:check (3 steps) | ~5 | |
| job set-up/tear-down (`Set up job`, `Post Run …`, `Complete job`) | ~20 | ~3.3s × 6 jobs |

`pnpm install --frozen-lockfile` costs **1–3s** per job — the pnpm store
cache is already effective, so *install* is not a meaningful optimization
target; *duplicate job set-up plus per-job minute rounding* is.

**Conclusion for IH-02:** ~96% of the workload is test execution. A
one-job topology removes ~5 duplicate setup cycles (~64s) and ~5 rounding
remainders (~2.4 min), but by itself cannot reach the ≥35% target — the
target requires reducing the 776s of test execution (IH-03/IH-04).

## 4. Test-portfolio baseline

Measured from one full local `vitest run --reporter=json` on the base
commit (Node v24.14.0, Windows 10, Ryzen 7 3800X 8c/16t), and classified
with the live M35 inventory tooling (`src/tooling/test-inventory-cli.ts`).
Machine-readable record:
[`ih01-test-portfolio-inventory.generated.json`](ih01-test-portfolio-inventory.generated.json).

| Metric | M35 baseline | **IH-01 baseline** |
| --- | --: | --: |
| Test files | 233 | **336** |
| Tests (actual) | 2401 | **3510** |
| `tests/unit/` | 122 | **191** |
| `tests/integration/` | 111 | **145** |
| Skipped/conditional files | 2 (reviewed) | **3** (reviewed — see §6.2) |
| Summed per-file duration | — | **2660s** |
| Local wall-clock (16 threads) | — | **259s** |

### 4.1 Criticality distribution

| Criticality | Files | Share of measured time |
| --- | --: | --: |
| Critical | 140 | 25.3% (673s) |
| High-value | 105 | 70.6% (1877s) |
| Normal | 91 | 4.2% (111s) |
| Low-signal | 0 | — |

### 4.2 Cost concentration by workload class — the central finding

| Workload class | Files | Time | Share |
| --- | --: | --: | --: |
| evidence/execution/workspace integration | 21 | 1472s | **55.3%** |
| CLI subprocess integration (general) | 11 | 869s | **32.7%** |
| Git/worktree integration | 25 | 222s | 8.4% |
| filesystem integration | 88 | 59s | 2.2% |
| built-binary smoke | 1 | 21s | 0.8% |
| fast unit | 190 | 17s | 0.6% |

**33 files that spawn the CLI as a real subprocess account for 2362s —
88.8% of all test execution time. The 190 fast-unit files account for
0.6%.**

The top 30 files are 90.3% of summed duration; the top 27 of those are
all CLI-spawning integration files.

### 4.3 Root cause of the CLI-spawn cost

All 30 CLI-spawning integration files independently declare the same
spawn shape:

```ts
const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const entry  = join(repoRoot, "src", "index.ts");
spawnSync(process.execPath, [tsxCli, entry, ...args], { cwd, encoding: "utf8" });
```

Every single CLI invocation therefore pays a **full TypeScript transform
of the entire CLI source graph**. Measured on the base commit (5-run mean,
`aiqt --version`):

| Entry point | Cost per spawn |
| --- | --: |
| `tsx src/index.ts` | **2882 ms** |
| `dist/index.js` (already built, already an artifact in CI's test job) | **1076 ms** |

There are **~650 such spawns** across the suite. This single mechanism —
not test count, not test breadth, not assertion depth — is the dominant
term in both the local 2660s and CI's 776s.

### 4.4 Slowest files (top 15, local summed duration)

| Seconds | Tests | Criticality | File |
| --: | --: | --- | --- |
| 257.8 | 49 | Critical | `tests/integration/cli.test.ts` |
| 191.6 | 20 | Critical | `tests/integration/m33-result-contract-characterization.test.ts` |
| 159.1 | 11 | High-value | `tests/integration/evidence-gate-simulate.test.ts` |
| 140.5 | 11 | High-value | `tests/integration/execution-adapter-claude-code-import.test.ts` |
| 123.0 | 10 | High-value | `tests/integration/execution-external-import.test.ts` |
| 94.0 | 4 | High-value | `tests/integration/evidence-advisory-hardening.test.ts` |
| 93.3 | 15 | High-value | `tests/integration/execution-import-cli.test.ts` |
| 89.2 | 14 | High-value | `tests/integration/evidence-import-cli.test.ts` |
| 87.9 | 9 | High-value | `tests/integration/evidence-gate-policy.test.ts` |
| 87.8 | 7 | High-value | `tests/integration/execution-next-cancel-safeguard.test.ts` |
| 87.5 | 9 | High-value | `tests/integration/execution-adapter-claude-code-request.test.ts` |
| 87.5 | 12 | High-value | `tests/integration/workspace-cli.test.ts` |
| 85.1 | 11 | High-value | `tests/integration/execution-hardening.test.ts` |
| 82.0 | 7 | High-value | `tests/integration/evidence-gate-hardening.test.ts` |
| 71.6 | 6 | High-value | `tests/integration/execution-external-hardening.test.ts` |

## 5. Flake and timeout families

The full local baseline run exited 1 with **17 failing tests across 12
files**. Classified per `milestone-protocol.md` §5 (isolate, do not
re-run-until-green):

### 5.1 Family A — load-induced timeouts in CLI-spawning suites (16 of 17)

All 16 are `STACK_TRACE_ERROR` test timeouts, all in files from §4.2's
CLI-spawning set, all under 16-way local worker contention. Isolation
evidence is recorded in §5.3.

Root cause is the same mechanism as §4.3: each spawn holds a worker for
~2.9s of pure TypeScript transform, so N concurrent workers multiply
transform pressure rather than test work, and the 15000/25000 ms
class-scoped budgets in `tests/workload-timeout-policy.ts` are consumed by
process startup instead of assertions. **This is a cost defect, not a
correctness defect** — and it is remediated at the root by IH-04, not by
raising timeouts.

CI (`ubuntu-latest`, 4 cores, 3 shards) does not currently exhibit this
family: the last 20 `Validate` runs on `main` and milestone PRs are all
`success` with no rerun. The observed CI rerun/flake cost over that window
is **0 runner-minutes**.

### 5.2 Family B — one genuine, pre-existing, Windows-only guard failure

`tests/unit/m34-validation-workload-inventory.test.ts` →
*"the 'trailing-line' inline-timeout shape … matches the recorded 2-file
baseline exactly"* fails locally on `main` at the base commit, before any
change in this intervention.

Root cause: the guard matches `/\n\s*(\d{4,7}),\n\s*\);/`. With
`core.autocrlf=true` the checked-out files use CRLF, so the `,\n` in that
pattern cannot match `,\r\n`, and `tests/integration/cli.test.ts` (which
does carry that shape at line 127) is not detected. On CI's Linux/LF
checkout the same guard matches both recorded files and passes — which is
why every `Validate` run is green.

This is a **line-ending sensitivity in a repository guard**, not a
regression and not a product defect. It is recorded here as a pre-existing
local-environment discrepancy; IH-04 makes the guard line-ending-agnostic
without changing what it asserts.

### 5.3 Isolation evidence

See [`ih01-isolation-evidence.md`](ih01-isolation-evidence.md).

## 6. Other baseline observations (no action in IH-01)

1. **`vitest.config.ts` uses `pool: "threads"`** with default worker count
   and no `isolate` change — recorded for IH-02's concurrency comparison.
2. **Three reviewed skip/conditional files** (was two at M35):
   `sandbox-docker-backend`, `sandbox-live-execution`, and now
   `sandbox-escape-testing` — all Docker-availability capability checks,
   all with logged reasons. No skip exists for speed.
3. **Two tests write generated artifacts into the repository tree**
   (`docs/engineering/m36-wu05-dogfood-evidence.generated.json`,
   `docs/engineering/m37-wu05-controlled-pilot-evidence.generated.json`);
   neither path is gitignored, so a local full-suite run leaves the working
   tree with untracked files. Recorded, not changed here.

## 7. IH-01 conclusions that set the rest of the intervention

1. The runner-minute bill is **96% test execution**; topology alone cannot
   reach the target.
2. Test execution is **88.8% concentrated in 33 CLI-spawning files**, and
   within those, the dominant term is **per-spawn TypeScript transform**,
   not the tests themselves.
3. Therefore the correct primary intervention is **making the real CLI
   spine cheap (IH-04)**, not deleting tests (IH-03). The 190 fast-unit
   files could all be deleted and the CI bill would fall by 0.6%.
4. Deletion-driven savings are structurally unavailable at meaningful
   scale; IH-03 must proceed as an honest evidence-gated review that may
   legitimately conclude with few or no removals.

**IH-01 implementation risk: 4/100 (🟢 green).** Measurement only: one
workflow file read, no file under `src/`, `tests/`, `.github/` or
`docs/governance/` modified.
