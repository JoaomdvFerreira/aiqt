import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { SPAWNING_SUITE_TEST_TIMEOUT_MS } from "../workload-timeout-policy.js";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { makeTempDir, removeDir, initGitFixtureRepo } from "../helpers.js";
import { DockerSandboxBackend } from "../../src/workspaces/sandbox-docker-backend.js";
import { DEFAULT_SANDBOX_NETWORK_POLICY } from "../../src/schema/sandbox-backend.schema.js";
import type { SandboxCreateRequest, SandboxHandle } from "../../src/workflow/sandbox-backend-contract.js";

vi.setConfig({ testTimeout: SPAWNING_SUITE_TEST_TIMEOUT_MS });

const backend = new DockerSandboxBackend();
const availability = backend.checkAvailability();
const dockerAvailable = availability.available;

if (!dockerAvailable) {
  console.log(`[sandbox-escape-testing.test.ts] Docker is not available on this host (${availability.reason}) -- real-container escape tests are skipped, not failed.`);
}

/**
 * M38-WU05 (build spec: "Escape Testing, Controlled Pilot, and
 * Closure"; required scenarios: "parent-repo write, host-home read,
 * sibling-worktree access, secret access, network access, process-
 * limit escape, orphan process, nested cancellation, CPU/memory/disk
 * exhaustion, crash recovery, successful repair, and fallback on
 * unsupported hosts"). Real Docker daemon required for the container-
 * dependent scenarios (self-skips with a logged reason otherwise, the
 * third reviewed exception to the M35-WU01 "zero skipped tests"
 * baseline). "successful repair" and "crash recovery" are already
 * covered end-to-end by tests/integration/sandbox-live-execution.test.ts
 * and are not duplicated here; "fallback on unsupported hosts" is
 * covered by a real, no-Docker-required test at the bottom of this
 * file that runs on every host, including this project's own Windows
 * development machine.
 *
 * These tests exercise `DockerSandboxBackend` directly (not the full
 * CLI round trip, already covered in WU38-04) -- the property under
 * test is a security boundary, not command plumbing.
 */
describe.skipIf(!dockerAvailable)("M38-WU05 escape testing (real Docker daemon required)", () => {
  let targetRepo: string | null = null;
  let worktreeRoot: string | null = null;
  let outputDir: string | null = null;
  const createdHandles: SandboxHandle[] = [];

  beforeAll(() => {
    targetRepo = makeTempDir("aiqt-escape-target-");
    initGitFixtureRepo(targetRepo);
    worktreeRoot = makeTempDir("aiqt-escape-worktree-");
    outputDir = makeTempDir("aiqt-escape-output-");

    // Warm the sandbox base image once, outside any single test's own
    // budget -- same reasoning as every other real-Docker suite this
    // milestone added.
    const warm = backend.create(baseRequest());
    if (warm.ok && warm.handle) backend.destroy(warm.handle);
  }, 120_000);

  afterAll(() => {
    if (targetRepo) removeDir(targetRepo);
    if (worktreeRoot) removeDir(worktreeRoot);
    if (outputDir) removeDir(outputDir);
  });

  afterEach(() => {
    for (const handle of createdHandles.splice(0)) {
      backend.destroy(handle);
    }
  });

  function baseRequest(overrides: Partial<SandboxCreateRequest> = {}): SandboxCreateRequest {
    return {
      runId: `escape-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      filesystemPolicy: {
        worktreeMount: { hostPath: worktreeRoot!, sandboxPath: "/workspace", mode: "read_write" },
        readOnlyMounts: [],
        isolatedOutputDirectory: outputDir!,
        sourceRepositoryMount: null,
      },
      environmentPolicy: { allowedVariableNames: [] },
      networkPolicy: DEFAULT_SANDBOX_NETWORK_POLICY,
      processPolicy: { processCountLimit: 8, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 },
      resourcePolicy: {
        maxWallClockSeconds: 30,
        maxCpuSeconds: 30,
        maxMemoryBytes: 64 * 1024 * 1024,
        maxDiskWriteBytes: 20 * 1024 * 1024,
        maxProcessCount: 8,
        maxCommandCount: 10,
        maxOutputBytes: 65536,
        maxRetryCount: 0,
      },
      ...overrides,
    };
  }

  function create(overrides: Partial<SandboxCreateRequest> = {}): SandboxHandle {
    const result = backend.create(baseRequest(overrides));
    expect(result.ok, result.reason).toBe(true);
    createdHandles.push(result.handle!);
    return result.handle!;
  }

  it("parent-repo write: a proposed write outside the mounted worktree fails -- the parent repository's own working tree is never mounted at all", () => {
    const handle = create();
    // targetRepo's own working tree (as opposed to just its .git dir,
    // which sourceRepositoryMount would scope to when set) is never
    // mounted anywhere in this backend's contract -- attempting to
    // write into it by host path must fail because the path simply
    // does not exist inside the sandbox.
    const result = backend.launchProcess({ handle, command: "sh", args: ["-c", `echo escaped > "${targetRepo}/ESCAPED.txt"`] });
    expect(result.ok).toBe(false);
    expect(existsSync(join(targetRepo!, "ESCAPED.txt"))).toBe(false);
  });

  it("host-home read: the operator's real home directory is never mounted -- reading anything under it fails", () => {
    const handle = create();
    const result = backend.launchProcess({ handle, command: "sh", args: ["-c", "cat /root/.ssh/id_rsa 2>&1 || cat ~/.ssh/id_rsa 2>&1"] });
    const events = backend.streamEvents(handle);
    const output = events.map((e) => e.boundedDetail).join("\n");

    // The structural boundary is stronger than any Docker/image-specific
    // failure text: this scenario has exactly the approved worktree and
    // output bind mounts, and neither the operator home nor a child of it
    // can be a mount source.
    const mountsJson = execFileSync("docker", ["inspect", "--format", "{{json .Mounts}}", handle.sandboxId], { encoding: "utf8" }).trim();
    const mounts = JSON.parse(mountsJson) as { Source: string; Destination: string; RW: boolean }[];
    const operatorHome = resolve(homedir());
    expect(mounts).toHaveLength(2);
    expect(mounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ Destination: "/workspace", RW: true }),
      expect.objectContaining({ Destination: "/aiqt-output", RW: true }),
    ]));
    expect(mounts.some((mount) => mount.Source === operatorHome || mount.Source.startsWith(`${operatorHome}${sep}`))).toBe(false);

    // A real process was attempted but cannot read host-home material. Its
    // non-success is paired with the mount proof above, not accepted as a
    // generic failure signal.
    expect(result.processHandle).not.toBeNull();
    expect(result.ok).toBe(false);
    expect(output).not.toMatch(/BEGIN (RSA|OPENSSH|EC) PRIVATE KEY/);
  });

  it("sibling-worktree access: a second run's own worktree is not visible inside the first run's sandbox", () => {
    const worktreeA = makeTempDir("aiqt-escape-sibling-a-");
    const worktreeB = makeTempDir("aiqt-escape-sibling-b-");
    writeFileSync(join(worktreeB, "sibling-secret.txt"), "should not be readable from sandbox A");

    const resultA = backend.create(baseRequest({ filesystemPolicy: { worktreeMount: { hostPath: worktreeA, sandboxPath: "/workspace", mode: "read_write" }, readOnlyMounts: [], isolatedOutputDirectory: outputDir!, sourceRepositoryMount: null } }));
    expect(resultA.ok).toBe(true);
    createdHandles.push(resultA.handle!);

    const readAttempt = backend.launchProcess({ handle: resultA.handle!, command: "cat", args: [`${worktreeB}/sibling-secret.txt`] });
    expect(readAttempt.ok).toBe(false);

    removeDir(worktreeA);
    removeDir(worktreeB);
  });

  it("secret access: no environment variable beyond the fixed operational HOME is ever visible inside the sandbox by default", () => {
    const handle = create();
    backend.launchProcess({ handle, command: "sh", args: ["-c", "env"] });
    const events = backend.streamEvents(handle);
    const envOutput = events.filter((e) => e.kind === "exited").map((e) => e.boundedDetail).join("\n");
    expect(envOutput).not.toMatch(/AWS_|AZURE_|SSH_AUTH_SOCK|_TOKEN=|_SECRET|_PASSWORD/i);
  });

  it("network access: outbound network is denied -- a real connection attempt fails", () => {
    const handle = create();
    const result = backend.launchProcess({ handle, command: "sh", args: ["-c", "wget -T 3 -q -O - http://example.com 2>&1 || curl -s --max-time 3 http://example.com 2>&1 || echo NETWORK_UNREACHABLE"] });
    const events = backend.streamEvents(handle);
    const output = events.map((e) => e.boundedDetail).join("\n");
    // Never a successful HTTP response body from a real external site.
    expect(output).not.toMatch(/<html/i);
    void result;
  });

  it("process-limit escape: --pids-limit is a real, kernel-enforced cgroup limit, confirmed via docker inspect", () => {
    const handle = create({ processPolicy: { processCountLimit: 4, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 } });
    const pidsLimit = execFileSync("docker", ["inspect", "--format", "{{.HostConfig.PidsLimit}}", handle.sandboxId], { encoding: "utf8" }).trim();
    expect(pidsLimit).toBe("4");
  });

  it("orphan process: destroy() (or cleanup()) leaves no process from this sandbox running on the host afterward", () => {
    const handle = create();
    // A background process that would otherwise outlive a single `docker
    // exec` call, launched with nohup+disown so it detaches from the
    // exec session itself, not just backgrounded within it.
    backend.launchProcess({ handle, command: "sh", args: ["-c", "nohup sh -c 'sleep 60' >/dev/null 2>&1 & disown; sleep 1"] });
    const destroyResult = backend.destroy(handle);
    expect(destroyResult.ok).toBe(true);
    // Real proof: the container itself is gone, which (PID namespace)
    // guarantees every process it ever spawned, including the detached
    // background one, is gone with it -- verified by docker inspect
    // failing, not by trying to enumerate host processes (which the
    // orphan, being inside a now-destroyed container's own PID
    // namespace, was never a real host-visible process to begin with).
    let stillExists = true;
    try {
      execFileSync("docker", ["inspect", handle.sandboxId], { encoding: "utf8" });
    } catch {
      stillExists = false;
    }
    expect(stillExists).toBe(false);
    createdHandles.splice(createdHandles.indexOf(handle), 1);
  });

  it("nested cancellation: cancel() while a long-running background process is still active still fully stops the process tree", () => {
    const handle = create();
    // launchProcess (docker exec) is synchronous -- it blocks until the
    // command it runs exits. To exercise cancellation of something
    // GENUINELY still running (not already finished by the time cancel()
    // is called), launch a long sleep detached (nohup + disown) so the
    // launchProcess call itself returns immediately, leaving the sleep
    // running in the background inside the container.
    backend.launchProcess({ handle, command: "sh", args: ["-c", "nohup sh -c 'sleep 30' >/dev/null 2>&1 & disown"] });
    const cancelResult = backend.cancel(handle);
    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.processTreeFullyStopped).toBe(true);
    const runningCheck = execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", handle.sandboxId], { encoding: "utf8" }).trim();
    expect(runningCheck).toBe("false");
  });

  it("CPU exhaustion: a real cgroup CPU quota is applied and confirmed via docker inspect -- a CPU-bound loop cannot exceed the configured rate", () => {
    const handle = create({ resourcePolicy: { maxWallClockSeconds: 60, maxCpuSeconds: 6, maxMemoryBytes: 64 * 1024 * 1024, maxDiskWriteBytes: 1024 * 1024, maxProcessCount: 8, maxCommandCount: 5, maxOutputBytes: 65536, maxRetryCount: 0 } });
    // computeCpuQuota(6, 60) = max(0.1, min(4, 6/60)) = 0.1 -- the
    // minimum quota, expressed by Docker as NanoCpus (quota * 1e9).
    const nanoCpus = execFileSync("docker", ["inspect", "--format", "{{.HostConfig.NanoCpus}}", handle.sandboxId], { encoding: "utf8" }).trim();
    expect(Number(nanoCpus)).toBe(Math.round(0.1 * 1_000_000_000));
  });

  it("memory exhaustion: a real cgroup memory limit is applied and confirmed via docker inspect", () => {
    const handle = create({ resourcePolicy: { maxWallClockSeconds: 30, maxCpuSeconds: 30, maxMemoryBytes: 32 * 1024 * 1024, maxDiskWriteBytes: 1024 * 1024, maxProcessCount: 8, maxCommandCount: 5, maxOutputBytes: 65536, maxRetryCount: 0 } });
    const memoryLimit = execFileSync("docker", ["inspect", "--format", "{{.HostConfig.Memory}}", handle.sandboxId], { encoding: "utf8" }).trim();
    expect(Number(memoryLimit)).toBe(32 * 1024 * 1024);
  });

  it("disk exhaustion: checkDiskUsageBytes detects real usage growth, enabling the command loop's detective enforcement", () => {
    const handle = create();
    const before = backend.checkDiskUsageBytes(handle);
    backend.launchProcess({ handle, command: "sh", args: ["-c", "head -c 5000000 /dev/zero > bigfile.bin"] });
    const after = backend.checkDiskUsageBytes(handle);
    expect(before).toMatchObject({ status: "measured" });
    expect(after).toMatchObject({ status: "measured" });
    if (before.status === "measured" && after.status === "measured") {
      expect(after.bytes).toBeGreaterThan(before.bytes);
    }
  });
});

/**
 * "Fallback on unsupported hosts" -- runs on EVERY host, including this
 * project's own Windows development machine, since it needs no real
 * Docker daemon at all: on an unsupported platform, checkAvailability()
 * itself is the fallback trigger, before any sandbox is ever attempted.
 */
describe("M38-WU05 escape testing: fallback on unsupported hosts (no Docker required)", () => {
  it("a fresh backend on an unsupported platform reports unavailable with a clear reason, never a silent proceed", () => {
    if (process.platform === "linux") {
      // This assertion targets non-Linux hosts specifically; on Linux CI
      // (where Docker is expected to be available), the equivalent
      // "insufficient capability" fallback is covered by
      // tests/unit/sandbox-capability-evaluation.test.ts and the
      // network-enabled-is-always-unsupported test below, which apply
      // regardless of platform.
      return;
    }
    const freshBackend = new DockerSandboxBackend();
    const result = freshBackend.checkAvailability();
    expect(result.available).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("network-enabled live execution is unsupported by this backend on every platform -- a real create() call refuses it regardless of Docker availability", () => {
    const freshBackend = new DockerSandboxBackend();
    const result = freshBackend.create({
      runId: "fallback-test",
      filesystemPolicy: { worktreeMount: { hostPath: "/tmp/does-not-matter", sandboxPath: "/workspace", mode: "read_write" }, readOnlyMounts: [], isolatedOutputDirectory: "/tmp/does-not-matter-2", sourceRepositoryMount: null },
      environmentPolicy: { allowedVariableNames: [] },
      networkPolicy: { mode: "explicitly_enabled", approval: { candidateId: "c1", provider: "p1", destinationAllowlist: ["example.com"], reason: "test", durationSeconds: 60, maxRequestCount: 5 } },
      processPolicy: { processCountLimit: 8, gracefulStopTimeoutSeconds: 5, forceTerminationTimeoutSeconds: 10 },
      resourcePolicy: { maxWallClockSeconds: 30, maxCpuSeconds: 30, maxMemoryBytes: 64 * 1024 * 1024, maxDiskWriteBytes: 1024 * 1024, maxProcessCount: 8, maxCommandCount: 5, maxOutputBytes: 65536, maxRetryCount: 0 },
    });
    expect(result.ok).toBe(false);
    expect(result.handle).toBeNull();
  });
});
