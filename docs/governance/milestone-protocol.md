# AIQT Lean Milestone Protocol v0.4

Shared governance for future AIQT milestones. This document defines how a
milestone is classified, scoped, validated, and reported. It is referenced
by milestone specifications and Claude Code prompts, not repeated inside
them.

## 1. Milestone classes

### small

```yaml
work_units: 2-3
typical_spec_words: 1500-2500
examples:
  - additive read-only features
  - bounded CLI/reporting changes
validation:
  per_work_unit: focused
  closure: full
```

### medium

```yaml
work_units: 4-5
typical_spec_words: 2500-4000
examples:
  - new canonical state
  - several bounded integrations
  - non-destructive mutations
validation:
  per_work_unit: focused
  closure: full
```

### high_risk

```yaml
work_units: 6-9
examples:
  - new or materially widened filesystem/Git/network/destructive authority
  - authentication
  - migrations
  - required enforcement
full_ceremony: true
validation:
  per_work_unit: focused, plus targeted hardening tests for the specific
    hazard class (mutation boundary, auth boundary, network boundary, etc.)
  closure: full, plus clean-clone and hazard-by-hazard residual-risk
    reconciliation as used for M28
```

A milestone is classified by its riskiest Work Unit, not its average. A
milestone with one high-risk Work Unit and four small ones is `high_risk`.

#### High-risk planning fields

A `high_risk` build specification states the following before implementation
starts, so far as they are actually resolvable at planning time. Each field
is a fact or a decision the specification records, not a new document: it
lives in the existing build spec, alongside the Work Unit table and threat
model this class already requires.

- **Existing owners** — the live-verified owner-map entries this milestone
  reuses (see §3), confirmed against current source, not assumed from the
  map alone.
- **Resolved decisions** — architecture/ownership questions a planning pass
  could answer by reading a schema or existing contract once (e.g. "does an
  existing record safely own this milestone's new state, or does it need its
  own"), recorded as a conclusion rather than left to be re-derived during a
  Work Unit.
- **Mutation boundaries** — the exact allowed write operation(s), stated as a
  fixed shape (what is inexpressible, not only what is checked).
- **Persistence/schema decision** — what is new canonical state, what is a
  separate schema/version domain, and what must be re-suppliable verbatim
  versus digested at resumption.
- **Failure/idempotency semantics** — a state-retention/idempotency table:
  which recorded outcomes are irreplaceable, which may be superseded, and
  what an ambiguous or partial outcome resolves to.
- **Validation matrix** — already covered by this class's threat-model table;
  no separate artifact.
- **Unresolved decisions** — questions planning could not resolve in
  advance, named explicitly so the executing session knows it is making a
  live call rather than missing one.
- **Baseline execution profile** — this milestone's baseline
  capability/effort per §12.
- **Escalation triggers** — the specific, pre-named conditions under which
  this milestone's baseline may escalate, per §12.

A field that planning genuinely cannot resolve (because it depends on
measurement, live external behavior, or a decision that can only be made
once an earlier Work Unit's code exists) belongs under "Unresolved
decisions," not left unstated.

### Milestone class vs implementation risk

Milestone class (`small`/`medium`/`high_risk`) is a **planning-time**
classification of scope and expected ceremony. Per-Work-Unit
**implementation risk** is a separate, `0`-`100` four-band score (see
`docs/governance/versioning.md`'s risk scale: `0`-`24` green, `25`-`49`
yellow, `50`-`74` orange, `75`-`100` red; human boundary at `50`),
assessed from the actual diff after implementation. A `medium` milestone
can and often does contain only green/yellow Work Units. Reaching an
implementation risk of `50` or more on any Work Unit always stops for
human review, regardless of the milestone's planning-time class -- a
`medium` classification never overrides that boundary. Reusing an
existing, already-bounded controlled-mutation authority (e.g. the M36-M38
autonomous/sandbox execution surface) is not automatically high-risk;
what raises class/risk is *new or materially widened* authority, not the
mere presence of a mutation.

## 2. Delta-only specifications

A milestone specification states only what is new or changed relative to
the last closed milestone: new schema fields, new commands, new owners,
new hazards. It references prior specifications and this protocol by name
instead of restating their contracts, exit-code tables, canonicalization
rules, or trust/scope models. Reuse is the default; a specification that
finds itself re-describing an existing owner's contract should instead
cite [repository-owner-map.json](repository-owner-map.json).

## 3. Shared governance, referenced not repeated

Common contracts (canonical JSON, SHA-256 digesting, exit-code ranges,
trust ordering, evidence scope, versioning policy, CI workflow shape) live
in their owning source files and `docs/governance/versioning.md`. Milestone specs and
prompts reference these by file path via the owner map rather than
copying their definitions inline. When an owner's behavior must change,
the specification says so explicitly and updates the owner map entry.

## 4. Validation scope

- **Per Work Unit**: focused — tests scoped to the Work Unit's own change,
  `tsc --noEmit`, `eslint .`, and only the affected test files/suites.
- **Closure**: full suite, typecheck, lint, build.
- **Full suite mid-milestone**: not run after every Work Unit. Run it
  early only when a Work Unit changes foundational, widely-depended-on
  behavior (a canonical schema, atomic write, exit-code mapping, or
  canonicalization) where a regression would be silent otherwise.

## 5. Clean-environment authority

Real CI (GitHub Actions, `validate` on Node 24) is the primary authority
for clean-environment correctness. A manual local clean-clone is run only
when the change plausibly affects packaging, installation, migrations,
CI-workflow behavior itself, or when debugging a real CI failure requires
local reproduction. It is not a routine step for every milestone.

An unexplained local full-suite failure or timeout under load (e.g. a
Windows development machine's parallel-worker contention) is isolated and
classified -- re-run the specific file(s) individually, confirm they pass
well within their own timeout, and record the finding -- rather than
repeatedly re-running the full suite until it happens to go green. Real
CI on the PR/push is the authoritative confidence gate; a reconciled local
discrepancy does not block closure.

## 6. Reporting limits

- Work Unit reports: under 250 words. State scope, files touched, tests
  added, validation run, and risk score. No specification restatement.
- Final closure reports: under 1,500 words unless a blocker, waiver, or
  deviation requires more detail to be reviewable.
- Hazard detail is included only for: exceptions taken, risks accepted
  above target, controls that failed, or residual risk above target for
  that hazard. Hazards that were controlled to target or below are listed
  by ID and residual value only, with no narrative.

## 7. Subagents

Routine milestone work (reading the spec, implementing a Work Unit,
writing its tests, running focused validation) is done directly, not
delegated to subagents. A subagent is used only when ownership of a
concern is ambiguous and needs independent verification, or when an
independent review of a completed change is explicitly required.

## 8. Ceremony

Full ceremony — Gate audits with entry-risk thresholds, hazard-by-hazard
residual-risk reconciliation, mandatory clean-clone, disposable-project
lifecycle tests, and a long-form closure report — is reserved for
`high_risk` milestones. `small` and `medium` milestones use a lighter
Gate check (baseline verification + owner confirmation for any new or
reused owner) and the reporting limits in §6, without the full hazard
table unless an exception applies.

## 9. Documentation budget

A normal milestone should retain at most one build specification and one
closure report, plus additional documents only for reusable contracts,
architecture decisions, threat models, or durable operational policy. Work
Unit prompts, raw logs, routine implementation reports, and reproducible
CI/test evidence should not normally be retained as permanent
documentation.

## 10. Milestone documentation archive lifecycle

`docs/milestones/active/` holds only the currently active milestone(s).
`docs/milestones/completed/` is a rolling window of the **two most
recently completed** milestones, kept there for convenient near-term
reference. When a new milestone starts, any milestone under
`docs/milestones/completed/` older than the two most recent is moved
(`git mv`, preserving history and all durable files) to
`docs/archive/milestones/mXX/`, and any direct path reference to it
(owner map, cross-referencing governance docs) is updated in the same
commit. Archiving is housekeeping, not a Work Unit, and does not get its
own milestone tag. Pre-standard historical material already under
`docs/archive/legacy-milestones/` is untouched by this rule.

## 11. Execution discipline

Established across M36-M42 and now a standing expectation for every
future milestone, not a per-milestone decision to re-derive:

- **One continuous run.** Execute a milestone's Work Units automatically,
  in order, without pausing for routine approval between them.
- **Continue by default, stop on exception.** Stop only for a material
  scope/architecture/safety exception, a Gate failure, an unexplained
  real CI failure, or a Work Unit implementation risk of `50` or higher
  (§ "Milestone class vs implementation risk" above) -- not for routine
  checkpoints.
- **Targeted context.** Read only the owners and files a Work Unit
  actually needs, per `repository-owner-map.json`; do not re-investigate
  the whole repository at each Work Unit boundary.
- **One pre-PR closure audit.** Perform the Definition-of-Done/version/
  tag/documentation reconciliation once, in one pass, immediately before
  opening the Pull Request -- not repeatedly across the milestone.
- **Compact success, detailed failure.** A Work Unit or closure report
  that passed stays within §6's reporting limits; a failure, exception, or
  deviation gets the detail needed to be independently reviewable,
  regardless of the word-count guidance.

## 12. Milestone execution profile

Informed by the M47 Execution-Efficiency Postmortem: a milestone's actual
reasoning-heavy work concentrates in a small number of specific decisions
(new ownership/architecture calls, irreversible-mutation edge cases,
external idempotency/partial-side-effect semantics), not evenly across every
Work Unit. Execution-capability policy is provider-neutral: it names
capability/effort semantics, never a specific vendor's model name, so a
tool-specific prompt template can map it to whatever is actually available.

- **One stable milestone-level baseline.** Prefer a single baseline
  capability/effort profile for the whole milestone over switching
  capability/effort per Work Unit by default. Frequent switching discards
  retained session context at each boundary; M47's self-caught corrections
  (a plan-blocking-scope error, a state-retention-rule error) were each
  caught by a test written within the same Work Unit that introduced the
  gap, which depends on that context surviving Work Unit boundaries.
- **Bounded escalation, not routing.** Escalation to a stronger
  capability/effort tier is an exception within the same continuous
  session, not a per-Work-Unit routing decision. A build spec states its
  baseline once and names, in advance, the specific triggers under which it
  may escalate for a bounded portion of a Work Unit.
- **Provider-neutral semantics.** State profiles using generic terms, e.g.:

  ```yaml
  baselineCapability: balanced
  baselineEffort: high
  escalationCapability: deep_reasoning
  ```

  A Claude Code (or other tool-specific) prompt template maps these to an
  actual available model/effort setting; the mapping is advisory
  configuration, never a canonical governance concept (see Product
  Specification §15, Provider Neutrality).
- **Escalation triggers are narrow and pre-named**, not discovered mid-run.
  Valid triggers name a *reasoning* difficulty, not a risk score by itself:

  - an unresolved architecture or ownership decision;
  - ambiguous irreversible-mutation semantics;
  - an unresolved security boundary;
  - idempotency / partial-side-effect ambiguity;
  - conflicting canonical owners;
  - a repeated failed implementation approach.

  `implementation risk >= 50` by itself is **not** an escalation trigger.
  Risk (impact/reversibility of a mutation) and reasoning difficulty (how
  hard the decision is to get right) are different dimensions; a Work Unit
  reaching risk 50 already stops for human review under §1/§11 regardless
  of execution profile, which is a separate, existing control.
- **Context preservation is a cost.** When a natural session/context
  boundary is reached mid-milestone, prefer a compact continuation capsule
  (owners, resolved decisions, open corrections) over broad
  reinvestigation — not a reason to switch capability/effort tier.
- **Validation discipline is unaffected.** §4's focused-per-Work-Unit /
  full-at-closure split, and full authoritative validation at closure,
  apply identically regardless of execution profile. Execution-efficiency
  work never weakens a test or a validation boundary.
