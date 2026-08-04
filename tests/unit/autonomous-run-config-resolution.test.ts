import { describe, it, expect } from "vitest";
import { resolveAutonomousRunConfig, SAFE_DEFAULT_OPERATOR_CONFIG } from "../../src/workflow/autonomous-run-config-resolution.js";

/**
 * M37-WU01 (build spec: "Operator configuration"; precedence: "CLI flags
 * -> project configuration -> environment variables -> safe defaults").
 * Pure unit tests -- no I/O.
 */
describe("resolveAutonomousRunConfig (M37-WU01, pure)", () => {
  it("returns the safe defaults when no layer supplies anything", () => {
    const config = resolveAutonomousRunConfig({ cliFlags: {}, projectConfig: null, env: {} });
    expect(config).toEqual(SAFE_DEFAULT_OPERATOR_CONFIG);
  });

  it("safe defaults are conservative: approval always required, network denied, cleanup always", () => {
    expect(SAFE_DEFAULT_OPERATOR_CONFIG.approvalPolicy).toBe("always_required");
    expect(SAFE_DEFAULT_OPERATOR_CONFIG.networkPolicy).toBe("denied");
    expect(SAFE_DEFAULT_OPERATOR_CONFIG.cleanupPolicy).toBe("always");
  });

  it("environment variables override safe defaults", () => {
    const config = resolveAutonomousRunConfig({
      cliFlags: {},
      projectConfig: null,
      env: { AIQT_AUTONOMOUS_EVIDENCE_DIR: "/env/evidence", AIQT_AUTONOMOUS_NETWORK_POLICY: "explicitly_enabled" },
    });
    expect(config.evidenceOutputDir).toBe("/env/evidence");
    expect(config.networkPolicy).toBe("explicitly_enabled");
  });

  it("project configuration overrides environment variables", () => {
    const config = resolveAutonomousRunConfig({
      cliFlags: {},
      projectConfig: { evidenceOutputDir: "/project/evidence" },
      env: { AIQT_AUTONOMOUS_EVIDENCE_DIR: "/env/evidence" },
    });
    expect(config.evidenceOutputDir).toBe("/project/evidence");
  });

  it("CLI flags override project configuration and environment variables (highest precedence)", () => {
    const config = resolveAutonomousRunConfig({
      cliFlags: { evidenceOutputDir: "/cli/evidence" },
      projectConfig: { evidenceOutputDir: "/project/evidence" },
      env: { AIQT_AUTONOMOUS_EVIDENCE_DIR: "/env/evidence" },
    });
    expect(config.evidenceOutputDir).toBe("/cli/evidence");
  });

  it("ignores an unrecognized environment variable value rather than accepting it", () => {
    const config = resolveAutonomousRunConfig({
      cliFlags: {},
      projectConfig: null,
      env: { AIQT_AUTONOMOUS_NETWORK_POLICY: "not-a-real-value" },
    });
    expect(config.networkPolicy).toBe("denied");
  });

  it("strips destructive/privileged from allowedCommandClasses regardless of which layer supplied them", () => {
    const config = resolveAutonomousRunConfig({
      cliFlags: { allowedCommandClasses: ["read_only_inspection", "destructive", "privileged", "git_operation"] },
      projectConfig: null,
      env: {},
    });
    expect(config.allowedCommandClasses).toEqual(["read_only_inspection", "git_operation"]);
  });

  it("a layer setting defaultBudgets replaces the whole budgets object, not merged field-by-field", () => {
    const partialLookingBudgets = {
      maxWallClockSeconds: 10,
      maxCommandCount: 1,
      maxRetryCount: 0,
      maxChangedFiles: 1,
      maxDiffLines: 1,
      maxValidationSeconds: 1,
    };
    const config = resolveAutonomousRunConfig({
      cliFlags: { defaultBudgets: partialLookingBudgets },
      projectConfig: null,
      env: {},
    });
    expect(config.defaultBudgets).toEqual(partialLookingBudgets);
  });
});
