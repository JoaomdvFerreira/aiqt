import { describe, it, expect } from "vitest";
import { buildSandboxRunCommandResult } from "../../src/services/sandbox-run-command-result.js";
import type { SandboxEvidence } from "../../src/schema/sandbox-backend.schema.js";

function evidence(overrides: Partial<SandboxEvidence> = {}): SandboxEvidence {
  return {
    backendId: "docker-oci@1",
    backendVersion: "1.0.0",
    capabilities: ["filesystem_isolation"],
    mounts: [],
    environmentVariableNames: [],
    networkPolicy: { mode: "denied", approval: null },
    resourcePolicy: {
      maxWallClockSeconds: 60,
      maxCpuSeconds: 60,
      maxMemoryBytes: 1024,
      maxDiskWriteBytes: 1024,
      maxProcessCount: 1,
      maxCommandCount: 1,
      maxOutputBytes: 1024,
      maxRetryCount: 0,
    },
    commandsExecuted: ["git status"],
    outputBytesCaptured: 10,
    filesChanged: ["a.txt"],
    terminationReason: "completed",
    cleanupStatus: "cleaned",
    residualRisk: "none",
    ...overrides,
  };
}

describe("M38-WU04 sandbox-run-command-result: M33 CommandResult contract", () => {
  it("passed maps to status:passed, exit 0", () => {
    const result = buildSandboxRunCommandResult("run-1", "ISSUE-1", "passed", [], evidence());
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.data).toEqual(evidence());
  });

  it("cancelled/budget_exhausted/blocked all map to status:blocked", () => {
    for (const state of ["cancelled", "budget_exhausted", "blocked"] as const) {
      const result = buildSandboxRunCommandResult("run-1", "ISSUE-1", state, [], evidence());
      expect(result.status).toBe("blocked");
    }
  });

  it("preserves the distinct disk-measurement-unavailable evidence while reporting the live run as blocked", () => {
    const result = buildSandboxRunCommandResult("run-1", "ISSUE-1", "blocked", [], evidence({ terminationReason: "disk_measurement_unavailable", residualRisk: "Disk usage measurement was unavailable (measurement_command_failed); execution stopped because the configured disk budget could not be verified." }));
    expect(result.status).toBe("blocked");
    expect(result.exitCode).toBe(2);
    expect(result.data.terminationReason).toBe("disk_measurement_unavailable");
    expect(result.summary).toContain("measurement_command_failed");
  });

  it("validation_failed/review_rejected/failed all map to status:failed", () => {
    for (const state of ["validation_failed", "review_rejected", "failed"] as const) {
      const result = buildSandboxRunCommandResult("run-1", "ISSUE-1", state, [], evidence());
      expect(result.status).toBe("failed");
    }
  });

  it("findings become warnings, never silently dropped", () => {
    const result = buildSandboxRunCommandResult("run-1", "ISSUE-1", "review_rejected", ["no files changed"], evidence());
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0].message).toBe("no files changed");
  });

  it("never requires human input (unlike simulated/needs_input results elsewhere in this codebase)", () => {
    const result = buildSandboxRunCommandResult("run-1", "ISSUE-1", "passed", [], evidence());
    expect(result.requiresHumanInput).toBe(false);
  });
});
