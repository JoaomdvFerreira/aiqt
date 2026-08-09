# IH-02 — One-Job-First CI Topology Decision

Companion to [`ih01-baseline.md`](ih01-baseline.md). No test was deleted,
merged, weakened, or skipped in this Work Unit.

## 1. What is being optimized

GitHub bills Actions **per job, rounded up to the whole minute**. A
topology's cost is therefore `Σ ceil(job_seconds / 60)`, not
`Σ job_seconds`, and every additional job carries three fixed taxes:

1. a rounding remainder (up to 59s of billed-but-unused time);
2. a duplicate checkout + pnpm/action-setup + setup-node + install cycle
   (measured 10–13s per job, run `31280077450`);
3. job set-up/tear-down (~3.3s per job).

At the M35-WU04 topology those taxes cost **~2.4 min of rounding + ~64s of
duplicate setup + ~20s of job overhead per run** — roughly 20% of the bill,
buying no additional assertion.

## 2. Topologies evaluated

All four are computed from the *same* measured per-step timings
(`ih01-baseline.md` §3.3): vitest 776s total (227/274/275 across the three
current shards), setup 13s, typecheck 11s, lint 9s, build 11s,
version:check 5s, artifact upload 3s / download 2s, job overhead ~4s.

| Topology | Jobs | Billed runner-min | PR wall-clock | Notes |
| --- | --: | --: | --: | --- |
| **6 jobs / 3 test shards** (current) | 6 | **18** | ~6m05s | 5 redundant setups; dist/ artifact round-trip; 3 rounding remainders on the shards alone |
| 2 jobs / 2 test shards | 4 | 16 | ~7m30s | still pays 3 extra setups and an artifact round-trip |
| 2 jobs / 1 test job | 2 | 15 | ~13m25s | costs 1 extra setup + 1 extra rounding vs one job, buys nothing |
| **1 job** (chosen) | **1** | **14** | ~13m50s | no artifact, no duplicate setup, one rounding remainder |

Arithmetic for the chosen topology: `13 (setup) + 11 (typecheck) + 9
(lint) + 11 (build) + 776 (test) + 5 (version:check) + 4 (job overhead) =
829s → ceil(829/60) = 14 billed minutes`.

## 3. Decision

**One job.** It is the cheapest topology under the primary KPI, and the
job-count reduction is justified by measurement rather than by preference:

- versus the current 6 jobs: **−4 billed minutes per run** (−22%), before
  any test-runtime work;
- versus every alternative examined: strictly fewer billed minutes;
- the only thing the split topology bought was wall-clock, and wall-clock
  is explicitly the secondary metric here.

Three shards are **not** retained. Their sole justification was wall-clock,
they cost +4 billed minutes per run, and — per `ih01-baseline.md` §4.2 —
the workload they parallelize is 88.8% per-spawn TypeScript transform,
i.e. avoidable work rather than irreducible test work. Sharding was paying
GitHub to run the same waste on three runners at once. IH-04 removes the
waste instead.

### Accepted cost

Wall-clock feedback rises from ~6m05s to a projected ~13m50s **at the
IH-01 test runtime**. This is accepted deliberately under the
intervention's stated priority (runner-minutes over visual speed), and it
is transitional: IH-04 attacks the 776s term directly, which is the only
term large enough to matter.

### Accepted risk, and why it is not deferred

Collapsing 3 shards × 4 cores into 1 job × 4 cores raises per-runner
worker pressure — the exact condition that produces `ih01-isolation-evidence.md`'s
Family A timeouts locally. The mitigation is sequencing, not tolerance:
**no hosted validation run is triggered on this topology until IH-04's
spawn-cost fix has landed with it**, so the hosted evidence covers the
combination that will actually be merged. This also honours the
intervention's Actions-cost discipline (group CI changes; do not push
speculative CI variants).

## 4. Other IH-02 changes

### 4.1 Stale-PR-run cancellation

```yaml
concurrency:
  group: validate-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

A superseded PR run is pure wasted quota. Pushes to `main` are the
authoritative post-merge gate and are never cancelled: `cancel-in-progress`
is evaluated per event, and a push's group key falls back to `github.ref`,
which is a different group from any pull request's. There is no path by
which a `main` run cancels another `main` run.

### 4.2 Setup / install / build de-duplication

Removed by construction, not by tuning: 5 redundant
checkout+pnpm-setup+setup-node+install cycles, 1 `actions/upload-artifact`
and 3 `actions/download-artifact` calls. `dist/` is now produced once in
the same job that consumes it.

### 4.3 pnpm caching — verified, not changed

`actions/setup-node@v7` with `cache: pnpm` is already effective:
`pnpm install --frozen-lockfile` measured **1–3s** on every job of run
`31280077450`. Install is not a meaningful optimization target and no
cache change was made.

### 4.4 Vitest concurrency — deliberately not changed here

The intervention requires *measured* concurrency tuning. The only honest
measurement available today is the local one, and it is about to be
invalidated: IH-04 changes per-spawn cost by ~2.7×, which changes the
optimal worker count. Guessing a `poolOptions` value now would be
unevidenced churn. `vitest.config.ts` is therefore untouched in IH-02, and
concurrency is measured and decided in IH-04 against the post-fix suite.

### 4.5 Semantics preserved

- version-check still runs only after build **and** test — a
  version-governance verdict is never reported for a commit whose suite
  already failed.
- `fetch-depth: 0` retained (deterministic PR-base/merge-base resolution;
  tests that exercise real git history).
- Both blocking version-check comparison steps (PR base, direct push to
  `main` via `github.event.before`) are unchanged, including the
  fail-the-job behaviour when `before` is an unresolvable non-zero SHA.
- No `continue-on-error`, no `|| true`, no soft failure anywhere.
- Node 24 remains the sole runtime. Still one required check, still always
  resolving.

## 5. Validation

`pnpm typecheck` ✅ · `pnpm lint` ✅ · `tests/unit/package-version.test.ts`
+ `tests/unit/relevant-paths.test.ts` ✅ (20/20) ·
`pnpm version:check` ✅ (0.41.0, all local checks pass).

No test asserts on this repository's own `.github/workflows/` content —
`structural-review-rules`, `m43-structural-review-dogfood`,
`relevant-paths` and `version-check` all construct workflow fixtures in
temp directories — so the topology change has no test-surface impact.

**Version bump:** `0.40.0 → 0.41.0`. `.github/workflows/**` is on
`src/tooling/relevant-paths.ts`'s allowlist, so a bump is required; minor
rather than patch because this branch also introduces a new contributor-
facing validation capability (IH-05's change-aware profiles).

**IH-02 implementation risk: 18/100 (🟢 green).** One workflow file, one
version field, one owner-map entry. Fully reversible; no product code, no
test, and no schema touched.
