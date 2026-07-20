import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Security upgrade (vitest 2->3, 2026-07-20): the default "forks" pool
    // under vitest 3.2.7 hits a known, hardcoded-60s vitest-worker RPC
    // "onTaskUpdate" timeout on this repository's suite (many spawnSync-
    // heavy real-CLI-process test files; vitest-dev/vitest#8164 -- not
    // configurable via testTimeout, not fixed as of 3.2.7). It never fails
    // an individual test, but it does make vitest's own process exit 1
    // even when every test passed -- confirmed both locally and on real
    // GitHub Actions (Node 22 leg failed the Test step on PR #5 despite
    // "1216 passed"). The "threads" pool uses a different, in-process RPC
    // transport that does not hit this code path; verified locally (both
    // plain and --coverage runs) to exit 0 cleanly, repeatably, with an
    // identical 1216/1216 pass count and no coverage regression.
    pool: "threads",
    // M21-WU05: reproducible coverage baseline only -- no thresholds are
    // configured here. Global/module thresholds are an explicit, separate,
    // reviewed decision for a future milestone (M21 Build Spec v0.2 §5.5),
    // not something this config silently enforces.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/*.d.ts"],
    },
  },
});
