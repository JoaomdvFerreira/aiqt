# Claude Code Milestone Prompt Template v0.2

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
  product_version: <version>
  baseline_commit: <commit>
  release_tag: <tag>
  milestone_tag: <tag>
  tests: <passing>/<total>
  schema_version: <version>
  Gate_I: <open|closed>

Classification: <small|medium|high_risk> per milestone-protocol.md §1.
Run the Gate audit this class requires (owner confirmation for small/
medium; full Gate + entry-risk ceiling for high_risk) before writing
code. Owners are read from repository-owner-map.json and verified
against current source, not assumed from the map.

Execute the milestone's defined Work Units automatically, in order,
without pausing for approval. For each Work Unit: implement only its
bounded scope, add focused tests, run focused validation (tsc --noEmit,
eslint ., affected tests), one commit, one annotated tag, `Risk: N/100`
in the commit body, a Work Unit report under 250 words.

At closure: run full suite, typecheck, lint, build. Use real CI as the
primary clean-environment authority; run a manual clean-clone only if
packaging, installation, migration, or CI-workflow behavior is in scope,
or a real CI failure needs local reproduction. Run
`pnpm version:check` and treat its result as authoritative for whether
package/schema version changes are required.

Do not use AIQT or create .aiqt/ state to develop AIQT. Preserve commit/
tag/risk governance: one commit and one tag per Work Unit, no history
rewrite, no force-push, no empty commits.

Do not use routine subagents. Use one only if ownership of a concern is
ambiguous and needs independent verification, or independent review of
a finished change is explicitly required.

Stop only for: baseline mismatch; Gate failure; missing/ambiguous
owner; entry risk above the class ceiling (high_risk only); inability
to preserve an existing contract (schema, exit codes, canonicalization,
compatibility); an unexplained real CI failure; a High/Critical
dependency alert without an approved disposition; anything that would
require starting a milestone not explicitly in scope. Do not silently
weaken or waive a stop condition.

Deliver a final closure report under 1,500 words (more only if a
blocker, waiver, or deviation requires it) containing: Gate result;
Work Unit/commit/tag/risk table; validation performed; version/tag
outcome; hazard detail only for exceptions, accepted risks, failed
controls, or residuals above target; confirmation that no
out-of-scope milestone was started.

Stop after formal closure.
```
