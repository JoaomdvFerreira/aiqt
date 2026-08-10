# Claude Code Milestone Prompt Template v0.4

Reusable prompt skeleton for future AIQT milestones under
[milestone-protocol.md](milestone-protocol.md). Fill the bracketed fields;
do not paste contract details the referenced documents already define.

```
Implement AIQT Milestone <N> v<spec-version> in the AIQT CLI repository.

Authoritative specification: <path to the single milestone spec file>.
Read it completely before changing code. Do not restate its contracts
here or in Work Unit / closure reports.

Baseline claims to verify (stop and report any material discrepancy):
  branch: <branch>
  product_spec_version: <version>
  architecture_spec_version: <version>
  package_version: <version>
  schema_version: <version>
  baseline_commit: <commit>
  latest_release: <tag or "none">
  milestone_tag: <tag, if this milestone continues prior work>
  tests: <passing>/<total>

product_spec_version, architecture_spec_version, package_version, and
schema_version are independent domains -- verify each against its own
live source (docs/product/, package.json, src/core/constants/schema-
version.ts), never assume one implies another.

Classification: <small|medium|high_risk> per milestone-protocol.md §1.
Verify the entry gates this milestone's build spec states (prior
milestone merged, post-merge CI green, active baselines, clean working
tree, no stray `.aiqt/` state) directly against live Git/GitHub state
before writing code -- per milestone-protocol.md, not a bespoke "Gate"
contract. Owners are read from repository-owner-map.json and verified
against current source, not assumed from the map.

For a `high_risk` milestone, the build spec states, so far as planning can
resolve them (milestone-protocol.md §1 "High-risk planning fields"):
existing owners; resolved decisions; mutation boundaries; persistence/
schema decision; failure/idempotency semantics; validation matrix
(the threat-model table); unresolved decisions named explicitly; baseline
execution profile; escalation triggers. Do not re-derive a decision the
build spec already resolved by rereading the repository during
implementation.

Execution profile: <baselineCapability>/<baselineEffort> per
milestone-protocol.md §12, mapped from the build spec's provider-neutral
profile to this session's actual model/effort setting. Hold this profile
for the whole milestone; do not switch model/effort per Work Unit. Escalate
within the same session, for a bounded portion of a Work Unit, only for a
build-spec-named trigger (an unresolved architecture/ownership decision,
ambiguous irreversible-mutation semantics, an unresolved security boundary,
idempotency/partial-side-effect ambiguity, conflicting canonical owners, or
a repeated failed implementation approach) -- never merely because a Work
Unit's implementation risk is `>= 50` (that already stops for human review
in its own right, per §1/§11, independent of execution profile).

Execute the milestone's defined Work Units automatically, in order,
without pausing for approval. For each Work Unit: implement only its
bounded scope, add focused tests, run focused validation (tsc --noEmit,
eslint ., affected tests), one commit, one annotated tag, `Risk: N/100`
in the commit body, a Work Unit report under 250 words.

At closure: run full suite, typecheck, lint, build. Use real CI as the
primary clean-environment authority; run a manual clean-clone only if
packaging, installation, migration, or CI-workflow behavior is in scope,
or a real CI failure needs local reproduction. An unexplained local
full-suite timeout/failure under load is isolated and classified (re-run
the specific file(s) individually), not repeatedly re-run until green.
Run `pnpm version:check` (local and `--base <target>`) as the authority
for whether `package.json`'s version needs to change. It is NOT the
authority for whether `AIQT_SCHEMA_VERSION` needs to change -- schema
evolution is a canonical-compatibility decision owned by whichever Work
Unit changes canonical shape, made explicitly in that Work Unit, never
inferred from version-check output.

Do not use AIQT or create .aiqt/ state to develop AIQT. Preserve commit/
tag/risk governance: one commit and one tag per Work Unit, no history
rewrite, no force-push, no empty commits. A Work Unit whose implementation
risk reaches 50/100 or higher always stops for human review, regardless
of this milestone's small/medium/high_risk classification.

Do not use routine subagents. Use one only if ownership of a concern is
ambiguous and needs independent verification, or independent review of
a finished change is explicitly required.

Stop only for: baseline mismatch; an entry gate that does not verify
against live state; missing/ambiguous owner; a Work Unit implementation
risk of 50/100 or higher; inability to preserve an existing contract
(schema, exit codes, canonicalization, compatibility); an unexplained
real CI failure; a High/Critical dependency alert without an approved
disposition; anything that would require starting a milestone not
explicitly in scope. Do not silently weaken or waive a stop condition.

Deliver a final closure report under 1,500 words (more only if a
blocker, waiver, or deviation requires it) containing: entry-gate
verification result; Work Unit/commit/tag/risk table; validation
performed; version/tag outcome; hazard detail only for exceptions,
accepted risks, failed controls, or residuals above target; confirmation
that no out-of-scope milestone was started. State explicitly that
milestone/package completion does not by itself authorize a GitHub
Release -- a release is a separate, explicit decision made only after
merge and post-merge CI is green. Do not create or publish a Release
unless separately, explicitly requested.

Stop after formal closure.
```
