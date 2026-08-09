# IH-03 — Deep Test Portfolio Rationalization

Governed by [`docs/governance/test-rationalization-policy.md`](../../../governance/test-rationalization-policy.md).
Every semantic reduction below carries that policy's Sec 2 seven-field
contract and, because the affected file is Critical-tier, its Sec 4
owner-review gate.

**Result: 1 consolidation acted on, 9 candidate categories investigated
and rejected. 336 → 336 files; 3510 → 3499 tests.** No test was removed for
being slow, old, or milestone-named. No arbitrary target test count was
pursued — per the policy, raw test count is not a quality metric.

## 0. What the cost data permits

`ih01-baseline.md` §4.2 constrains this Work Unit before it starts:

| Group | Files | Share of test time |
| --- | --: | --: |
| CLI-spawning integration | 33 | **88.8%** |
| everything else | 303 | 11.2% |
| fast unit | 190 | **0.6%** |

Deleting all 190 fast-unit files would reduce the CI bill by 0.6% — less
than one billed minute. **Deletion is not a viable savings mechanism in
this repository**, so IH-03 is run as an honest correctness/duplication
review whose savings, if any, are incidental. The runner-minute target is
met by IH-02 and IH-04, not here.

## 1. Acted on — consolidation of six command-surface snapshots and five exit-code snapshots

### 1.1 Seven-field deletion-evidence contract

**test/suite**
`tests/integration/cli.test.ts`. Eleven tests removed, three added:

*Removed — command-surface snapshots (6):*
- `M14: no new public commands are registered -- --help lists exactly the pre-M14 command set`
- `M15: no new public commands are registered -- --help still lists exactly the pre-M15 command set`
- `M15-RC1: no new public commands are registered -- --help still lists exactly the pre-M15 command set`
- `M16: no new public commands are registered -- --help still lists exactly the pre-M16 command set`
- `M17: no new public commands are registered -- --help still lists exactly the pre-M17 command set`
- `M18: no new public commands are registered except graph repair --apply -- --help still lists exactly the pre-M18 command set plus the new option`

*Removed — exit-code snapshots (5):*
- `M14: aiqt prompt driver/plan/next/skills-plan/export retain their pre-M14 exit-code contracts`
- `M15: representative pre-M15 exit-code contracts remain unchanged`
- `M15-RC1: representative pre-M15-RC1 exit-code contracts remain unchanged`
- `M16: representative pre-M16 exit-code contracts remain unchanged`
- `M17: representative pre-M17 exit-code contracts remain unchanged`

*Added (3):*
- `no new public command is registered: --help lists exactly the historical command set, and no milestone's hypothetical command surface leaked into it`
- `M18: graph repair exposes --dry-run and --apply as options, not as new public commands`
- `representative long-standing exit-code contracts remain unchanged (M14/M15/M15-RC1/M16/M17)`

**behavior covered**
Two regression classes. (a) *A public top-level command silently appears
or disappears from `aiqt --help`* — i.e. a milestone quietly widening or
narrowing the CLI surface. (b) *A long-standing exit-code contract
changes* — `export` with no target stops returning 10, `prompt <bogus>`
stops returning 3, an unknown command stops returning 3, `next` with an
empty work graph stops blocking with 2.

**reason**
Confirmed duplicates, verified by reading every assertion side by side,
not by filename similarity:

- All six command-surface tests run against the **same current binary** and
  assert the **same positive list** with the same `toContain` calls (M18's
  is a 16-entry subset of the same 18). Six `--help` subprocess spawns
  re-detected one regression six times. The only content unique to each was
  a milestone-specific *negative* assertion (`design`, `git`,
  `source-control`, `boundary`, `implementation-root`/`root`,
  `extend`/`replace-placeholder`) — all six sets are preserved verbatim,
  still labelled by originating milestone, plus M18's `graph repair --help`
  option check kept as its own test.
- The M15, M15-RC1, M16 and M17 exit-code tests are **byte-identical** to
  one another (same five invocations, same five expected statuses), and
  M14's is a strict two-assertion subset of them. This is the policy's
  "same real regression with no independent boundary value" case exactly.

**equivalent remaining coverage**
Full, and in one respect stronger. The union of every positive assertion,
every negative assertion, and every exit-code assertion is retained in the
three replacement tests in the same file. Additionally, the merged
command-surface test now asserts the **exact** top-level command set rather
than substring containment — see §1.2, which is why this is recorded as a
consolidation-with-strengthening, not a reduction.

**criticality**
**Critical.** `tests/integration/cli.test.ts` is Critical-tier in the
inventory and is the `historicalCompatibilityFixtures` owner-map primary.
The policy's Sec 4 owner-review gate therefore applies: this reduction has
its own clearly-labelled reasoning (this document plus its own commit) and
is not bundled into a commit whose primary purpose is something else.

**risk**
If the merge were wrong, a future milestone could add or remove a
top-level command, or change one of the five exit-code contracts, without
any test failing — a silent public-CLI-contract break. This risk is
**lower** after the change than before it, because the pre-existing
assertions provably could not detect a removed command at all (§1.2).
Residual risk: the merged test parses `--help`'s `Commands:` section, so a
future commander upgrade that reformats help output would fail this test.
That is a loud, obvious failure naming the exact diff, not a silent gap.

**validation evidence**
1. `pnpm typecheck` ✅, `pnpm lint` ✅.
2. `vitest run tests/integration/cli.test.ts` → **41/41 passed**
   (before: 49/49).
3. **Deliberately reintroduced regression.** `src/cli/register-commands.ts`
   line 815 `.command("dependency")` → `.command("depz")`:
   - against the **original** six tests: **all six still passed** — the
     string "dependency" survives inside `next`'s own description prose, so
     `toContain("dependency")` never detected the missing command;
   - against the **merged** test: **fails**, with
     `AssertionError: - "dependency" / + "depz"`.
   Source restored and verified clean (`git diff --stat` empty for
   `src/`).
4. Same regression injected as `.command("dependencyy")` first: also
   undetected by the originals, for the same substring reason. Recorded
   because it is what motivated the strengthening.

**runtime impact**
Measured with `vitest run --reporter=json` on the same machine, same
commit, file in isolation (not the contended full-suite figure):

| | Tests | Duration |
| --- | --: | --: |
| before | 49 | **147.9s** |
| after | 41 | **119.4s** |
| delta | −8 | **−28.5s (−19.3%)** |

≈23 real CLI subprocess spawns removed from the single most expensive file
in the suite.

### 1.2 Assertion strengthening (Sec 5 "Low-signal" row: rewrite over decommission)

The six originals were titled *"lists exactly the … command set"* but
implemented `expect(stdout).toContain(command)` against the whole help
text. As proved above, that cannot detect a removed or renamed command.
Under the policy's Low-signal handling, **rewriting to strengthen is
preferred over decommissioning**, so the merged test parses the
`Commands:` section and asserts the exact set — what all six titles always
claimed. This is a strengthening, not a weakening; no assertion was
loosened anywhere in this Work Unit.

## 2. Investigated and rejected (no action)

Mechanical scan: 72 groups of identical test titles across the suite,
each read before judgement.

| # | Candidate | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | `evidence-gate-boundary-scan` / `execution-adapter-boundary-scan` / `generic-execution-boundary-scan` — overlapping scanned files (`src/cli/options.ts`, `register-commands.ts`, `state.schema.ts`, `runlog-store.ts`, 6 adapter files) | **Reject** | Each scans its overlap against a *different* forbidden-surface set: evidence-gate adds `eval`/`new Function`/`node:vm`/Git-invocation-text; the other two add the Claude/Anthropic SDK dependency. Each is one milestone's own security-boundary claim, deliberately scoped ("only M27's own boundary claim is under test here"). Merging would collapse three independent Critical security claims and let one milestone's forbidden set silently redefine another's scope. |
| 2 | `checkpoint-next-flow` vs `next-checkpoint-flow` (M35's known false positive) | **Reject, re-confirmed** | Different invariants: WU002 unblocking *after* checkpoint vs a second `next` *blocking* before checkpoint (exit 2). Combined runtime 0.4s. |
| 3 | 16 files sharing `fails with exit code 3 when .aiqt/ is missing`; 7 sharing `…and recommends aiqt init…` | **Reject** | One assertion per *distinct command*. Removing any leaves that command's missing-project boundary untested. Policy Sec 6: "preserve meaningful boundaries and distinct behavior branches." |
| 4 | `evidence import` vs `execution import` CLI plumbing pairs (`exits 10 when neither --from-file nor --stdin`, `exits 3 when both`, `exits 3 for malformed JSON`, `--preview…`, `reads the payload from --stdin`, runlog-gap retry) | **Reject** | Different commands, different services, different runlog event types. Same-shaped contract ≠ same code path. |
| 5 | `workspace-service-release-recovery` vs `shared-repository-provider` (2 shared titles) | **Reject** | Isolated real-worktree release/recovery vs the pure shared-workspace candidate builder (explicitly "no fs/git import in this module"). Different subject entirely. |
| 6 | `autonomous-agent-request-store` vs `autonomous-run-store` (4 shared titles) | **Reject** | Two distinct stores; each needs its own id-shape, path-traversal, and directory-creation guarantees. |
| 7 | `m33-cli-contract-matrix` (unit) vs `m33-result-contract-characterization` (integration) — "redundant rendering/parity matrix" candidate | **Reject** | The unit test walks the registered commander tree asserting `--json` *exists*; the integration test drives real subprocesses asserting stream placement, exit-code agreement and human/JSON parity. No assertion overlap. The integration file's 191.6s is spawn cost, addressed in IH-04. |
| 8 | Milestone dogfood suites (`m39`–`m43`, `gate-k`, `dogfood-regression`, `maintenance`, autonomous pilots) — "superseded milestone dogfood" candidate | **Reject** | Combined 52.6s = **2.0%** of test time; removing all ten would not save one billed minute, and each carries a milestone-specific end-to-end invariant with no canonical permanent replacement identified. Policy: no test may be removed merely to improve a runtime number — and here it would not even improve it. |
| 9 | Tests asserting pre-canonical schema versions (`"0.0.0"` in `canonical-version-compatibility`, `versioning`) — "demonstrably obsolete" candidate under policy Sec 3 branch 2 | **Reject** | They assert such versions are **rejected** (`older_incompatible`). They are the compatibility gate's own guard, not stale assertions about a dead shape. |
| 10 | Cross-layer duplication (integration spawning the CLI to assert what a unit test asserts in-process) | **Reject** | Sampled the expensive cluster; the integration layer consistently asserts process-boundary facts (exit status, stdout/stderr placement, real state/runlog files) that no in-process test observes. |

Also confirmed unchanged: **0 Low-signal-classified files**, **0 misplaced
files**, and the three reviewed skip/conditional files remain exactly the
Docker-capability exceptions (`sandbox-docker-backend`,
`sandbox-live-execution`, `sandbox-escape-testing`). **No skip, `todo`, or
`skipIf` was introduced.**

## 3. Quality gates (policy §6)

| Gate | Status |
| --- | --- |
| Zero known critical regression gaps | ✅ — the only reduction strengthens the contract it consolidates |
| Zero unexplained/unauthorized skips | ✅ — 3 reviewed Docker exceptions, unchanged; none added |
| Zero hidden assertion regressions | ✅ — injected-regression evidence in §1.1 |
| Critical-tier set preserved | ✅ — 140 Critical files, none removed; the one Critical file touched carries Sec 2 + Sec 4 evidence |
| `built-binary-smoke.test.ts` present and green | ✅ |
| Node 24 CI green | ✅ (validated at closure) |
| No per-file timeout proliferation | ✅ — no `vi.setConfig`/inline timeout added or changed |

## 4. Portfolio before/after

| | Before | After |
| --- | --: | --: |
| Test files | 336 | **336** |
| Tests | 3510 | **3499** |
| Critical files | 140 | **140** |
| Skipped/conditional files | 3 (reviewed) | **3 (reviewed)** |

**IH-03 implementation risk: 22/100 (🟢 green).** One test file. Eleven
duplicate tests merged into three, every assertion preserved, one
assertion class measurably strengthened, injected-regression evidence
recorded. No product source, no schema, no CI file touched.
