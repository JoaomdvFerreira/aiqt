import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
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
