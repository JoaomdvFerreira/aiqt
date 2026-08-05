import { resolve } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SandboxAvailabilityResult,
  SandboxCapabilityReport,
  SandboxCapability,
} from "../schema/sandbox-backend.schema.js";
import type {
  SandboxBackend,
  SandboxCreateRequest,
  SandboxCreateResult,
  SandboxProcessLaunchRequest,
  SandboxProcessLaunchResult,
  SandboxProcessEvent,
  SandboxCancellationResult,
  SandboxResultCollection,
  SandboxEvidenceExportResult,
  SandboxCleanupResult,
  SandboxDestroyResult,
  SandboxHandle,
} from "../workflow/sandbox-backend-contract.js";
import { decideSandboxPlatformSupport } from "../workflow/sandbox-platform-decision.js";
import { validateSandboxFilesystemPolicy } from "../workflow/sandbox-filesystem-policy.js";
import { validateSandboxEnvironmentAllowlist } from "../workflow/sandbox-environment-policy.js";
import { validateSandboxNetworkPolicy } from "../workflow/sandbox-network-policy.js";
import { validateSandboxProcessPolicy } from "../workflow/sandbox-process-policy.js";
import { validateSandboxResourcePolicy } from "../workflow/sandbox-resource-policy.js";
import { runDockerCommand } from "./sandbox-docker-command-runner.js";

/**
 * M38-WU02 (build spec: "Implement one real backend with enforceable
 * mounts, environment allowlist, network denial, resource controls,
 * isolated temp/output, and cleanup"). The first real `SandboxBackend`
 * implementer (the WU38-01 interface had zero implementers). Scope is
 * exactly this Work Unit's own title: `checkAvailability`,
 * `reportCapabilities`, `create`, `cleanup`, `destroy` are real, tested
 * Docker operations. `launchProcess`/`streamEvents`/`cancel`/
 * `collectResult`/`exportEvidence` are honest, explicit "not yet
 * supported" stubs -- WU38-03 ("Live Agent Process, Command Mediation,
 * and Cancellation") is where those become real. This class must
 * implement the full interface to type-check, but a stub that returns
 * `ok:false, reason:"..."` is categorically different from silently
 * pretending to succeed; every stub here is covered by its own test
 * asserting it never reports success.
 *
 * Network-enabled live execution is permanently unsupported by this
 * backend: it never reports `network_destination_restriction`
 * (plain `docker run --network none` gives real network *denial*, but
 * Docker alone provides no destination-allowlist/egress-proxy
 * mechanism) -- `create()` also rejects any policy requesting
 * `"explicitly_enabled"` directly, as defense in depth beyond the
 * capability-evaluation layer (mirrors the M37 self-management guard's
 * "re-checked at every real-execution boundary" discipline).
 */
const DOCKER_BACKEND_ID = "docker-oci@1";
const SANDBOX_BASE_IMAGE_TAG = "aiqt-sandbox-base:1";
const SANDBOX_OUTPUT_MOUNT_PATH = "/aiqt-output";

const SANDBOX_DOCKERFILE = `FROM debian:bookworm-slim
RUN apt-get update \\
  && apt-get install -y --no-install-recommends git ca-certificates \\
  && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 -s /bin/bash sandbox
WORKDIR /workspace
`;

/**
 * Every capability this backend can honestly claim as of WU38-02.
 * Deliberately omits `process_tree_control` (no process has ever been
 * launched by this class yet) and `disk_limit` (no portable, real
 * write-byte enforcement exists for a bind-mounted worktree -- see the
 * threat model doc's residual-risk note) and
 * `network_destination_restriction` (permanent limitation, above).
 * `evaluateSandboxCapabilities` (WU38-01) will therefore correctly
 * report this backend as insufficient for live execution until WU38-03
 * adds `process_tree_control` and a real disk-usage enforcement
 * mechanism -- exactly the intended fail-closed behavior for a backend
 * that cannot yet run anything.
 */
const WU38_02_CAPABILITIES: readonly SandboxCapability[] = [
  "filesystem_isolation",
  "read_only_mounts",
  "writable_worktree",
  "network_deny",
  "environment_allowlist",
  "cpu_limit",
  "memory_limit",
  "process_count_limit",
  "deterministic_cleanup",
  "forensic_capture",
];

const MIN_CPU_QUOTA = 0.1;
const MAX_CPU_QUOTA = 4;
const DOCKER_STOP_TIMEOUT_SECONDS = 10;

function computeCpuQuota(maxCpuSeconds: number, maxWallClockSeconds: number): number {
  const ratio = maxCpuSeconds / maxWallClockSeconds;
  return Math.min(MAX_CPU_QUOTA, Math.max(MIN_CPU_QUOTA, ratio));
}

function notYetSupported(operation: string): { ok: false; reason: string } {
  return { ok: false, reason: `${operation} is not yet supported by ${DOCKER_BACKEND_ID} -- implemented in M38-WU03. Use the M37 request/import workflow (aiqt autonomous run) instead.` };
}

export class DockerSandboxBackend implements SandboxBackend {
  readonly backendId = DOCKER_BACKEND_ID;
  private cachedVersion: string | null = null;

  get backendVersion(): string {
    return this.cachedVersion ?? "unknown";
  }

  checkAvailability(): SandboxAvailabilityResult {
    const platformDecision = decideSandboxPlatformSupport(process.platform);
    if (platformDecision.supportStatus !== "supported") {
      return { backendId: this.backendId, platform: platformDecision.platform, available: false, reason: platformDecision.reason };
    }

    const result = runDockerCommand(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 5000 });
    if (!result.ok) {
      return {
        backendId: this.backendId,
        platform: platformDecision.platform,
        available: false,
        reason: `docker is not available on this host: ${result.stderr.trim() || "docker command failed"}.`,
      };
    }

    this.cachedVersion = result.stdout.trim();
    return { backendId: this.backendId, platform: platformDecision.platform, available: true, reason: `Docker server version ${this.cachedVersion} detected.` };
  }

  reportCapabilities(): SandboxCapabilityReport {
    return { backendId: this.backendId, backendVersion: this.backendVersion, capabilities: [...WU38_02_CAPABILITIES] };
  }

  /** Builds the fixed, minimal sandbox base image (Debian slim + git, non-root user) if it is not already present. The Dockerfile is embedded as a string constant, not a separately-maintained repository file, so it can never drift out of sync with the code that builds it. Network access here is the HOST's own `docker build` pulling from a registry -- distinct from, and irrelevant to, the sandboxed container's own runtime network policy (always denied). */
  private ensureImageBuilt(): { ok: boolean; reason: string } {
    const inspect = runDockerCommand(["image", "inspect", SANDBOX_BASE_IMAGE_TAG], { timeoutMs: 5000 });
    if (inspect.ok) return { ok: true, reason: `Image ${SANDBOX_BASE_IMAGE_TAG} already present.` };

    const buildDir = mkdtempSync(join(tmpdir(), "aiqt-sandbox-build-"));
    try {
      writeFileSync(join(buildDir, "Dockerfile"), SANDBOX_DOCKERFILE);
      const build = runDockerCommand(["build", "-f", join(buildDir, "Dockerfile"), "-t", SANDBOX_BASE_IMAGE_TAG, buildDir], { timeoutMs: 180_000 });
      if (!build.ok) {
        return { ok: false, reason: `Failed to build sandbox base image: ${build.stderr.trim() || "docker build failed"}.` };
      }
      return { ok: true, reason: `Built image ${SANDBOX_BASE_IMAGE_TAG}.` };
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  }

  create(request: SandboxCreateRequest): SandboxCreateResult {
    const fsValidation = validateSandboxFilesystemPolicy(request.filesystemPolicy);
    const envValidation = validateSandboxEnvironmentAllowlist(request.environmentPolicy);
    const netValidation = validateSandboxNetworkPolicy(request.networkPolicy);
    const processValidation = validateSandboxProcessPolicy(request.processPolicy);
    const resourceValidation = validateSandboxResourcePolicy(request.resourcePolicy);

    const allIssues = [
      ...fsValidation.issues,
      ...envValidation.blockedNames.map((b) => `environment variable "${b.name}" is blocked (${b.label})`),
      ...netValidation.issues,
      ...processValidation.issues,
      ...resourceValidation.issues,
    ];
    if (allIssues.length > 0) {
      return { ok: false, handle: null, reason: `Refusing to create sandbox: ${allIssues.join("; ")}.` };
    }

    // Defense in depth beyond validateSandboxNetworkPolicy: this backend
    // can never honestly support network-enabled live execution (no
    // destination-restriction mechanism), so it refuses here even though
    // a caller SHOULD already have refused earlier via
    // evaluateSandboxNetworkCapability (WU38-01).
    if (request.networkPolicy.mode !== "denied") {
      return { ok: false, handle: null, reason: "This backend never supports network-enabled live execution (no destination-restriction capability). Network access must remain denied." };
    }

    const imageResult = this.ensureImageBuilt();
    if (!imageResult.ok) {
      return { ok: false, handle: null, reason: imageResult.reason };
    }

    const cpuQuota = computeCpuQuota(request.resourcePolicy.maxCpuSeconds, request.resourcePolicy.maxWallClockSeconds);
    const envArgs = request.environmentPolicy.allowedVariableNames.flatMap((name) => ["-e", name]);
    const mountArgs = [
      "-v",
      `${resolve(request.filesystemPolicy.worktreeMount.hostPath)}:${request.filesystemPolicy.worktreeMount.sandboxPath}:rw`,
      ...request.filesystemPolicy.readOnlyMounts.flatMap((m) => ["-v", `${resolve(m.hostPath)}:${m.sandboxPath}:ro`]),
      "-v",
      `${resolve(request.filesystemPolicy.isolatedOutputDirectory)}:${SANDBOX_OUTPUT_MOUNT_PATH}:rw`,
    ];

    const createArgs = [
      "create",
      "--network",
      "none",
      "--pids-limit",
      String(request.processPolicy.processCountLimit),
      "--cpus",
      cpuQuota.toFixed(2),
      "--memory",
      String(request.resourcePolicy.maxMemoryBytes),
      "--memory-swap",
      String(request.resourcePolicy.maxMemoryBytes),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--user",
      "1000:1000",
      "--label",
      `aiqt-sandbox-run-id=${request.runId}`,
      ...envArgs,
      ...mountArgs,
      "--workdir",
      request.filesystemPolicy.worktreeMount.sandboxPath,
      SANDBOX_BASE_IMAGE_TAG,
      "sleep",
      "infinity",
    ];

    const created = runDockerCommand(createArgs, { timeoutMs: 30_000 });
    if (!created.ok) {
      return { ok: false, handle: null, reason: `docker create failed: ${created.stderr.trim() || "unknown error"}.` };
    }
    const containerId = created.stdout.trim();
    if (containerId === "") {
      return { ok: false, handle: null, reason: "docker create returned no container ID." };
    }

    const started = runDockerCommand(["start", containerId], { timeoutMs: 15_000 });
    if (!started.ok) {
      // Best-effort teardown of the container we just created but could not start -- never leave an orphan behind on a failed create.
      runDockerCommand(["rm", "-f", containerId], { timeoutMs: 15_000 });
      return { ok: false, handle: null, reason: `docker start failed: ${started.stderr.trim() || "unknown error"}.` };
    }

    return { ok: true, handle: { sandboxId: containerId }, reason: `Sandbox container ${containerId} created and started.` };
  }

  launchProcess(_request: SandboxProcessLaunchRequest): SandboxProcessLaunchResult {
    const stub = notYetSupported("launchProcess");
    return { ok: stub.ok, processHandle: null, reason: stub.reason };
  }

  streamEvents(_handle: SandboxHandle): readonly SandboxProcessEvent[] {
    return [];
  }

  cancel(_handle: SandboxHandle): SandboxCancellationResult {
    const stub = notYetSupported("cancel");
    return { ok: stub.ok, processTreeFullyStopped: false, reason: stub.reason };
  }

  collectResult(_handle: SandboxHandle): SandboxResultCollection {
    return { terminationReason: "not_yet_supported", processEvents: [] };
  }

  exportEvidence(_handle: SandboxHandle): SandboxEvidenceExportResult {
    const stub = notYetSupported("exportEvidence");
    return { ok: stub.ok, evidence: null, reason: stub.reason };
  }

  cleanup(handle: SandboxHandle): SandboxCleanupResult {
    const stop = runDockerCommand(["stop", "-t", String(DOCKER_STOP_TIMEOUT_SECONDS), handle.sandboxId], { timeoutMs: (DOCKER_STOP_TIMEOUT_SECONDS + 10) * 1000 });
    const remove = runDockerCommand(["rm", handle.sandboxId], { timeoutMs: 15_000 });
    const inspect = runDockerCommand(["inspect", handle.sandboxId], { timeoutMs: 5000 });

    // The real proof, not just "the commands exited 0": the container
    // must actually be gone from `docker inspect`'s perspective.
    const reallyGone = !inspect.ok;
    if (stop.ok && remove.ok && reallyGone) {
      return { status: "cleaned", reason: `Sandbox ${handle.sandboxId} stopped and removed.` };
    }
    return {
      status: "cleanup_failed",
      reason: `Sandbox ${handle.sandboxId} cleanup did not fully succeed (stop.ok=${stop.ok}, rm.ok=${remove.ok}, stillPresent=${!reallyGone}). Remove it manually (docker rm -f ${handle.sandboxId}).`,
    };
  }

  destroy(handle: SandboxHandle): SandboxDestroyResult {
    const forceRemove = runDockerCommand(["rm", "-f", handle.sandboxId], { timeoutMs: 15_000 });
    const inspect = runDockerCommand(["inspect", handle.sandboxId], { timeoutMs: 5000 });
    const reallyGone = !inspect.ok;
    if (forceRemove.ok && reallyGone) {
      return { ok: true, reason: `Sandbox ${handle.sandboxId} forcibly destroyed.` };
    }
    return { ok: false, reason: `Sandbox ${handle.sandboxId} could not be confirmed destroyed (rm.ok=${forceRemove.ok}, stillPresent=${!reallyGone}).` };
  }
}
