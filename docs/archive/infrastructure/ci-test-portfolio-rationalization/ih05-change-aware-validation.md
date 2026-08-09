# IH-05 — Change-Aware Validation and PR/Post-Merge Cost Review

## 1. Change-aware validation profiles

Implemented as a fail-closed step inside the single `validate` job, not as
a workflow-level skip.

### 1.1 Design constraints and how each is met

| Spec requirement (§8) | How it is met |
| --- | --- |
| "the required workflow/check must still resolve successfully" | The job always runs to completion. A profile decides only whether the `Test` **step** runs. |
| "do not skip the entire required workflow if that can leave a required check pending" | Nothing skips the workflow, the job, or the check. There is no `paths:`/`paths-ignore:` filter anywhere. |
| "prefer job/step-level conditional validation" | Step-level: one `if:` on one step. |
| "docs-only may use lightweight validation where live policy proves it safe" | Proven, and pinned — see §1.3. |
| "CI/test-infrastructure, schema/state and build/dependency changes require broad validation" | All of them are outside `docs/`, so all get `full`. Asserted explicitly in `tests/unit/validation-profile.test.ts`. |
| "uncertain ⇒ broad validation" | Every uncertainty path yields `full` — see §1.2. |
| "reuse existing test-impact/change-classification owners where appropriate" | Reuses `normalizeRepoPath` from `relevant-paths.ts`; deliberately does **not** reuse its allowlist — see §1.4. |

### 1.2 Fail-closed by construction

`full` is the only default. `docs-only` requires a successfully computed
diff in which *every* path is under `docs/`. Verified against real refs on
this branch:

| Input | Result |
| --- | --- |
| this branch vs `origin/main` (35 mixed paths) | `full` — "35 changed path(s) outside the documentation allowlist" |
| the IH-01 commit (4 docs paths) | `docs-only` |
| `--base` omitted | `full` — "no usable comparison base" |
| `--base` all-zero SHA (GitHub's first-push value) | `full` — "no usable comparison base" |
| `--base` an unresolvable SHA | `full` — "changed paths could not be computed" |

Unit coverage additionally pins: empty and whitespace-only path lists →
`full`; one non-docs path among many docs paths → `full`, naming the
disqualifying path; `docsite/index.md` and `docs.md` → `full` (prefix
matching is directory-aware, not string-prefix); Windows separators and
`./` prefixes normalized before deciding; and each of `src/**`,
`tests/**`, `vitest.config.ts`, `.github/workflows/**`, `package.json`,
`pnpm-lock.yaml`, `eslint.config.js`, `tsconfig.json`, `README.md`,
`AGENTS.md`, `.gitignore` and an unrecognised new top-level path → `full`.

If the classification step itself fails, the job fails. There is no path
from "something went wrong" to "tests were skipped".

### 1.3 Why `docs-only` is sound, and what keeps it sound

No test in this repository reads this repository's own `docs/` tree as an
input. The structural-review, owner-map, workflow and versioning suites
all construct their fixtures in temp directories; the only two tests that
reference the real `docs/` path (`autonomous-controlled-pilot`,
`autonomous-run-dogfood-pilot`) *write* generated evidence there.

That is a fact about today's suite, so it is pinned rather than trusted:
`tests/unit/validation-profile.test.ts` fails if the set of test files
referencing `repoRoot, "docs"` ever differs from the reviewed two-file
baseline. A future test that starts reading tracked documentation breaks
the guard and forces a decision, instead of silently making a docs-only PR
skip the test that would have caught its own change.

### 1.4 Deliberately a second, separate allowlist

`relevant-paths.ts` answers "does this change require a version bump?".
`validation-profile.ts` answers "may this change skip the suite?". Being
wrong has different consequences in each case, so they get independently
reviewed allowlists. A path must never become test-skippable as a side
effect of someone editing the version-governance allowlist.

### 1.5 Cost effect

A documentation-only change now costs **1 billed runner-minute** per run
(setup 13s + typecheck 11s + lint 9s + build 11s + version-check 5s + job
overhead ≈ 53s) instead of a full test run. This does not affect the
headline KPI, which is measured on a *normal code* PR — code changes
always get `full`.

## 2. PR versus post-merge validation — reviewed, and full validation retained

§9 permits reducing post-merge `main` validation only on proof of five
conditions. Assessed against this repository's actual, live merge process:

| §9 condition | Status | Finding |
| --- | --- | --- |
| the PR head that passed authoritative validation is the exact content merged | ✗ | `versioning.md` requires merge **commits** (never squash/rebase) for milestone PRs. The merge commit's tree is a *merge result*, not the PR head's tree. It equals the validated `pull_request` merge-ref tree only while the base has not moved. |
| the validated base is still the relevant final merge base | ✗ | GitHub re-computes the merge ref when `main` advances, but the *last successful run* may predate that. Nothing in the current process re-validates before the human presses merge. |
| no intervening `main` change creates an unvalidated combination | ✗ | Not enforceable: merging is a manual human action with no required-branch-up-to-date rule configured. |
| the merge method preserves expected content | ~ | Governed by policy (merge commit only) but not mechanically enforced by a branch-protection setting this intervention may add. |
| provenance is machine-checkable | ✗ | Would require the post-merge job to identify the originating PR, fetch its last successful run's head SHA, and compare tree hashes. Constructible, but it is new machinery whose own failure modes would need validating, and it is not in scope here. |

Four of five conditions fail and the fifth is policy-enforced rather than
mechanically enforced.

**Decision: full post-merge validation is retained**, exactly as §9
directs when proof is insufficient, and its cost is reported honestly
rather than hidden. Post-merge `main` remains a full run in the closure
figures — it is half of the "per merged change" number, and it stays
there.

The intervention still halves post-merge cost, because the same one-job,
cheap-spine `main` run costs what the PR run costs. The reduction comes
from making the work cheaper, not from skipping the gate.

## 3. Governance updated (durable policy only)

- **`docs/governance/test-rationalization-policy.md` §7** — retitled
  "Runtime target" → "Cost target"; primary metric changed from M35's
  wall-clock-only ("under 5 minutes") to **runner-minutes per safely
  merged change**, with wall-clock explicitly secondary. Both governing
  invariants restated unchanged: no test may be removed to improve a cost
  number, and cost is reduced by removing waste inside the work rather
  than removing the work. §8's before/after recording requirement now
  demands runner-minutes per PR / per `main` / per merged change.
- **`docs/governance/versioning.md`** — the CI section described a
  step order and job shape that no longer exist; corrected to the single
  `validate` job, and the fail-closed change-aware profile documented
  including why it is a separate allowlist from `relevant-paths.ts`.
- **`docs/governance/repository-owner-map.json`** — `ciWorkflows` gains the
  validation-profile and version-check tooling as supporting files and
  documents the profile contract; `testRuntimePolicy` gains
  `tests/cli-runner.ts` and `tests/global-setup.ts` and records the
  measured concurrency decision.

No other governance document changed. `relevant-paths.ts`'s allowlist is
untouched; the canonical schema is untouched.

**IH-05 implementation risk: 26/100 (🟢 green).** One new pure classifier
plus its CLI (repository tooling, no AIQT product surface), one new test
file with 7 tests including a drift guard, one conditional step, and three
governance documents brought in line with what the repository now does.
