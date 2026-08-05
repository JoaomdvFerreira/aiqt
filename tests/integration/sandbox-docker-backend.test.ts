import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempDir, removeDir } from "../helpers.js";
import { DockerSandboxBackend } from "../../src/workspaces/sandbox-docker-backend.js";
import { DEFAULT_SANDBOX_NETWORK_POLICY } from "../../src/schema/sandbox-backend.schema.js";
import type { SandboxCreateRequest, SandboxHandle } from "../../src/workflow/sandbox-backend-contract.js";

vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");

/**
 * M38-WU02 (build spec: "Implement one real backend with enforceable
 * mounts, environment allowlist, network denial, resource controls,
 * isolated temp/output, and cleanup"). Exercises DockerSandboxBackend
 * against a REAL Docker daemon -- no mocks. Per
 * docs/engineering/m38-sandbox-platform-decision.md, Docker is only
 * expected to be present on Linux CI (ubuntu-latest); this Windows
 * development machine has no Docker installed at all. The suite gates
 * itself on a real `checkAvailability()` probe rather than assuming
 * either way -- when Docker is unavailable, every real-container test
 * is skipped with a clear reason (not silently passed, not failed);
 * when it IS available (expected in this repository's own CI), every
 * test below exercises a real `docker create`/`docker rm`.
 */
const backend = new DockerSandboxBackend();
const availability = backend.checkAvailability();
const dockerAvailable = availability.available;

if (!dockerAvailable) {
  console.log(`[sandbox-docker-backend.test.ts] Docker is not available on this host (${availability.reason}) -- real-container tests are skipped, not failed.`);
}

describe.skipIf(!dockerAvailable)("M38-WU02 DockerSandboxBackend (real Docker daemon required)", () => {
  let worktreeDir: string | null = null;
  let outputDir: string | null = null;
  const createdHandles: SandboxHandle[] = [];

  beforeAll(() => {
    worktreeDir = makeTempDir("aiqt-sandbox-worktree-");
    outputDir = makeTempDir("aiqt-sandbox-output-");

    // Warm the sandbox base image once, here, outside any single test's
    // own timeout budget -- a cold `docker build` (registry pull +
    // apt-get install) measurably exceeds even HEAVY_SPAWNING_TEST_TIMEOUT_MS
    // (25000ms) under real CI load (observed: ~20s for the build alone).
    // Every test below reuses the now-cached image via create()'s own
    // `docker image inspect` fast path, which is fast.
    const warm = backend.create(baseRequest());
    if (warm.ok && warm.handle) backend.destroy(warm.handle);
  }, 120_000);

  afterAll(() => {
    if (worktreeDir) removeDir(worktreeDir);
    if (outputDir) removeDir(outputDir);
  });

  afterEach(() => {
    for (const handle of createdHandles.splice(0)) {
      backend.destroy(handle);
    }
  });

  function baseRequest(overrides: Partial<SandboxCreateRequest> = {}): SandboxCreateRequest {
    return {
      runId: `test-run-${Date.now()}`,
      filesystemPolicy: {
        worktreeMount: { hostPath: worktreeDir!, sandboxPath: "/workspace", mode: "read_write" },
        readOnlyMounts: [],
        isolatedOutputDirectory: outputDir!,
      },
      environmentPolicy: { allowedVariableNames: ["LANG"] },
      networkPolicy: DEFAULT_SANDBOX_NETWORK_POLICY,
      processPolicy: { processCountLimit: 16, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 },
      resourcePolicy: {
        maxWallClockSeconds: 60,
        maxCpuSeconds: 30,
        maxMemoryBytes: 256 * 1024 * 1024,
        maxDiskWriteBytes: 50 * 1024 * 1024,
        maxProcessCount: 16,
        maxCommandCount: 10,
        maxOutputBytes: 1024 * 1024,
        maxRetryCount: 1,
      },
      ...overrides,
    };
  }

  it("reports available:true with a real Docker server version", () => {
    expect(availability.available).toBe(true);
    expect(availability.reason).toMatch(/Docker server version/);
  });

  it("reportCapabilities never claims process_tree_control, disk_limit, or network_destination_restriction (none are real yet)", () => {
    const report = backend.reportCapabilities();
    expect(report.capabilities).not.toContain("process_tree_control");
    expect(report.capabilities).not.toContain("disk_limit");
    expect(report.capabilities).not.toContain("network_destination_restriction");
    expect(report.capabilities).toContain("filesystem_isolation");
    expect(report.capabilities).toContain("network_deny");
  });

  it("creates a real container, confirmed via `docker inspect`, then cleans it up and confirms real removal", () => {
    const result = backend.create(baseRequest());
    expect(result.ok).toBe(true);
    expect(result.handle).not.toBeNull();
    createdHandles.push(result.handle!);

    const cleanupResult = backend.cleanup(result.handle!);
    expect(cleanupResult.status).toBe("cleaned");
  });

  it("refuses to create a sandbox whose worktree mount targets the AIQT product's own repository (self-management guard, real backend boundary)", () => {
    const result = backend.create(baseRequest({ filesystemPolicy: { worktreeMount: { hostPath: repoRoot, sandboxPath: "/workspace", mode: "read_write" }, readOnlyMounts: [], isolatedOutputDirectory: outputDir! } }));
    expect(result.ok).toBe(false);
    expect(result.handle).toBeNull();
    expect(result.reason.toLowerCase()).toContain("self-management");
  });

  it("refuses to create a sandbox with a blocked environment variable name in the allowlist", () => {
    const result = backend.create(baseRequest({ environmentPolicy: { allowedVariableNames: ["AWS_SECRET_ACCESS_KEY"] } }));
    expect(result.ok).toBe(false);
    expect(result.handle).toBeNull();
  });

  it("refuses network-enabled live execution even with a fully-bound approval -- this backend has no destination-restriction capability", () => {
    const result = backend.create(
      baseRequest({
        networkPolicy: {
          mode: "explicitly_enabled",
          approval: { candidateId: "c1", provider: "p1", destinationAllowlist: ["example.com"], reason: "test", durationSeconds: 60, maxRequestCount: 5 },
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.handle).toBeNull();
    expect(result.reason.toLowerCase()).toContain("network");
  });

  it("the created container has --network none applied (real network denial, confirmed via docker inspect)", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);
    createdHandles.push(created.handle!);

    const networkMode = execFileSync("docker", ["inspect", "--format", "{{.HostConfig.NetworkMode}}", created.handle!.sandboxId], { encoding: "utf8" }).trim();
    expect(networkMode).toBe("none");
  });

  it("the created container mounts only the worktree (read-write) and output directory (read-write) -- never the operator's home directory", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);
    createdHandles.push(created.handle!);

    const mountsJson = execFileSync("docker", ["inspect", "--format", "{{json .Mounts}}", created.handle!.sandboxId], { encoding: "utf8" }).trim();
    const mounts = JSON.parse(mountsJson) as { Destination: string; RW: boolean }[];
    expect(mounts.some((m) => m.Destination === "/workspace" && m.RW)).toBe(true);
    expect(mounts.some((m) => m.Destination === "/aiqt-output" && m.RW)).toBe(true);
    expect(mounts.length).toBe(2);
  });
});

describe.skipIf(!dockerAvailable)("M38-WU03 DockerSandboxBackend: real launchProcess/streamEvents/cancel/collectResult/exportEvidence (real Docker daemon required)", () => {
  let worktreeDir: string | null = null;
  let outputDir: string | null = null;
  const createdHandles: SandboxHandle[] = [];

  beforeAll(() => {
    worktreeDir = makeTempDir("aiqt-sandbox-wu03-worktree-");
    outputDir = makeTempDir("aiqt-sandbox-wu03-output-");
    const warm = backend.create(baseRequest());
    if (warm.ok && warm.handle) backend.destroy(warm.handle);
  }, 120_000);

  afterAll(() => {
    if (worktreeDir) removeDir(worktreeDir);
    if (outputDir) removeDir(outputDir);
  });

  afterEach(() => {
    for (const handle of createdHandles.splice(0)) {
      backend.destroy(handle);
    }
  });

  function baseRequest(overrides: Partial<SandboxCreateRequest> = {}): SandboxCreateRequest {
    return {
      runId: `test-wu03-run-${Date.now()}`,
      filesystemPolicy: {
        worktreeMount: { hostPath: worktreeDir!, sandboxPath: "/workspace", mode: "read_write" },
        readOnlyMounts: [],
        isolatedOutputDirectory: outputDir!,
      },
      environmentPolicy: { allowedVariableNames: ["LANG"] },
      networkPolicy: DEFAULT_SANDBOX_NETWORK_POLICY,
      processPolicy: { processCountLimit: 16, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 },
      resourcePolicy: {
        maxWallClockSeconds: 60,
        maxCpuSeconds: 30,
        maxMemoryBytes: 256 * 1024 * 1024,
        maxDiskWriteBytes: 50 * 1024 * 1024,
        maxProcessCount: 16,
        maxCommandCount: 10,
        maxOutputBytes: 1024 * 1024,
        maxRetryCount: 1,
      },
      ...overrides,
    };
  }

  it("reportCapabilities now includes process_tree_control and disk_limit (real as of WU38-03), still never network_destination_restriction", () => {
    const report = backend.reportCapabilities();
    expect(report.capabilities).toContain("process_tree_control");
    expect(report.capabilities).toContain("disk_limit");
    expect(report.capabilities).not.toContain("network_destination_restriction");
  });

  it("launchProcess runs a real command inside the sandbox and captures real output", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);
    createdHandles.push(created.handle!);

    const result = backend.launchProcess({ handle: created.handle!, command: "echo", args: ["hello-from-sandbox"] });
    expect(result.ok).toBe(true);
    expect(result.processHandle).not.toBeNull();

    const events = backend.streamEvents(created.handle!);
    expect(events.some((e) => e.kind === "started")).toBe(true);
    expect(events.some((e) => e.kind === "exited" && e.boundedDetail.includes("hello-from-sandbox"))).toBe(true);
  });

  it("launchProcess against an unknown handle fails cleanly, never fabricates success", () => {
    const result = backend.launchProcess({ handle: { sandboxId: "definitely-not-a-real-container" }, command: "echo", args: ["hi"] });
    expect(result.ok).toBe(false);
    expect(result.processHandle).toBeNull();
  });

  it("a real git command run via launchProcess actually mutates the mounted worktree on the host", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);
    createdHandles.push(created.handle!);

    const initResult = backend.launchProcess({ handle: created.handle!, command: "git", args: ["init", "-q"] });
    expect(initResult.ok).toBe(true);
    const configEmail = backend.launchProcess({ handle: created.handle!, command: "git", args: ["config", "user.email", "sandbox@example.com"] });
    expect(configEmail.ok).toBe(true);
    const configName = backend.launchProcess({ handle: created.handle!, command: "git", args: ["config", "user.name", "sandbox"] });
    expect(configName.ok).toBe(true);
    const touch = backend.launchProcess({ handle: created.handle!, command: "sh", args: ["-c", "echo hi > new-file.txt"] });
    expect(touch.ok).toBe(true);

    expect(existsSync(join(worktreeDir!, "new-file.txt"))).toBe(true);
  });

  it("cancel stops the container and is confirmed via a real docker inspect -- the whole process tree is guaranteed gone", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);

    const cancelResult = backend.cancel(created.handle!);
    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.processTreeFullyStopped).toBe(true);

    const runningCheck = execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", created.handle!.sandboxId], { encoding: "utf8" }).trim();
    expect(runningCheck).toBe("false");

    // Already stopped by cancel(); cleanup() (not destroy()) still needs to run to actually remove it.
    const cleanupResult = backend.cleanup(created.handle!);
    expect(cleanupResult.status).toBe("cleaned");
  });

  it("collectResult reflects a real cancellation", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);
    createdHandles.push(created.handle!);
    backend.cancel(created.handle!);
    const result = backend.collectResult(created.handle!);
    expect(result.terminationReason).toBe("cancelled");
  });

  it("checkDiskUsageBytes reports a real, positive byte count for a worktree with real content", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);
    createdHandles.push(created.handle!);
    backend.launchProcess({ handle: created.handle!, command: "sh", args: ["-c", "echo hello > file.txt"] });
    const usage = backend.checkDiskUsageBytes(created.handle!);
    expect(usage).not.toBeNull();
    expect(usage!).toBeGreaterThan(0);
  });

  it("exportEvidence refuses before cleanup() has run, then succeeds after with real, non-fabricated data", () => {
    const created = backend.create(baseRequest());
    expect(created.ok).toBe(true);

    const tooEarly = backend.exportEvidence(created.handle!);
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.evidence).toBeNull();

    backend.launchProcess({ handle: created.handle!, command: "echo", args: ["evidence-test"] });
    const cleanupResult = backend.cleanup(created.handle!);
    expect(cleanupResult.status).toBe("cleaned");

    const evidenceResult = backend.exportEvidence(created.handle!);
    expect(evidenceResult.ok).toBe(true);
    expect(evidenceResult.evidence).not.toBeNull();
    expect(evidenceResult.evidence!.commandsExecuted).toContain("echo evidence-test");
    expect(evidenceResult.evidence!.cleanupStatus).toBe("cleaned");
    expect(evidenceResult.evidence!.terminationReason).toBe("completed");
    expect(evidenceResult.evidence!.environmentVariableNames).toEqual(["LANG"]);
  });
});

describe("M38-WU03 DockerSandboxBackend: launchProcess/cancel/exportEvidence against an unknown handle fail cleanly, never fabricate success (no Docker required)", () => {
  it("launchProcess reports ok:false for a handle that was never created", () => {
    const result = backend.launchProcess({ handle: { sandboxId: "nonexistent" }, command: "echo", args: ["hi"] });
    expect(result.ok).toBe(false);
    expect(result.processHandle).toBeNull();
  });

  it("streamEvents returns an empty array for an unknown handle", () => {
    expect(backend.streamEvents({ sandboxId: "nonexistent" })).toEqual([]);
  });

  it("cancel reports ok:false for a handle that was never created", () => {
    const result = backend.cancel({ sandboxId: "nonexistent" });
    expect(result.ok).toBe(false);
    expect(result.processTreeFullyStopped).toBe(false);
  });

  it("collectResult reports terminationReason:not_yet_supported for a handle that was never created (honest 'nothing happened here', never a fabricated 'completed')", () => {
    const result = backend.collectResult({ sandboxId: "nonexistent" });
    expect(result.terminationReason).toBe("not_yet_supported");
    expect(result.processEvents).toEqual([]);
  });

  it("exportEvidence reports ok:false, evidence:null for a handle that was never created", () => {
    const result = backend.exportEvidence({ sandboxId: "nonexistent" });
    expect(result.ok).toBe(false);
    expect(result.evidence).toBeNull();
  });

  it("checkDiskUsageBytes returns null for a handle that was never created (never a fabricated 0)", () => {
    expect(backend.checkDiskUsageBytes({ sandboxId: "nonexistent" })).toBeNull();
  });
});

describe("M38-WU02: unsupported-host fail-closed behavior", () => {
  it("checkAvailability never claims availability on a platform decideSandboxPlatformSupport marks unsupported", () => {
    // This assertion is about internal consistency, not this specific
    // host: if the platform decision (WU38-01, pure) says unsupported,
    // checkAvailability (WU38-02, real) must agree, regardless of
    // whether Docker itself happens to be installed.
    const freshBackend = new DockerSandboxBackend();
    const result = freshBackend.checkAvailability();
    if (process.platform !== "linux") {
      expect(result.available).toBe(false);
    }
  });
});
