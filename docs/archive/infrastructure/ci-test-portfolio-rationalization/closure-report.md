# CI & Test Portfolio Rationalization — Closure Report

**Work type:** development-infrastructure hardening (not milestone M46)
**Branch:** `infra/ci-test-portfolio-rationalization`
**Base:** `679abcd` (`main`, post-M45) · **Package version:** `0.40.0 → 0.41.0`
**Canonical schema version:** unchanged · **`.aiqt/` created:** no · **GitHub Release:** none

## 1. Work Units

| WU | Commit | Risk | Outcome |
| --- | --- | --: | --- |
| IH-01 | `7bb3f01` | 4/100 🟢 | Measured Actions + portfolio baseline; flake families classified |
| IH-02 | `85fe358` | 18/100 🟢 | One-job topology, PR-run cancellation, shards removed |
| IH-03 | `1f2de37` | 22/100 🟢 | 11 duplicate CLI-surface snapshots consolidated into 3 (strengthened) |
| IH-04 | `138bf19` | 30/100 🟡 | Real-CLI spine moved to the built binary; timeout family eliminated |
| IH-05 | `0f034f5` | 26/100 🟡 | Change-aware validation, post-merge review, governance, closure |

Bands per `docs/governance/versioning.md`: `0`–`24` 🟢 green, `25`–`49`
🟡 yellow, `50`–`74` 🟠 orange, `75`–`100` 🔴 red. Three Work Units are
green (4, 18, 22); **two are yellow — IH-04 at 30 and IH-05 at 26**.

**Final infrastructure risk: 30/100 (🟡 yellow)** — the intervention's
maximum, from IH-04's file breadth. Below the 50/100 human-approval
boundary; no Work Unit reached it.

## 2. Measured baseline (real completed-run metadata, no benchmark run triggered)

| Metric | Baseline |
| --- | --: |
| Jobs per run | 6 (quality, build, test×3 shards, version-check) |
| PR runner-minutes (mean of 4 runs) | **17.75** |
| Post-merge `main` runner-minutes (mean of 4) | **17.50** |
| **Per safely merged change** | **35.25** |
| PR wall-clock | ~5m55s |
| Per-run rounding waste | ~2.4 min (15% of the bill) |
| CI test execution | 776s (227 + 274 + 275) |
| Duplicated setup across 5 redundant jobs | ~64s |

## 3. Final CI topology

**One GitHub-hosted Linux job (`validate`), Node 24:** checkout
(`fetch-depth: 0`) → pnpm/node setup with pnpm store cache → install →
classify validation profile → typecheck → lint → build → test →
version:check (local, then the blocking PR-base or direct-push comparison).

Job count is justified by measurement, not preference — all four
candidates costed from the same per-step data (`ih02-topology-decision.md`):
6 jobs/3 shards = 18 billed min; 2 jobs/2 shards = 16; 2 jobs/1 test job =
15; **1 job = 14**. Three shards bought wall-clock only, cost +4 billed
minutes, and parallelized work that was 88.8% avoidable waste.

Also applied: `concurrency` cancelling superseded **pull_request** runs
only (authoritative `main` runs are never cancelled); 5 redundant
checkout/setup/install cycles removed; the `dist/` artifact upload + 3
downloads removed; pnpm store caching verified effective (install measured
at 1–3s, so not an optimization target).

## 4. Test portfolio before / after

| | Before | After |
| --- | --: | --: |
| Test files | 336 | **337** (+1 new guard) |
| Tests | 3510 | **3509** |
| `tests/unit/` / `tests/integration/` | 191 / 145 | 192 / 145 |
| Critical files | 140 | **141** |
| Skipped/conditional files | 3 (reviewed Docker) | **3 (reviewed Docker)** |
| **Local suite failures** | **17** | **0** |
| Summed file duration | 2660s | **1357s (−49.0%)** |
| Local wall-clock (16 threads) | 259s | **111s (−57.1%)** |
| CLI-spawn share of test time | 88.8% | 76.7% |

Workload-class distribution is identical to the M34/M35 taxonomy
(21 evidence/execution/workspace · 11 CLI-subprocess · 25 git/worktree ·
88 filesystem · 1 built-binary smoke · 191 fast-unit).

### 4.1 Tests removed / consolidated, and why

**One reduction only**, in `tests/integration/cli.test.ts` (Critical tier →
policy Sec 4 owner-review gate, given its own commit and full seven-field
record in `ih03-portfolio-review.md`):

- **6 command-surface snapshots** (M14, M15, M15-RC1, M16, M17, M18) → **1
  test + 1 M18 option test.** All six ran against the same current binary
  and asserted the same positive command list; only their milestone-
  specific *negative* assertions differed, and all are preserved verbatim.
- **5 exit-code snapshots** (M14, M15, M15-RC1, M16, M17) → **1 test.** The
  M15/M15-RC1/M16/M17 four were byte-identical to each other; M14's was a
  strict subset.

**Assertion strengthened, not weakened.** The originals were titled "lists
exactly the command set" but used substring containment. Renaming
`dependency` → `depz` left **all six originals green** (the word survives
in `next`'s description prose); the merged test **fails**, naming the diff.
Runtime: 147.9s/49 tests → 119.4s/41 tests in isolation (−19.3%).

**Nine candidate categories investigated and rejected** with evidence: the
three per-milestone security boundary scans (distinct forbidden-surface
sets); `checkpoint-next-flow`/`next-checkpoint-flow` (M35 false positive,
re-confirmed); the 16-file "exit 3 when `.aiqt/` is missing" family; the
evidence/execution import plumbing pairs; workspace release-recovery vs
shared-repository-provider; the two autonomous stores; the m33 unit matrix
vs m33 integration characterization; the ten milestone dogfood suites
(52.6s = 2.0% of test time, no canonical replacement); and the `"0.0.0"`
schema-version tests (they assert rejection).

**No test was removed for being slow, old, or milestone-named. No skip or
`todo` was added. No assertion was loosened anywhere.**

## 5. Actions runner-minutes before / after

The IH-04 conversion cut measured suite work by 49.0% (2660s → 1357s under
identical conditions), giving a scaling factor of **0.510** applied to CI's
measured 776s test step → ~396s. Single job: `13 (setup) + 11 (typecheck)
+ 9 (lint) + 11 (build) + 396 (test) + 5 (version:check) + 4 (job
overhead) = 449s → ceil(449/60) =` **8 billed minutes**.

| Metric | Before | After | Δ |
| --- | --: | --: | --: |
| CI jobs per run | 6 | **1** | −5 |
| **PR runner-minutes** | 17.75 | **8** | **−54.9%** |
| **Post-merge `main` runner-minutes** | 17.50 | **8** | **−54.3%** |
| **Per safely merged code change** | **35.25** | **16** | **−54.6%** |
| PR wall-clock | ~5m55s | ~7m29s | +26% (accepted) |
| Docs-only change (either event) | 18 | **1** | −94% |
| Rerun/flake cost (last 20 CI runs) | 0 | 0 | — |

**Target ≥35%: met. Stretch ≥50%: met** (−54.6%), without a single test
removed for cost, without an assertion weakened, and without a skip added.

### 5.1 The one honest caveat on these figures

**The after-figures are a projection, not a hosted measurement.** The
Actions-cost discipline forbids speculative hosted runs, and the closure
instruction was to push the branch without opening a PR — so **zero
GitHub-hosted runs were consumed by this intervention**, deliberately. The
inputs are all measured (baseline per-job and per-step timings from real
completed runs; before/after suite work from identical local runs); the
scaling from local work to CI runner-seconds is the modelled step.

It is also conservative: the tsx→dist saving is measured on Windows, where
plain `node dist/index.js` startup is itself expensive (1076 ms); on
`ubuntu-latest` that floor is far lower, so the real CI ratio should be
better than 0.510. **The first `Validate` run on the eventual PR will
supply the hosted number**, and it is the one item required to close DoD
#16 empirically.

## 6. Flake outcome

| | Before | After |
| --- | --: | --: |
| Local full-suite failures (16 threads) | 17 | **0** |
| Contention amplification | ×2.40 (on the 11 affected files) | ×1.95 whole-suite |
| Timeout constants changed | — | **none** |
| Per-file timeout overrides added | — | **none** |
| Reruns performed | — | **none** |

**Family A** (16 load-induced timeouts) was root-caused to the 2882 ms
per-spawn transform and fixed by removing it, not by raising budgets.
**Family B** (a Windows-only guard failure on unmodified `main`:
`m34-validation-workload-inventory`'s `,\n` pattern cannot match `,\r\n`)
is closed by normalizing line endings — same assertion, same baseline, both
line endings. The full local suite now exits 0 on Windows.

Vitest concurrency was measured (4 / 8 / 16 threads: 210s / 135s / 112s
wall, 0 failures at every level) and **deliberately left at the default**:
there is no stability case for capping, and the ×1.20 oversubscription
gain would have to be extrapolated from an 8-core Windows box to a 4-core
Linux runner for about one billed minute, against the risk of
reintroducing reruns that cost far more.

## 7. Change-aware validation and post-merge review

**Implemented, fail-closed.** `docs-only` is reached only when *every*
changed path is under `docs/`; an unresolvable base, an uncomputable diff,
or one unrecognised path all yield `full`, and a classifier failure fails
the job. Its only effect is skipping the test step — the job, the required
check, typecheck, lint, build and both version-governance comparisons
always run, so the required check always resolves. Verified against real
refs (5 cases) plus 7 unit tests, including a drift guard that fails if any
test starts reading this repository's own `docs/` tree.

**Post-merge validation retained in full.** Section 9's five proof
conditions were assessed against the live process: four fail outright
(merge-commit trees are merge *results*, not validated PR-head trees; the
validated base can go stale before a human merges; no branch-protection
up-to-date rule exists; provenance is not machine-checkable without new
machinery) and the fifth is policy- rather than mechanically-enforced.
Post-merge `main` therefore stays a full run and is counted at full price
in §5.

## 8. Governance updated (durable policy only)

- `test-rationalization-policy.md` §7 — primary metric changed from
  wall-clock-only to **runner-minutes per safely merged change**; §8 now
  requires runner-minutes per PR / per `main` / per merged change. Both
  governing invariants restated unchanged.
- `versioning.md` — CI section corrected to the single `validate` job and
  the fail-closed change-aware profile documented.
- `repository-owner-map.json` — `ciWorkflows` and `testRuntimePolicy`
  updated with new supporting files and accurate contract summaries.

## 9. Validation

`pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm build` ✅ ·
**full suite 3509 tests, 3477 passed, 0 failed, 32 pending (reviewed
Docker skips), exit 0** · `pnpm version:check` ✅ (0.41.0; semver, runtime,
built-runtime and lockfile all pass). Total local `validate` wall-clock:
137s.

## 10. Boundaries honoured

No `.aiqt/` state · no AIQT product behavior change · no canonical schema
change · no critical coverage removed · no assertion weakened · no skip or
`todo` added · post-merge CI not disabled · no self-hosted runner · no
auto-merge · no AI PR-review Actions · no M46/M47/M48 work · no GitHub
Release · no milestone documentation rotated (the rolling archive
lifecycle resumes when M46 starts).

## 11. Known limitations

1. **Hosted runner-minute figures are projected** (§5.1). One real
   `Validate` run closes this.
2. **The single job's wall-clock is ~26% longer** than the sharded
   topology (~7m29s vs ~5m55s, projected) — a deliberate trade under the
   stated priority.
3. **Post-merge `main` remains a full run** — half the per-change bill, by
   design (§7).
4. **Concurrency oversubscription is unexploited** — a measured ~1 billed
   minute left on the table pending hosted per-worker data.
5. **Two dogfood suites still write generated artifacts into `docs/engineering/`**
   as a side effect of a full run. Their behavior is deliberately not
   changed (that would be a product-test change, outside scope); the
   artifacts are now gitignored, so a local `pnpm test` no longer leaves
   the working tree dirty. The write itself remains.
6. **Per-WU tags were not created.** The approved specification asks for
   one bounded commit per Work Unit and does not require tags, and this is
   not a milestone; `AGENTS.md`'s per-WU tag rule is milestone discipline.
   Noted as a deliberate deviation rather than an omission.

## 12. PR readiness

Branch is PR-ready: working tree clean, `pnpm pr:ready` green, full
validation green, version bump present and correct for the
`.github/workflows/**` change. **The PR has not been opened** — per the
closure instruction, that is an explicit follow-up decision.
