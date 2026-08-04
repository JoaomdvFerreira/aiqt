# M32 WU32-02: Read-Only Recommendation Migration

WU32-02 migrates the read-only workflow surfaces to the shared assessment engine:

- `aiqt status`
- `aiqt start`
- `aiqt continue`
- `aiqt review`
- `aiqt manage`

Legacy helpers `computeNextAction()`, `computeReviewNextCommand()`, and `computeGuidance()` now act as compatibility adapters over `assessWorkflow()`. Command-specific presentation remains local, but the substantive recommended command and derived project status come from the assessment result.

Review/manage classification still owns release readiness. Read-only commands that need terminal routing compute classification first and pass `productionReady` into the assessment so all-done states can consistently route to `aiqt export all` when release-ready or `aiqt manage` when production is not ready.

No schema version, package version, runtime dependency, or timeout policy changed.
