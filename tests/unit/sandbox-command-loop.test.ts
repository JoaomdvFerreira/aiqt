import { describe, it, expect } from "vitest";
import { executeSandboxedCommandLoop, type SandboxExecutionBackend, type ProposedSandboxCommand } from "../../src/workflow/sandbox-command-loop.js";
import type { AutonomousExecutionPolicy } from "../../src/schema/autonomous-run.schema.js";
import type { SandboxResourcePolicy } from "../../src/schema/sandbox-backend.schema.js";
import type { SandboxProcessLaunchRequest, SandboxProcessLaunchResult, SandboxCancellationResult, SandboxHandle, SandboxDiskUsageMeasurement } from "../../src/workflow/sandbox-backend-contract.js";

/**
 * M38-WU03: pure tests for the command-mediation/budget loop, using a
 * lightweight, fully in-memory fake backend -- no Docker daemon, no
 * real process, matching this file's own `SandboxExecutionBackend`
 * structural interface (satisfied by `DockerSandboxBackend` too, but
 * never imported here).
 */
class FakeSandboxBackend implements SandboxExecutionBackend {
  launched: SandboxProcessLaunchRequest[] = [];
  cancelled = false;
  diskMeasurement: SandboxDiskUsageMeasurement = { status: "measured", bytes: 0 };
  cancellationReason: string | null = null;
  private launchResult: (req: SandboxProcessLaunchRequest) => SandboxProcessLaunchResult;

  constructor(launchResult: (req: SandboxProcessLaunchRequest) => SandboxProcessLaunchResult = () => ({ ok: true, processHandle: { sandboxId: "s1", processId: "p1" }, reason: "ok" })) {
    this.launchResult = launchResult;
  }

  launchProcess(request: SandboxProcessLaunchRequest): SandboxProcessLaunchResult {
    this.launched.push(request);
    return this.launchResult(request);
  }

  cancel(_handle: SandboxHandle, terminationReason?: string): SandboxCancellationResult {
    this.cancelled = true;
    this.cancellationReason = terminationReason ?? null;
    return { ok: true, processTreeFullyStopped: true, reason: "cancelled" };
  }

  checkDiskUsageBytes(_handle: SandboxHandle): SandboxDiskUsageMeasurement {
    return this.diskMeasurement;
  }
}

const handle: SandboxHandle = { sandboxId: "s1" };

const permissivePolicy: AutonomousExecutionPolicy = {
  allowedCommandClasses: ["read_only_inspection", "repository_local_write", "git_operation", "test_or_build"],
  blockedCommandClasses: [],
  networkPolicy: "denied",
  filesystemBoundary: "/workspace",
  gitBoundary: { allowedBaseRefPrefixes: ["refs/heads/"] },
};

const generousResources: SandboxResourcePolicy = {
  maxWallClockSeconds: 60,
  maxCpuSeconds: 30,
  maxMemoryBytes: 256 * 1024 * 1024,
  maxDiskWriteBytes: 100 * 1024 * 1024,
  maxProcessCount: 16,
  maxCommandCount: 10,
  maxOutputBytes: 1024 * 1024,
  maxRetryCount: 1,
};

function commands(...pairs: [string, string[]][]): ProposedSandboxCommand[] {
  return pairs.map(([command, args]) => ({ command, args }));
}

describe("M38-WU03 sandbox-command-loop: command mediation", () => {
  it("executes every allowed command in order and reports completed", () => {
    const backend = new FakeSandboxBackend();
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]], ["git", ["add", "."]]), permissivePolicy, generousResources);
    expect(result.terminationReason).toBe("completed");
    expect(result.commandsExecuted).toEqual(["git status", "git add ."]);
    expect(backend.launched.length).toBe(2);
  });

  it("stops before running a policy-denied command (destructive), never executes it", () => {
    const backend = new FakeSandboxBackend();
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]], ["rm", ["-rf", "."]]), permissivePolicy, generousResources);
    expect(result.terminationReason).toBe("policy_denied");
    expect(result.commandsExecuted).toEqual(["git status"]);
    expect(backend.launched.length).toBe(1);
    expect(result.denialReason).toMatch(/destructive/i);
  });

  it("stops when a launched command itself fails (backend reports ok:false)", () => {
    const backend = new FakeSandboxBackend((req) => ({ ok: req.command !== "git" || req.args[0] !== "status", processHandle: null, reason: "boom" }));
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]]), permissivePolicy, generousResources);
    expect(result.terminationReason).toBe("policy_denied");
    expect(result.commandsExecuted).toEqual([]);
  });
});

describe("M38-WU03 sandbox-command-loop: budgets", () => {
  it("stops with budget_exhausted once maxCommandCount would be exceeded", () => {
    const backend = new FakeSandboxBackend();
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]], ["git", ["status"]], ["git", ["status"]]), permissivePolicy, { ...generousResources, maxCommandCount: 2 });
    expect(result.terminationReason).toBe("budget_exhausted");
    expect(result.commandsExecuted.length).toBe(2);
  });

  it("a command count exactly at the limit is not exhausted (inclusive ceiling)", () => {
    const backend = new FakeSandboxBackend();
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]], ["git", ["status"]]), permissivePolicy, { ...generousResources, maxCommandCount: 2 });
    expect(result.terminationReason).toBe("completed");
    expect(result.commandsExecuted.length).toBe(2);
  });

  it("stops with resource_limit_exceeded when disk usage exceeds maxDiskWriteBytes after a command runs", () => {
    const backend = new FakeSandboxBackend();
    backend.diskMeasurement = { status: "measured", bytes: 200 * 1024 * 1024 };
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["add", "."]]), permissivePolicy, { ...generousResources, maxDiskWriteBytes: 100 * 1024 * 1024 });
    expect(result.terminationReason).toBe("resource_limit_exceeded");
    expect(result.commandsExecuted).toEqual(["git add ."]);
  });

  it("a measured disk usage exactly at the budget continues normally", () => {
    const backend = new FakeSandboxBackend();
    backend.diskMeasurement = { status: "measured", bytes: 100 };
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]]), permissivePolicy, { ...generousResources, maxDiskWriteBytes: 100 });
    expect(result.terminationReason).toBe("completed");
    expect(backend.cancelled).toBe(false);
  });

  it("a disk-usage measurement unavailable result cancels the sandbox and never reports completed", () => {
    const backend = new FakeSandboxBackend();
    backend.diskMeasurement = { status: "unavailable", reason: "measurement_command_failed" };
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]]), permissivePolicy, generousResources);
    expect(result.terminationReason).toBe("disk_measurement_unavailable");
    expect(result.denialReason).toContain("measurement_command_failed");
    expect(backend.cancelled).toBe(true);
    expect(backend.cancellationReason).toBe("disk_measurement_unavailable");
  });
});

describe("M38-WU03 sandbox-command-loop: deterministic cancellation", () => {
  it("a pre-aborted signal stops the loop before the first command and calls backend.cancel", () => {
    const backend = new FakeSandboxBackend();
    const controller = new AbortController();
    controller.abort();
    const result = executeSandboxedCommandLoop(backend, handle, commands(["git", ["status"]]), permissivePolicy, generousResources, controller.signal);
    expect(result.terminationReason).toBe("cancelled");
    expect(result.commandsExecuted).toEqual([]);
    expect(backend.launched.length).toBe(0);
    expect(backend.cancelled).toBe(true);
  });
});
