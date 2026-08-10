/**
 * M34-WU02: the single source of truth for this repository's per-workload-
 * class Vitest timeout policy (docs/engineering/m34-validation-workload-
 * policy.md Sec 6.1). Every test file that spawns a real subprocess (the
 * CLI, git, or both) imports and applies one of these constants via
 * `vi.setConfig({ testTimeout: ... })` instead of hardcoding its own
 * literal millisecond value -- so the policy has exactly one place to
 * change, not ~30 scattered copies of the same number.
 *
 * `vitest.config.ts`'s global default (5000ms) is deliberately left
 * unchanged: the ~197 fast-unit and filesystem-integration test files (which
 * never spawn a subprocess) keep fast failure on a genuine hang or
 * regression. Only files that structurally cannot finish inside 5000ms even
 * on an idle machine (measured in
 * docs/engineering/m34-validation-workload-policy.md Sec 3) opt into a
 * class-scoped budget.
 */

/**
 * Process-spawning CLI integration (general), Git/worktree integration, and
 * evidence/execution/workspace integration classes. Measured
 * (m34-validation-workload-policy.md Sec 3.4): raising the default to this
 * value alone (no concurrency change) reduced full-suite failures from
 * 56-61 down to 1, at effectively zero wall-time cost.
 */
export const SPAWNING_SUITE_TEST_TIMEOUT_MS = 15000;

/**
 * For an individual file whose own heaviest test measurably exceeds
 * SPAWNING_SUITE_TEST_TIMEOUT_MS's headroom (documented in-file with the
 * measured isolated runtime that justifies it -- see
 * m33-result-contract-characterization.test.ts for the precedent). Not a
 * second "default" -- an explicit, evidenced, per-file exception.
 *
 * M34-WU02: raised from 20000 to 25000 after this milestone's own
 * measurement (docs/engineering/m34-validation-workload-policy.md Sec 3.4)
 * showed the one file using this constant (13 chained CLI spawns, ~11.2s
 * isolated floor) still occasionally exceeded 20000ms under real full-suite
 * concurrent load. 25000ms restores >2x headroom over the isolated floor,
 * matching this repository's established sizing convention (e.g. the M30
 * correction's 15000ms over a 6.2s worst case, ~2.4x).
 */
export const HEAVY_SPAWNING_TEST_TIMEOUT_MS = 25000;

/**
 * M47-WU06: the live-remote class -- a suite whose every step is a real
 * network round-trip to GitHub (`git push`/`ls-remote` over HTTPS plus
 * REST calls), not a local subprocess. Only
 * tests/integration/pr-live-dogfood.test.ts uses it, and only when an
 * operator has explicitly nominated a disposable target repository.
 *
 * Sized from this milestone's own measurement rather than by guess: at
 * SPAWNING_SUITE_TEST_TIMEOUT_MS (15000) six of eight dogfood scenarios
 * timed out, while the file as a whole completed in ~110s -- each scenario
 * performs roughly six to twelve sequential remote round-trips, so the
 * per-test floor is tens of seconds and varies with real network latency
 * in a way no local suite does. 120000ms gives several times the observed
 * worst case, which is appropriate for a suite that never runs in CI and
 * whose failure mode must be "the boundary was violated", never "the
 * network was slow today".
 */
export const LIVE_REMOTE_SUITE_TEST_TIMEOUT_MS = 120000;
