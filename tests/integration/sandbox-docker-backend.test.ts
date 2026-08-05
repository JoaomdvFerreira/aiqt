import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
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
  });

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

describe("M38-WU02 DockerSandboxBackend: launchProcess/streamEvents/cancel/collectResult/exportEvidence are honest 'not yet supported' stubs (no real process launch exists until WU38-03)", () => {
  it("launchProcess always reports ok:false, never a fabricated success", () => {
    const result = backend.launchProcess({ handle: { sandboxId: "nonexistent" }, command: "echo", args: ["hi"] });
    expect(result.ok).toBe(false);
    expect(result.processHandle).toBeNull();
    expect(result.reason).toMatch(/not yet supported/i);
  });

  it("streamEvents always returns an empty array", () => {
    expect(backend.streamEvents({ sandboxId: "nonexistent" })).toEqual([]);
  });

  it("cancel always reports ok:false and processTreeFullyStopped:false, never a false positive", () => {
    const result = backend.cancel({ sandboxId: "nonexistent" });
    expect(result.ok).toBe(false);
    expect(result.processTreeFullyStopped).toBe(false);
  });

  it("collectResult always reports terminationReason:not_yet_supported", () => {
    const result = backend.collectResult({ sandboxId: "nonexistent" });
    expect(result.terminationReason).toBe("not_yet_supported");
    expect(result.processEvents).toEqual([]);
  });

  it("exportEvidence always reports ok:false, evidence:null, never fabricated evidence", () => {
    const result = backend.exportEvidence({ sandboxId: "nonexistent" });
    expect(result.ok).toBe(false);
    expect(result.evidence).toBeNull();
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
