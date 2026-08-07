# AIQT Lean Milestone Protocol v0.2

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
work_units: 3-5
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
  - Git/filesystem mutation
  - network/provider runtime
  - migrations
  - authentication
  - destructive operations
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

Real CI (GitHub Actions, `validate` on Node 22 and 24) is the primary
authority for clean-environment correctness. A manual local clean-clone
is run only when the change plausibly affects packaging, installation,
migrations, CI-workflow behavior itself, or when debugging a real CI
failure requires local reproduction. It is not a routine step for every
milestone.

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
