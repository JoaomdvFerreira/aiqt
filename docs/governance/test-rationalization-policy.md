# AIQT Test Rationalization Policy

**Origin:** established by Milestone 35 (WU35-02 through WU35-04); a durable
governance contract, not a milestone-scoped record. The specific
inventory numbers this policy was originally calibrated against (file
counts, criticality tiers, runtime baseline) are a point-in-time snapshot
of that milestone, preserved at
[`docs/archive/milestones/m35/m35-test-suite-inventory.md`](../archive/milestones/m35/m35-test-suite-inventory.md)
-- re-read that document directly for current numbers rather than trusting
a count restated here.

## Purpose

The governing policy for every test removal, merge, rewrite, or layer
move in this repository, present and future. This document defines the
evidence a change must carry, the review gate for high-stakes tests, and
the quality gates that must hold before and after any reduction. It is a
policy contract, not itself a record of any specific deletion.

## 1. Governing principle

Per the build spec (Sec 1):

```text
reduce waste
preserve signal
measure everything
```

Raw test count is explicitly **not** a quality metric (build spec Sec 6). A smaller suite that has lost real regression-detection power is a worse outcome than a larger suite that runs slower — this policy exists to make that trade-off impossible to make by accident.

## 2. Deletion-evidence contract

**Every future test or suite removal or merge must record the following seven fields**, before the change is made, in the Work Unit's commit body or an accompanying evidence document:

```text
test/suite               -- exact file path and test name(s) affected
behavior covered         -- what regression this test actually catches, in
                             concrete terms (not "tests X function" — what
                             wrong behavior would this test have caught?)
reason                   -- why this specific test is being removed/merged
                             now (duplicate of what; obsolete because what
                             changed; low-signal because what was found on
                             inspection)
equivalent remaining     -- the specific file/test that now covers the same
  coverage                  behavior, OR an explicit statement that no
                             equivalent coverage remains and why that is
                             acceptable (see Sec 3, "demonstrably obsolete")
criticality               -- the classification from
                             docs/archive/milestones/m35/m35-test-suite-inventory.md
                             (Critical / High-value / Normal / Low-signal)
risk                      -- what could go wrong if this removal is wrong
                             (a real regression path, not a generic
                             disclaimer)
validation evidence       -- the specific command(s) run and their result,
                             proving the remaining suite still passes and
                             still catches the behavior this test covered
                             (e.g. a deliberately-reintroduced bug that the
                             remaining coverage still catches, where
                             practical)
runtime impact            -- measured before/after duration for the
                             affected file(s), sourced from a real
                             vitest --reporter=json run, not estimated
```

A change that cannot honestly fill in all seven fields does not have sufficient evidence to proceed. "I believe this is redundant" is not evidence; a side-by-side read of both tests' actual assertions, plus one of them intentionally broken to confirm the other still catches the same class of regression, is.

## 3. When deletion without equivalent coverage is allowed

Per the build spec (Sec 6): **only** when the tested behavior is demonstrably obsolete or invalid. In this repository, "demonstrably obsolete" means at least one of:

- The behavior itself was removed or replaced by a merged milestone commit (cite the commit and closure report), and no currently-reachable code path can still exercise the old behavior.
- The test asserts on a schema/state shape that is provably below any version this repository's own `assertCompatibleVersion` (or equivalent) logic still accepts — i.e., the input the test constructs would itself be rejected by current code before the assertion under test is ever reached, independent of the change under review.
- The test was already asserting a behavior contradicted by a later, more-authoritative test (a genuine regression in the older test itself, not a design change) — this requires showing both tests' git blame/history to confirm which one is the stale one.

**Not sufficient grounds for "demonstrably obsolete":** a test being slow, a test's name sounding old, a test being written for an earlier milestone (age alone is not evidence — see `m22`/`m24`/`m25`/`m26`-historical-compatibility in the current inventory, all of which remain plausibly load-bearing specifically *because* they are old and prove old data still works), or a test's assertion count being small (see Sec 5's Low-signal handling below — small assertion count triggers *investigation*, not automatic deletion).

## 4. Critical/High-value owner-review gate

Per the build spec (Sec 5): **Critical and High-value tests require explicit owner review before any semantic reduction** (deletion, merge, or assertion-weakening — not layer moves or pure runtime optimization that preserves identical assertions).

In this repository's Lean Milestone Protocol, "owner review" means: the Work Unit's own commit message must show the specific reasoning above (Sec 2's seven fields) in enough detail that a reader who did not perform the change could verify it independently, **and** the change must not be bundled into a commit whose primary stated purpose is something else — a Critical/High-value test reduction gets its own clearly-labeled reasoning, not a passing mention inside an unrelated commit body.

At the M35 baseline, a majority of the suite (87 of 232 files High-value, 60 Critical — see `docs/archive/milestones/m35/m35-test-suite-inventory.md` Sec 3.2 for the exact snapshot) was already classified High-value or Critical, and the suite has only grown since. This gate is therefore the default path for most files a future Work Unit might touch, not an edge case.

## 5. Handling each candidate category

| Category | Default action | Requires owner-review gate (Sec 4)? | Notes |
| --- | --- | --- | --- |
| Duplicate (confirmed) | Merge into one, following Sec 2's contract | Only if either file is Critical/High-value | "Confirmed" requires reading both files' actual assertions, not filename similarity alone (see the `checkpoint-next-flow`/`next-checkpoint-flow` false-positive in the inventory, Sec 5.4) |
| Obsolete (confirmed per Sec 3) | Delete, recording Sec 2's contract with the "no equivalent coverage" branch justified | Only if Critical/High-value | Legacy-compatibility tests are presumptively **not** obsolete (Sec 3) — they exist specifically to prove old behavior still works |
| Low-signal | Rewrite (strengthen assertions) preferred over decommission | Only if reclassified High-value+ on closer reading | A file classified Low-signal by the WU35-01 heuristic (prompt-generation domain, Sec 5.3 of the inventory) must still be individually read before any action — the heuristic is a triage signal, not a verdict |
| Misplaced | Move layer (e.g. `tests/integration/` → `tests/unit/`, or vice versa) | No (layer move alone, with identical assertions, is not a semantic reduction) | None found in the current inventory (Sec 5.6) |
| Flaky | Investigate root cause before any timeout/concurrency change | No | Per M34's own established principle (`docs/archive/legacy-milestones/m34-validation-workload-policy.md`), reactive per-file timeout escalation is not an acceptable primary fix — root-cause first |
| Performance-heavy | Optimize (layer move, shared helper, batched scenario — build spec Sec 7 WU35-03 examples) preferred over reduction | Only if the optimization changes what is actually asserted | Runtime alone is never sufficient justification to delete a Critical/High-value test — see Sec 1's governing principle |

## 6. Quality gates (every WU35-02/03/04 change must hold all of)

Per the build spec's cross-Work-Unit invariants (Sec 8) and Success Metrics (Sec 4):

- Zero known critical regression gaps (the Sec 3.2/critical-coverage-checklist categories in the inventory must remain fully covered after any change).
- Zero unexplained or unauthorized skips. `it.skip`/`describe.skip`/`it.todo`/`skipIf` introduced purely for speed remain disallowed. A capability-dependent skip (e.g. a Docker daemon requirement, as introduced by M38's sandbox suites) is permitted only when it is a deterministic capability check, carries an explicit logged reason, and is recorded as a reviewed exception in the test inventory — never a silent or convenience skip. This baseline was **0** at M35; M38 added the first reviewed exceptions (see `repository-owner-map.json`'s `sandboxBackendContract` entry) — the invariant is "every skip is explained and reviewed," not "the count never changes from zero."
- Zero hidden assertion regressions (every removal/merge/rewrite must show the remaining suite still fails on a deliberately-reintroduced version of the bug the removed test would have caught, where practical to construct).
- The Critical-tier test set (60 files, Sec 3.2 of the inventory) is preserved in full, or each individual reduction within it carries its own Sec 2 evidence and Sec 4 review.
- Built-binary smoke (`tests/integration/built-binary-smoke.test.ts`) remains present and green.
- Node 24 CI remains green.
- No per-file timeout proliferation (no new `vi.setConfig`/inline timeout override introduced as a workaround for a runtime-optimization change — if a file genuinely needs a different timeout tier after a layer move, it must use the existing shared constants in `tests/workload-timeout-policy.ts`, per M34's established policy, not a new local literal).

## 6a. Interaction with later milestones (M41, M42)

- **M41 (adaptive test selection) never supplies deletion evidence.**
  `aiqt validation select`/`explain` and execution-guidance's test-impact
  integration decide which subset of the suite runs *for a given change,
  right now* — a scoping/scheduling decision, not a statement that the
  unselected tests are redundant, obsolete, or safe to remove. A file
  never selected in some sample of runs is not thereby a rationalization
  candidate; only this policy's Sec 2/3 evidence contract can justify
  removal.
- **M42 (defect remediation) never resolves a discovered defect by
  weakening the test that caught it.** If a validated defect's
  remediation would touch the test that discovered it (e.g. loosening an
  assertion, adding a skip, deleting the test), that change must
  independently satisfy this policy's Sec 2 (deletion-evidence contract)
  and, if the test is Critical/High-value, Sec 4 (owner-review gate) —
  the defect's existence and severity are not themselves sufficient
  justification. A defect is resolved by fixing the behavior the test
  correctly caught, not by removing the detector.

## 7. Runtime target

Primary target (build spec Sec 4): **authoritative per-commit CI duration under 5 minutes**.

Current baseline (`docs/archive/milestones/m35/m35-test-suite-inventory.md` Sec 4.3): ~9 minutes (Node 24 leg alone, once Node 22 is removed from the mandatory matrix per Sec 2 of that document). The inventory's Sec 4.5 cost-concentration finding (top 30 of 232 files = 96% of measured execution time) is the direct input to WU35-03's prioritization — the runtime target is reached by optimizing the identified performance-heavy set, not by broad, undifferentiated test removal across the whole suite. **No test may be removed merely to improve the headline runtime number** (build spec Sec 3, explicit invariant #11) — every reduction must independently satisfy Sec 2 through Sec 5 of this policy regardless of its runtime effect.

## 8. Before/after recording requirement

Every Work Unit from WU35-02 onward must record, in its commit body and (for WU35-04) the closure report:

- total CI wall-clock (Node 24 leg, sourced from a real CI run, not a local estimate);
- test execution and collection time;
- build time;
- slowest files and tests (recomputed, compared against this document's Sec 4.5/inventory Sec 4.5 baseline);
- process and worker counts;
- total test/file counts;
- duplicate/obsolete/low-signal candidate counts (how many were investigated, how many acted on, how many rejected as false positives — like the two cases this Work Unit already found, Sec 5.4/5.6 of the inventory);
- flaky-test status;
- timeout and assertion-failure counts (both must be reported honestly, per the pattern established throughout M34 — a run with a known-flaky-file timeout failure is not to be reported as "passing" without that caveat);
- built-binary coverage;
- critical coverage map (confirming the Sec 3.2 checklist above still holds).

This mirrors the reporting discipline already established in `docs/archive/legacy-milestones/m34-validation-workload-policy.md` and `docs/archive/legacy-milestones/m34-closure-report.md` — this policy does not invent a new reporting standard, it applies the one already proven in this repository to test-suite changes specifically.
