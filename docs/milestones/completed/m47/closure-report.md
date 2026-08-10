# AIQT M47 — Controlled Pull Request Integration

**Closure report**

| Field | Value |
|---|---|
| Milestone | M47 |
| Classification | `high_risk` |
| Branch | `milestone/m47-controlled-pr-integration` |
| Baseline | `main` @ `30190dd` (M46 PR #21 merged, post-merge `Validate` green) |
| Package version | `0.43.0 → 0.44.0` |
| Canonical schema version | `0.7.0` (unchanged) |
| New schema domain | `PR_INTEGRATION_SCHEMA_VERSION = 1.0.0` |
| Work Units | 6, each with one detailed commit and one annotated tag |
| Overall implementation risk | **62/100 🟠 orange** |

## 1. What M47 added

`aiqt pr` — the repository's first and only capability to write to a remote:

```text
aiqt pr prepare   # read-only: bind exact repo/remote/base/source/SHA + full preflight
aiqt pr inspect   # read-only, no I/O at all
aiqt pr push      # one exact-SHA, non-force, single-ref branch push, verified after the write
aiqt pr create    # create or reconcile exactly one Pull Request; draft by default; explicit reviewers
aiqt pr status    # read-only lookups; reconciles an ambiguous outcome from real remote evidence
aiqt pr validate  # read-only verdict; writes nothing at all
```

All six support `--json` and preserve the existing `CommandResult`/exit-code/stream contracts under a
new `action: "pr"`.

**M47 never approves, merges, deploys, or publishes a release.** GitHub's merge
(`PUT /pulls/{n}/merge`) and review (`POST /pulls/{n}/reviews`) endpoints appear nowhere in this
repository, and boundary-scan assertions pin that.

## 2. Work Unit table

| WU | Tag | Target | Actual | Band |
|---|---|---:|---:|---|
| WU47-01 Contract, threat model, ownership, state boundary | `m47-wu01-pr-integration-contract` | 30 | 30 | 🟡 |
| WU47-02 Read-only repo/remote/branch/policy preflight | `m47-wu02-pr-preflight-policy` | 35 | 35 | 🟡 |
| WU47-03 Exact-SHA fast-forward-only push | `m47-wu03-exact-sha-branch-push` | 60 | 60 | 🟠 |
| WU47-04 PR creation, duplicate safety, reviewers | `m47-wu04-github-pr-create-reviewers` | 65 | 65 | 🟠 |
| WU47-05 Status, validation, resumability, integration | `m47-wu05-pr-status-validation` | 45 | 45 | 🟡 |
| WU47-06 Controlled live dogfood, hazard regression, closure | `m47-wu06-controlled-pr-dogfood-closure` | 55 | 55 | 🟠 |

Milestone tag: `m47-controlled-pull-request-integration`.

**Risk-boundary note.** `milestone-protocol.md` §11 stops execution at any Work Unit whose
implementation risk reaches 50. WU47-03, WU47-04, and WU47-06 all do, by design — the build
specification declares those exact target risks, and the milestone prompt explicitly pre-authorized
implementing the milestone at them. Execution therefore continued without a separate per-WU stop.
This is recorded here rather than passed over silently; it is a pre-authorization, not a waiver of
the boundary, and the same boundary still applies to the merge decision (orange ⇒ human approval
mandatory, which the manual-merge process already requires).

## 3. Package and schema outcome

- **Package: `0.43.0 → 0.44.0` (minor).** A new public command family plus new external-write
  capability is a minor bump under `docs/governance/versioning.md`.
- **`AIQT_SCHEMA_VERSION`: unchanged at `0.7.0`.** M47 touches no canonical `project.json` /
  `state.json` contract.
- **New, separate domain: `PR_INTEGRATION_SCHEMA_VERSION = 1.0.0`,** gated by its own
  `pr-integration-versioning.ts`, exactly as M46's portfolio manifest is. Three independent schema
  domains now exist and none forces a bump on the others.
- **No new runtime dependency.** Still exactly `@inquirer/prompts`, `commander`, `zod` — asserted per
  Work Unit.

## 4. State-owner decision

The prompt required M37's durable handoff/run state to be inspected first and reused if it could
safely own every M47 reconciliation fact. It could not: `AutonomousRunRecordSchema` is `.strict()`
and structurally bound to an autonomous *repair run* (candidate, safety assessment, budgets,
execution policy, agent request, sandbox container/evidence), while a PR integration must work for
any already-prepared branch, including branches no autonomous run ever produced. Widening it would
force every autonomous run to carry PR fields it can never populate and couple two lifecycles with
different resumability semantics.

M47 therefore added the smallest separate canonical record: one `PullRequestIntegrationPlan` per
file, user-home scoped (`AIQT_PR_INTEGRATION_HOME`, default `~/.aiqt/pr-integrations`), with the same
store discipline as `autonomous-run-store.ts` / `portfolio-store.ts`.

Plans live **outside every repository they act on** — storing one in the target tree would make the
plan part of the worktree whose cleanliness the push gate checks, and AIQT must never write into a
repository it is only meant to push an already-prepared branch from. There is no `.aiqt/pr.json` and
no other parallel state database. AIQT's own repository still has no `.aiqt/`.

## 5. Git push safety model

The boundary is enforced by the *shape* of the one allowed operation, not only by AIQT's checks.
`gitPushExactCommitToBranch` is a fixed template:

```text
git push --porcelain <remote> <sha>:refs/heads/<branch>
```

- source is a resolved commit SHA, never a ref → what lands cannot drift between decision and write;
- destination is one fully-qualified `refs/heads` ref → no wildcard, `--all`, `--mirror`, tag, or
  second ref;
- no leading `+` and no `--force`/`--force-with-lease` anywhere in the file → a non-fast-forward is
  rejected **by the remote**, so the guarantee does not depend on AIQT's preflight being correct;
- the source side is never empty → a ref deletion is inexpressible.

Remote/branch/SHA are re-validated at the call site because it is the last point before an
irreversible mutation AIQT cannot undo. Preflight (all of build spec §8) runs first, against freshly
observed reality, in a fixed asserted order: capability → freshness → preflight → write.

**Outcome is verified, never inferred.** The remote source SHA is re-read after the write on both
paths. `git push` exiting 0 is evidence, not proof (exit 0 with a different, absent, or unreadable
remote SHA is `ambiguous`); `git push` throwing is not proof of failure either (a connection can drop
after the remote accepted the update, so a thrown error followed by a remote holding the planned
commit is `verified`). Only exact equality yields `verified`.

## 6. GitHub provider and idempotency model

`github-pull-request-client.ts` mirrors M40's release client: fixed encoded path templates, one
request per operation, no retry loop, token redaction, and `GithubApiOutcome` reused rather than
redefined. The write half is a separate interface extending the read half — exactly three operations
(`createPullRequest`, `requestReviewers`, `getPullRequest`), all POST/GET.

**Lookup always precedes create; a create is never retried blind.** A timeout on `POST /pulls` says
nothing about whether the PR exists, so:

| Situation | Outcome |
|---|---|
| One matching open PR at the planned head SHA | adopted (`reconciled`), never duplicated |
| Open PR on the same branch pair at a different head SHA | `conflict`, blocked |
| More than one open PR for the branch pair | `conflict`, blocked — never adopted by guess |
| Create errored but the follow-up lookup finds the PR | adopted, not repeated |
| Create errored and no PR exists | `failed` |
| Pre-create or post-create lookup itself failed | `ambiguous`, nothing created |
| Plan already records a PR | create path is structurally unreachable |

Create additionally requires the remote source SHA to equal the plan's bound SHA **exactly** —
fast-forward-eligible is enough to push a branch, but a Pull Request is only opened for the reviewed
commit.

## 7. Freshness and resumability

A plan is stale when any write-relevant fact changes: local HEAD, source/base branch, remote name,
remote identity, title+body digest, reviewer set, draft/ready intent, `requireProtectedBase`, or the
stored `bindingDigest` itself (which catches a plan file edited in place to stay internally
consistent). Comparison is field-by-field so the operator is told exactly what moved. Normalization
is shared between the digest and the comparison, so they can never disagree: repository roots are
case-folded on win32/darwin, `owner/repo` is lowercased, branch and remote names are deliberately
**not** folded because Git refs are case-sensitive.

`push_ambiguous` / `pr_ambiguous` are first-class states. Push and create both refuse to act while an
outcome is unknown; `aiqt pr status` is the only path that resolves it, from real remote evidence.
Reconciliation moves a plan only toward more certainty — it never creates a side effect and never
erases one. A recorded Pull Request the provider no longer reports is surfaced as a high-severity
finding, not cleared.

## 8. Protection evidence behaviour

Four-valued and honest: `protected` / `unprotected` / `unverifiable` / `unsupported`. The client
reads `GET /repos/{owner}/{repo}/branches/{branch}` and its plain `protected` boolean, deliberately
**not** the `/protection` endpoint — that one requires admin rights, so a non-admin 403 would be
indistinguishable from "no protection configured". 401/403/404/other/network all map to
`unverifiable`; a response with no protection field maps to `unsupported`. When a plan requires a
protected base, only a verified `protected` may create; the other three block.

Protection is a *create-phase* gate: it blocks creation while leaving the branch push permitted,
since pushing a source branch does not touch the protected base.

## 9. Reviewer and partial-side-effect behaviour

Reviewer assignment is a separate side effect on the same Pull Request. `reviewers` is sent alone,
never `team_reviewers`. Outcomes are `succeeded` / `partial` / `failed` / `not_requested`, with
confirmation matched case-insensitively. "PR created, reviewers failed" is a typed partial state:
re-running `aiqt pr create` completes only the outstanding reviewer request against the **same** Pull
Request — the create path is guarded by `plan.pullRequest !== null` and is structurally unreachable.

## 10. Live disposable dogfood

Run against **`JoaomdvFerreira/aiqt-m47-dogfood`** — a private repository created for this purpose at
the operator's explicit instruction, with **no Actions workflows**, no valuable history, and not the
AIQT product repository (verified by the self-management guard's own definition, not a name
substring). Real `git push` over HTTPS and real GitHub REST calls throughout; the provider was not
stubbed.

8/8 scenarios green. Machine-readable evidence:
`docs/engineering/m47-wu06-live-dogfood-evidence.generated.json`.

Observed on the real repository afterwards:

| Fact | Value |
|---|---:|
| Pull Requests created | 4 (one per dogfood run) |
| …that are drafts | 4 |
| …ready-for-review | 0 |
| …merged or closed by AIQT | 0 |
| Pull Requests per plan | 1 |
| Tags created | 0 |
| Branches deleted | 0 |
| Default branch touched by AIQT | no |

Each run called `aiqt pr create` twice for its own plan and produced exactly one Pull Request — the
duplicate-safety proof against a real provider. Three earlier runs hit test-harness assertion and
timeout defects (corrected between runs, see §12); their branches remain by design, since M47 has no
deletion capability at all and adding one to tidy up a test would defeat the boundary the milestone
exists to establish. Cleanup is the operator's, on a disposable target.

Scenarios covered live: clean prepare → exact-SHA push → draft PR → duplicate-safe re-create →
read-only status/validate; behind-branch fast-forward; diverged branch blocked with the remote
byte-identical afterwards; dirty tree, `source == base`, and moved-HEAD staleness each blocking with
nothing pushed; wrong remote identity and missing credentials blocking; protection evidence reported
honestly and enforced; and a final sweep confirming no tag, no deletion, no force, no approval, no
merge, no release.

Scenarios not exercised **live** (covered deterministically against a real local bare remote and an
in-memory provider instead, because they need an unreachable network or a hostile provider response
that cannot be produced against real GitHub on demand): ambiguous push/create reconciliation,
reviewer-request failure and retry, and the multiple-conflicting-PR case.

## 11. Validation

- **Per Work Unit:** focused tests, `tsc --noEmit`, `eslint`, plus a scoped boundary scan for that
  unit's own hazard class.
- **Closure:** `pnpm validate` (typecheck → lint → build → test → version:check) — **3862 passed, 40
  skipped, 0 failed**. Skips are the four reviewed conditional suites (three real-Docker, one live
  dogfood).
- **Built binary:** `tests/integration/pr-cli-contract.test.ts` spawns `dist/index.js` and asserts the
  shipped command surface, human/JSON parity, exit codes, and that no help text anywhere offers
  `--force`, `--merge`, `--approve`, `--delete`, `--tag`, `--deploy`, `--release`, or a flag taking a
  token value.
- **Hazard suites:** 50 boundary-scan assertions across five per-WU sections.
- **Version:** `pnpm version:check` local mode passes at `0.44.0`.
- No known unrelated local flake was re-run to a pass.

## 12. Corrections made during the milestone

Recorded rather than hidden, per this repository's practice:

1. **`recordPushOutcome` retention rule** (found by WU47-05's reconciliation test): previously kept
   *any* earlier record over a later `failed` one, which prevented reconciliation from turning a
   recorded `ambiguous` into a definite `failed`. Now only a `verified` record is irreplaceable — the
   invariant is "never lose certainty", not "never change".
2. **`pr prepare` blocking scope** (found by WU47-04's base-protection test): previously marked a plan
   terminal on *any* blocking finding, killing plans whose branch push was perfectly safe. Now only a
   push-phase failure is terminal; create-phase findings are reported and re-evaluated at create time.
3. **PR body persistence** (WU47-04): the plan now stores the body, not only its digest. Requiring
   byte-identical re-supply would make resumption fragile in exactly the situation resumption exists
   for.
4. **Superseded boundary assertions:** two WU47-02 assertions ("the PR client makes only GET
   requests", "no `requested_reviewers` endpoint yet") were true and deliberate, and WU47-04
   explicitly lifts them. They were replaced by the narrower invariant that still holds rather than
   left to fail silently.
5. **Test-harness classifications:** `git-command-runner-pr-reads.test.ts` moved from `tests/unit/` to
   `tests/integration/` (it spawns `git`); every PR suite joined the spawning workload class; a new,
   measured `LIVE_REMOTE_SUITE_TEST_TIMEOUT_MS` class was added for the live dogfood after six of
   eight scenarios timed out at the 15 s spawning budget; the M33 command-count, M34 spawning/timeout,
   and M35 skip/domain baselines were each updated deliberately.

## 13. Limitations and residual risk

| # | Limitation | Residual |
|---|---|---|
| L1 | A refused write is terminal for that plan, including for transient causes (dirty tree). Preparing another plan is read-only and cheap, but the operator must do it. | Accepted — fail-closed by choice. |
| L2 | `pr push` and `pr create` both require a GitHub token, even though the push itself uses Git's own credentials. Repository identity is verified against the provider before every write (build spec §9), which needs one. | Accepted. |
| L3 | GitHub only. A non-GitHub remote is `null`, never a guess. | By design (§5 non-goals). |
| L4 | Ambiguity reconciliation, reviewer failure/retry, and multi-PR conflict were proven against a real local remote and an in-memory provider, not live. | Low — the same code paths ran live for every other scenario. |
| L5 | The dogfood repository retains branches and four draft PRs. M47 cannot delete or close them. | Operator cleanup on a disposable target. |
| L6 | `describe.skipIf` means an unconfigured dogfood silently does not run in CI. It warns loudly and this report records the live result. | Accepted, mirrors M38's Docker suites. |

## 14. Definition of Done

| Requirement | Status |
|---|---|
| Fresh exact-SHA integration plan for one managed repo | ✅ |
| Unsafe/stale/ambiguous state blocks before writes | ✅ |
| Exact-SHA fast-forward-only push | ✅ |
| Remote SHA verified after push | ✅ |
| One PR created/reconciled without duplicates | ✅ |
| Draft-default and explicit-ready proven | ✅ |
| Reviewer partial failures recoverable | ✅ |
| Branch-protection evidence honest and enforceable | ✅ |
| `status`/`validate` read-only | ✅ |
| Restart/ambiguity cannot duplicate a side effect | ✅ |
| No approval/merge/deploy/release path exists | ✅ |
| Live disposable dogfood proves push + PR-create | ✅ |
| AIQT self-management absent | ✅ |
| Package/schema decisions correct | ✅ |
| Authoritative closure validation green | ✅ |
| Hosted PR CI green | pending on the PR |
| Development PR ready for human review and manual merge | ✅ |

## 15. Overall risk

**62/100 🟠 orange.** M47 introduces genuinely irreversible external mutation — a real branch push
and a real Pull Request on a real repository. The mitigations are structural rather than procedural:
the dangerous Git variants (force, delete, tag, wildcard, base push) are *inexpressible* in the one
allowed template; the outcome of every write is verified by re-reading the remote rather than
inferred; unknown outcomes are first-class and fail closed; duplicate Pull Requests are prevented by
a mandatory pre-create lookup and a structurally unreachable second-create path; and no approval,
merge, deploy, or release capability exists anywhere in the milestone.

Per `docs/governance/versioning.md`, orange requires human approval before merge — which the
repository's manual-merge process already mandates.
