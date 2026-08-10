# AIQT M47 — Controlled Pull Request Integration

**Build Specification v0.1**

| Field | Value |
|---|---|
| Milestone | M47 |
| Classification | `high_risk` (new external Git-write + GitHub-write authority) |
| Protocol | [Lean Milestone Protocol v0.3](../../../governance/milestone-protocol.md) |
| Work Units | 6 |
| Branch | `milestone/m47-controlled-pr-integration` |
| Baseline | `main` @ `30190dd` (M46 PR #21 merged, post-merge `Validate` green) |
| Package baseline | `0.43.0` |
| Canonical schema baseline | `AIQT_SCHEMA_VERSION = 0.7.0` |

**Primary objective.** Extend AIQT's existing branch/patch/PR-draft handoff
into an explicit, resumable, fail-closed GitHub integration that can push
one already-prepared source branch and create one Pull Request for one
AIQT-managed *external* repository, while preserving exact-SHA provenance,
provider boundaries, and a strict no-merge boundary.

## 1. Source alignment

M47 implements the roadmap capability reserved for Controlled Pull Request
Integration:

```text
explicit branch push
→ PR creation
→ protected-branch / repository-policy inspection
→ reviewer assignment
→ remote status / policy validation
```

M47 preserves:

- M37 branch/patch/PR-draft handoff, stale-approval handling, and
  resumable execution evidence;
- M40/M44 bounded GitHub authentication, repository-identity, evidence,
  and external-failure patterns;
- M46 single-repository resolution as an optional selector only;
- provider-specific integrations behind replaceable adapters;
- missing/unverifiable external evidence reported honestly;
- no AIQT self-management;
- no automatic merge, deployment, or release publication.

## 2. Entry gate (recorded outcome)

| Check | Result |
|---|---|
| M46 PR #21 merged | ✅ merged 2026-08-10T08:19:51Z, merge commit `30190dd` |
| Post-merge `main` `Validate` green | ✅ run `31369597837`, conclusion `success` @ `30190dd` |
| `main` synced, clean worktree | ✅ |
| No `.aiqt/` in the AIQT product repository | ✅ absent |
| Live package version | `0.43.0` (`package.json`) |
| Live canonical schema version | `0.7.0` (`src/core/constants/schema-version.ts`) |
| Live portfolio schema version | `1.0.0` (`src/schema/portfolio.schema.ts`) |
| Rolling milestone-doc hygiene | m44 archived to `docs/archive/milestones/m44/`; owner-map path reference updated |
| Branch created | `milestone/m47-controlled-pr-integration` |

No material baseline/ownership conflict found.

### Verified live owners reused by M47

| Concern | Live owner (verified against source, not the owner map alone) |
|---|---|
| Bounded Git subcommand execution | `src/workspaces/git-command-runner.ts` — one exported function per allowlisted subcommand, `shell: false`, no generic `runGit(args)` |
| Bounded GitHub network surface | `src/services/github-release-client.ts` — fixed operations, encoded path templates, token redaction, no retry loop |
| GitHub credential handling | `--token-env <NAME>` convention + `missingGithubTokenActions()` (`src/workflow/release-draft-policy.ts`); token read from `env[name]`, never a flag value, never persisted |
| `owner/repo` identity parsing | `parseOwnerRepo()` (`src/workflow/release-draft-policy.ts`) |
| AIQT self-management guard | `isAiqtOwnRepository()` (`src/workflow/autonomous-run-self-management-guard.ts`) |
| M37 durable run state | `AutonomousRunRecordSchema` (`src/schema/autonomous-run-record.schema.ts`) + `src/services/autonomous-run-store.ts` (one JSON file per run under the operator-resolved evidence dir) |
| M37 PR-draft text | `buildAutonomousPrDraft()` (`src/workflow/autonomous-run-pr-draft.ts`) |
| M37 autonomous branch naming | `src/workflow/autonomous-run-branch-policy.ts` (`autonomous/` prefix) |
| M46 portfolio membership | `src/schema/portfolio.schema.ts`, `src/state/portfolio-home.ts`, `src/state/portfolio-store.ts`, `src/services/portfolio-service.ts` |
| CommandResult / exit codes | `src/core/output/result.ts`, `src/core/output/exit-codes.ts` |

## 3. Product flow

```text
prepared local branch
→ pr prepare
→ exact repo / remote / base / source / SHA binding
→ read-only policy preflight
→ explicit pr push
→ verify remote source SHA
→ explicit pr create
→ create/reconcile exactly one PR
→ optional reviewer request
→ pr status / pr validate
→ stop
```

Core invariant:

```text
M47 may prepare, push, create, inspect, and validate a PR.
M47 never approves, merges, deploys, or publishes a release.
```

No remote write may occur implicitly because another workflow completed.

## 4. Scope

GitHub PR provider behind a replaceable internal interface; explicit PR
integration plan; repository/remote identity verification; base/source
branch validation; clean-worktree and exact-HEAD binding; bounded remote
branch lookup; fast-forward-only source-branch push; post-push exact
remote-SHA verification; PR creation; draft-by-default behavior; explicit
ready intent; explicit reviewer assignment; duplicate/open-PR detection;
partial-side-effect reconciliation; protected-branch/ruleset evidence
where available; deterministic policy validation; PR status/validate
commands; human/JSON parity; credential redaction; durable reconciliation
state where genuinely required; controlled live dogfood on a disposable
external repository.

## 5. Non-goals

No PR approval; no `approved-for-merge` automation; no merge or
auto-merge; no deployment; no GitHub Release publication; no tag push; no
force/force-with-lease; no branch deletion; no direct push to base/default;
no arbitrary refspecs; no commit creation/amend/rebase/local merge; no
branch switching as an integration side effect; no cloning or
remote-repository creation; no GitHub org discovery; no generic
HTTP/network client; no generic shell execution; no credential
discovery/persistence; no portfolio-wide/batch writes; no cross-repository
transaction semantics; no AIQT self-management; no M48 scope.

## 6. CLI surface

```text
aiqt pr prepare  [--repository <path>] [--remote <name>] [--base <branch>]
                 [--source <branch>] [--title <t>] [--body-file <f>]
                 [--reviewer <login>]... [--ready] [--require-protected-base]
                 [--portfolio <id> --member <id>] [--token-env <NAME>] [--json]
aiqt pr inspect  <integration-id> [--json]
aiqt pr push     <integration-id> [--token-env <NAME>] [--json]
aiqt pr create   <integration-id> [--token-env <NAME>] [--json]
aiqt pr status   <integration-id> [--token-env <NAME>] [--json]
aiqt pr validate <integration-id> [--token-env <NAME>] [--json]
```

All commands support `--json` and preserve the existing `CommandResult`,
exit-code, and stream contracts (`action: "pr"`).

- **`pr prepare`** — read-only. Captures repository identity, remote
  identity, base/source refs, exact local HEAD SHA, PR metadata digest,
  reviewer set, requested write operations, and policy.
- **`pr push`** — first remote write. Pushes only the exact planned SHA to
  the exact planned source branch.
- **`pr create`** — requires remote source SHA == planned SHA. Creates or
  reconciles one PR. Draft by default. Reviewer assignment explicit only.
- **`pr status` / `pr validate`** — read-only. Never approve, label,
  merge, or publish.

## 7. Integration plan and freshness

```ts
PullRequestIntegrationPlan {
  id, createdAt, updatedAt, status
  repositoryRoot, provider
  remoteName, remoteRepositoryIdentity
  baseBranch, sourceBranch, sourceHeadSha
  metadataDigest, title, bodyPath?
  reviewers[]
  createMode           // "draft" | "ready"
  policy               // { requireProtectedBase }
  push?                // recorded push outcome
  pullRequest?         // recorded PR outcome
  reviewerRequest?     // recorded reviewer outcome
  remoteEvidence?      // base-protection evidence
}
```

A plan is **stale** when any write-relevant fact changes: local HEAD,
source/base branch, remote identity, title/body digest, reviewers,
draft/ready intent, or policy requirements. Stale plans cannot push or
create.

**State-owner decision (WU47-01).** M37's `AutonomousRunRecord` is bound
to an autonomous *repair run* (candidate, safety assessment, budgets,
execution policy, sandbox evidence) and is `.strict()`; a PR integration
has no candidate/budget/sandbox facts and exists for branches that no
autonomous run produced. It therefore cannot safely own M47's
reconciliation facts. WU47-01 introduces the smallest canonical state
that can: one `PullRequestIntegrationPlan` JSON file per integration,
stored with the same store discipline as `autonomous-run-store.ts` (fixed
id pattern, one file per record, schema-validated read), under a
`pr-integrations/` subdirectory of the operator-resolved integration home.
It is **not** `.aiqt/pr.json`, is never written into the AIQT product
repository, and does not touch `AIQT_SCHEMA_VERSION` (a separate
schema/version domain, exactly as M46's portfolio schema is).

## 8. Git write boundary

Before push, all of the following are re-verified:

1. target is not the AIQT product repository;
2. repo identity matches plan;
3. worktree is clean;
4. current source branch is the expected one;
5. source != base and source != remote default;
6. local HEAD == planned SHA;
7. remote URL maps to the expected GitHub repository;
8. remote base exists;
9. remote source state is known (present / absent / unverifiable);
10. an existing remote source can only be fast-forwarded;
11. no tags or unrelated refs are included.

Allowed semantic operation:

```text
exact planned commit → exact refs/heads/<source> → non-force
```

Prohibited: force / force-with-lease, ref deletion, tags, wildcard or
multi-ref push, base/default push.

After push, the remote source SHA is re-read and exact equality is
required. Ambiguous write/network outcomes are reconciled, not guessed.

## 9. GitHub provider boundary

Initial provider: GitHub, behind `PullRequestProvider`. Reuses the
existing auth/config/redaction patterns:

- no generic HTTP client — one bounded module with fixed operations;
- least-privilege setup guidance in the missing-credential action list;
- no credential output, persistence, or discovery;
- repository identity checked before every write;
- typed external failures; `not found` is never conflated with
  `could not verify`.

## 10. PR creation and idempotency

Before creation: plan fresh; remote source SHA == planned SHA; exact base;
exact repository; policy gates evaluated.

- matching open PR → return/reconcile, never duplicate;
- conflicting provenance → block, require a new plan;
- ambiguous create failure → lookup before retry;
- retry is idempotent.

Default `draft = true`. A ready PR requires explicit `--ready` intent.

Reviewer assignment: explicit reviewers only; no reviewer discovery;
`PR created + reviewer request failed` is a typed partial state; retry
never creates a second PR; `status` reports PR existence separately from
reviewer-request state.

## 11. Protected branch / policy evidence

Base-branch evidence is one of:

```text
protected | unprotected | unverifiable | unsupported
```

A permission/plan/API failure is never mapped to `unprotected`. When the
plan requires a protected base, only `protected` may proceed;
`unprotected`, `unverifiable`, and `unsupported` all block.

`pr validate` additionally checks: expected repo/base/source; source !=
base/default; exact SHA freshness; clean state before push; no force
semantics; draft/ready intent; reviewer reconciliation; provider
availability; existing-PR conflicts.

## 12. M46 boundary

M46 member resolution may select **one** repository. One plan always
equals one repo + one source + one base + one PR. No fan-out, no
portfolio batch push/create. Portfolio membership is never write
authority.

## 13. Evidence/result semantics

Every remote result answers: repository; base; source; exact SHA;
requested operation; actual side effect; resulting ref/PR; incomplete
steps; evidence quality; next operator action. Success never implies merge
or release readiness.

## 14. Work Units

| WU | Scope | Target risk | Tag |
|---|---|---:|---|
| WU47-01 | Contract, threat model, ownership, freshness/idempotency, state boundary. No remote writes. | 30 🟡 | `m47-wu01-pr-integration-contract` |
| WU47-02 | Read-only repository/remote/base/source/HEAD/protection/provider preflight; `pr prepare`/`pr inspect`. | 35 🟡 | `m47-wu02-pr-preflight-policy` |
| WU47-03 | Exact-SHA fast-forward branch push; bounded Git write; post-write verification; ambiguous-outcome reconciliation. | 60 🟠 | `m47-wu03-exact-sha-branch-push` |
| WU47-04 | Draft-default PR create, exact provenance, duplicate/retry safety, reviewers, partial side effects. | 65 🟠 | `m47-wu04-github-pr-create-reviewers` |
| WU47-05 | Read-only `pr status`/`pr validate`, provenance reconciliation, recovery, M37 handoff reuse, optional single-member M46 resolution. | 45 🟡 | `m47-wu05-pr-status-validation` |
| WU47-06 | Controlled live dogfood, hazard regression, closure. | 55 🟠 | `m47-wu06-controlled-pr-dogfood-closure`, `m47-controlled-pull-request-integration` |

## 15. Required dogfood

Disposable fixtures/repos only. Never AIQT itself. A real GitHub push +
PR-create dogfood is required against a disposable repository, preferably
with no Actions workflow.

Scenarios 1–35 (valid prepare; dirty worktree blocks; source == base
blocks; wrong remote identity blocks; missing remote base blocks; absent
remote source exact push; behind remote source fast-forward; diverged
remote blocks without force; HEAD change → stale; metadata/reviewer change
→ stale; draft create; explicit ready intent; duplicate create → one PR;
ambiguous retry → lookup prevents duplicate; conflicting existing PR →
block/reconcile; reviewer success; reviewer failure → typed partial with
no duplicate on retry; protected / unprotected / unverifiable evidence;
required protection + non-protected → block; missing credentials → safe
action list; provider failure mapping with no secret leakage;
status/validate read-only; M46 resolution stays one-repo; no tags; no
branch delete; no force; no approval; no merge; no deploy/release; no AIQT
self-management; human/JSON parity; restart reconciles partial side
effects; M37 request/import and branch/patch handoff still valid).

Before live dogfood: explicit disposable target; verified GitHub
auth/minimum permissions; target != AIQT repository; no valuable
branch/history at risk; Actions-light target. If a safe target or
credentials are unavailable, stop for operator setup.

## 16. Validation

Per WU: focused/impacted tests, `pnpm typecheck`, `pnpm lint`, plus
hazard-specific tests for the WU's hazard class. No full suite after every
WU.

Closure: full authoritative validation, version checks, Git/provider/
security hazard suites, built-binary CLI behavior, real controlled
dogfood, pre-PR audit (`pnpm pr:ready`), docs closure. Known unrelated
local flakes are isolated and classified, never re-run until lucky.

## 17. Versioning

New public CLI surface and external-write capability → package **minor**
bump: `0.43.0 → 0.44.0`.

`AIQT_SCHEMA_VERSION` is **not** changed: M47's durable state is a new,
separate schema/version domain (`PR_INTEGRATION_SCHEMA_VERSION`), exactly
as M46's portfolio manifest is, and no canonical `project.json`/
`state.json` contract changes.

## 18. Documentation lifecycle

Active: `docs/milestones/active/m47/build-spec.md`.
Closure: `docs/milestones/completed/m47/build-spec.md` and
`docs/milestones/completed/m47/closure-report.md`. Rolling two-completed
policy applies. No permanent WU prompt/log docs.

## 19. Cross-WU invariants

No AIQT self-management; one plan → one repo/source/base/PR; no implicit
write; exact-SHA binding; stale plans fail closed; no force/base
push/delete/tag; no commit/rebase/local merge creation; remote identity
verified before writes; credentials never discovered or persisted;
unavailable evidence stays unavailable; duplicate PR side effects
prevented/reconciled; partial side effects resumable; draft is the safe
default; reviewer assignment explicit; never approve/merge/deploy/release;
reuse M37/M40/M44/M46 owners; no portfolio batch writes; no M48.

## 20. Definition of Done

M47 closes only when: one managed repo can produce a fresh exact-SHA
integration plan; unsafe/stale/ambiguous state blocks before writes; one
exact-SHA fast-forward-only push works; remote SHA is verified after push;
one GitHub PR can be created/reconciled without duplicates; draft-default
and explicit-ready behavior are proven; reviewer partial failures are
recoverable; branch-protection evidence is honest and policy-enforceable;
status/validate are read-only; restart/ambiguous failures cannot create
duplicate side effects; no approval/merge/deploy/release path exists; live
disposable dogfood proves push + PR-create; AIQT self-management remains
absent; package/schema decisions are correct; authoritative closure
validation and hosted PR CI are green; the M47 development PR is ready for
human review and manual merge.
