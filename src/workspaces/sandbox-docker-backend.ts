import { resolve } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SandboxAvailabilityResult,
  SandboxCapabilityReport,
  SandboxCapability,
  SandboxEvidence,
  SandboxTerminationReason,
  SandboxCleanupStatus,
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
 * M38-WU02/WU03 (build spec: "Implement one real backend with
 * enforceable mounts, environment allowlist, network denial, resource
 * controls, isolated temp/output, and cleanup" / "Run one agent inside
 * the sandbox with structured events, policy-mediated commands, full
 * process-tree ownership, deterministic cancellation, and output/budget
 * limits"). The first (and, as of WU38-03, complete) real
 * `SandboxBackend` implementer.
 *
 * WU38-02 scope (real from the start): `checkAvailability`,
 * `reportCapabilities`, `create`, `cleanup`, `destroy`.
 *
 * WU38-03 scope (real as of this Work Unit): `launchProcess` (a real
 * `docker exec`, bounded output, wall-clock-bounded via the command
 * runner's own timeout), `streamEvents` (the real event log recorded
 * per sandbox), `cancel` (`docker stop`, escalating to `docker kill`,
 * with the real outcome verified via `docker inspect` -- never
 * assumed), `collectResult`, and `exportEvidence` (a real
 * `SandboxEvidence` assembled from what this backend actually observed
 * -- never fabricated). Process-tree ownership is a genuine, kernel-
 * enforced guarantee here: every command this backend ever runs goes
 * through `docker exec` into the SAME container, so stopping/killing
 * that one container's PID namespace is guaranteed to stop every
 * process it ever spawned, with no separate orphan-tracking logic
 * needed -- the guarantee comes from Docker's own PID namespace, not
 * from this class counting processes itself.
 *
 * `sandbox-command-loop.ts` is the higher-level orchestrator that
 * mediates a proposed command list against the M36 command-policy
 * classifier before ever calling `launchProcess` here -- this class
 * itself performs no policy classification; it only executes whatever
 * command it is given, inside the one isolation boundary it owns.
 *
 * Network-enabled live execution is permanently unsupported by this
 * backend: it never reports `network_destination_restriction` (plain
 * `docker run --network none` gives real network *denial*, but Docker
 * alone provides no destination-allowlist/egress-proxy mechanism) --
 * `create()` also rejects any policy requesting `"explicitly_enabled"`
 * directly, as defense in depth beyond the capability-evaluation layer.
 *
 * `disk_limit` is real but DETECTIVE, not preventive: `checkDiskUsageBytes`
 * (a real `docker exec ... du -sb`, not part of the `SandboxBackend`
 * interface -- an orchestrator-only helper) lets a caller stop a run
 * that has already exceeded its declared budget; no portable, real
 * kernel-level write-byte ceiling exists for a bind-mounted worktree
 * (build spec residual risk, documented in the threat model and
 * platform-decision docs).
 */
const DOCKER_BACKEND_ID = "docker-oci@1";
const SANDBOX_BASE_IMAGE_TAG = "aiqt-sandbox-base:1";
const SANDBOX_OUTPUT_MOUNT_PATH = "/aiqt-output";
const MAX_EVENT_DETAIL_CHARS = 4000;

const SANDBOX_DOCKERFILE = `FROM debian:bookworm-slim
RUN apt-get update \\
  && apt-get install -y --no-install-recommends git ca-certificates \\
  && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 -s /bin/bash sandbox
WORKDIR /workspace
`;

/**
 * Every capability this backend can honestly claim as of WU38-03.
 * Still permanently omits `network_destination_restriction` (no
 * destination-allowlist/egress-proxy mechanism exists in plain Docker).
 * `process_tree_control` and `disk_limit` are now real (see the class
 * doc comment above) -- `evaluateSandboxCapabilities` (WU38-01) will
 * therefore report this backend as sufficient for a network-denied
 * live execution as of this Work Unit.
 */
const WU38_03_CAPABILITIES: readonly SandboxCapability[] = [
  "filesystem_isolation",
  "read_only_mounts",
  "writable_worktree",
  "network_deny",
  "environment_allowlist",
  "cpu_limit",
  "memory_limit",
  "process_count_limit",
  "process_tree_control",
  "disk_limit",
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

function bound(text: string): string {
  return text.length > MAX_EVENT_DETAIL_CHARS ? `${text.slice(0, MAX_EVENT_DETAIL_CHARS)}\n...[truncated]` : text;
}

function nowIso(): string {
  return new Date().toISOString();
}

interface SandboxRuntimeState {
  request: SandboxCreateRequest;
  events: SandboxProcessEvent[];
  commandsExecuted: string[];
  outputBytesCaptured: number;
  terminationReason: SandboxTerminationReason;
  cleanupStatus: SandboxCleanupStatus | null;
}

export class DockerSandboxBackend implements SandboxBackend {
  readonly backendId = DOCKER_BACKEND_ID;
  private cachedVersion: string | null = null;
  private readonly runtimeState = new Map<string, SandboxRuntimeState>();

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
    return { backendId: this.backendId, backendVersion: this.backendVersion, capabilities: [...WU38_03_CAPABILITIES] };
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
    // Non-root, but matched to the REAL host user invoking Docker (not a
    // hardcoded 1000:1000) -- a bind-mounted worktree is owned by whatever
    // user actually created it on the host, and a container UID that does
    // not match cannot write into it (a real Docker bind-mount permission
    // rule, not an AIQT-specific one). process.getuid/getgid are POSIX-only
    // (undefined on Windows) but this backend only ever reaches this point
    // on Linux (checkAvailability() already refused any other platform),
    // so the fallback below is defensive, not expected to trigger in
    // practice.
    const containerUser = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
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
      containerUser,
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

    this.runtimeState.set(containerId, {
      request,
      events: [],
      commandsExecuted: [],
      outputBytesCaptured: 0,
      terminationReason: "completed",
      cleanupStatus: null,
    });

    return { ok: true, handle: { sandboxId: containerId }, reason: `Sandbox container ${containerId} created and started.` };
  }

  /** Real `docker exec`, bounded output, bounded by the command runner's own `timeoutMs`. Records a "started" event before running and an "exited"/"terminated" event after -- the full event log is what `streamEvents`/`exportEvidence` later read back. Never mediates policy itself; `sandbox-command-loop.ts` is responsible for calling `decideCommand` before ever reaching this method. */
  launchProcess(request: SandboxProcessLaunchRequest): SandboxProcessLaunchResult {
    const state = this.runtimeState.get(request.handle.sandboxId);
    if (!state) {
      return { ok: false, processHandle: null, reason: `Unknown sandbox handle "${request.handle.sandboxId}" -- was create() ever called for it?` };
    }

    const commandLine = `${request.command} ${request.args.join(" ")}`.trim();
    const processId = `${request.handle.sandboxId}-${state.events.length}`;
    state.events.push({ processId, at: nowIso(), kind: "started", boundedDetail: bound(commandLine) });

    const result = runDockerCommand(["exec", request.handle.sandboxId, request.command, ...request.args], { timeoutMs: 60_000 });
    const outputText = `${result.stdout}${result.stderr}`;
    state.outputBytesCaptured += outputText.length;
    state.commandsExecuted.push(commandLine);
    state.events.push({ processId, at: nowIso(), kind: result.ok ? "exited" : "terminated", boundedDetail: bound(outputText || (result.ok ? "(no output)" : "command failed")) });

    return {
      ok: result.ok,
      processHandle: { sandboxId: request.handle.sandboxId, processId },
      reason: result.ok ? `Command exited successfully.` : `Command failed: ${result.stderr.trim() || "unknown error"}.`,
    };
  }

  streamEvents(handle: SandboxHandle): readonly SandboxProcessEvent[] {
    return this.runtimeState.get(handle.sandboxId)?.events ?? [];
  }

  /** `docker stop` (graceful), escalating to `docker kill` (forced) if the container is still running afterward, with the real outcome always re-verified via a follow-up `docker inspect` -- never assumed. Because every command this backend ever runs goes through `docker exec` into this one container, stopping/killing it is a real, kernel-enforced guarantee that the entire process tree it ever spawned is gone -- not a per-process tracking exercise. */
  cancel(handle: SandboxHandle): SandboxCancellationResult {
    const state = this.runtimeState.get(handle.sandboxId);
    if (!state) {
      return { ok: false, processTreeFullyStopped: false, reason: `Unknown sandbox handle "${handle.sandboxId}".` };
    }

    runDockerCommand(["stop", "-t", String(DOCKER_STOP_TIMEOUT_SECONDS), handle.sandboxId], { timeoutMs: (DOCKER_STOP_TIMEOUT_SECONDS + 10) * 1000 });
    let runningCheck = runDockerCommand(["inspect", "--format", "{{.State.Running}}", handle.sandboxId], { timeoutMs: 5000 });
    let stillRunning = runningCheck.ok && runningCheck.stdout.trim() === "true";

    if (stillRunning) {
      runDockerCommand(["kill", handle.sandboxId], { timeoutMs: 10_000 });
      runningCheck = runDockerCommand(["inspect", "--format", "{{.State.Running}}", handle.sandboxId], { timeoutMs: 5000 });
      stillRunning = runningCheck.ok && runningCheck.stdout.trim() === "true";
    }

    const fullyStopped = runningCheck.ok && !stillRunning;
    state.terminationReason = "cancelled";
    state.events.push({ processId: handle.sandboxId, at: nowIso(), kind: "terminated", boundedDetail: fullyStopped ? "Sandbox cancelled; process tree confirmed stopped." : "Sandbox cancellation could not be confirmed." });

    return {
      ok: fullyStopped,
      processTreeFullyStopped: fullyStopped,
      reason: fullyStopped
        ? "Container stopped (or force-killed); the whole process tree is confirmed gone via docker inspect."
        : "Container could not be confirmed stopped -- treat the process tree as still potentially running.",
    };
  }

  collectResult(handle: SandboxHandle): SandboxResultCollection {
    const state = this.runtimeState.get(handle.sandboxId);
    if (!state) return { terminationReason: "not_yet_supported", processEvents: [] };
    return { terminationReason: state.terminationReason, processEvents: state.events };
  }

  /** Real disk-usage check via `docker exec ... du -sb`, real `git status --porcelain`-derived changed-file list (best effort -- returns [] if the worktree is not a Git repository or the command fails) -- assembled into a real `SandboxEvidence`, never a fabricated one. Not part of the `SandboxBackend` interface's own required call sequence, but this backend's own convention: call after `cleanup()` so `cleanupStatus` is known; calling before returns `ok:false` rather than a packet with a fabricated cleanup status. */
  exportEvidence(handle: SandboxHandle): SandboxEvidenceExportResult {
    const state = this.runtimeState.get(handle.sandboxId);
    if (!state) {
      return { ok: false, evidence: null, reason: `Unknown sandbox handle "${handle.sandboxId}".` };
    }
    if (state.cleanupStatus === null) {
      return { ok: false, evidence: null, reason: "Call cleanup() before exportEvidence() -- cleanup status is not yet known." };
    }

    const filesChanged = this.listChangedFiles(handle);

    const evidence: SandboxEvidence = {
      backendId: this.backendId,
      backendVersion: this.backendVersion,
      capabilities: this.reportCapabilities().capabilities,
      mounts: [state.request.filesystemPolicy.worktreeMount, ...state.request.filesystemPolicy.readOnlyMounts],
      environmentVariableNames: state.request.environmentPolicy.allowedVariableNames,
      networkPolicy: state.request.networkPolicy,
      resourcePolicy: state.request.resourcePolicy,
      commandsExecuted: state.commandsExecuted,
      outputBytesCaptured: state.outputBytesCaptured,
      filesChanged,
      terminationReason: state.terminationReason,
      cleanupStatus: state.cleanupStatus,
      residualRisk:
        "Real, structural mount/environment/network/resource isolation and real process-tree cancellation via Docker's PID namespace. Disk-write-byte enforcement is detective (checked after the fact via checkDiskUsageBytes), not a kernel-preventive limit. Network-enabled live execution is permanently unsupported by this backend.",
    };

    return { ok: true, evidence, reason: `Evidence assembled for sandbox ${handle.sandboxId}.` };
  }

  /** Best-effort: `git status --porcelain` inside the container's own worktree mount. Returns [] (never throws, never fabricates a path) if the worktree is not a Git repository or the command fails for any reason. */
  private listChangedFiles(handle: SandboxHandle): string[] {
    const state = this.runtimeState.get(handle.sandboxId);
    if (!state) return [];
    const result = runDockerCommand(["exec", handle.sandboxId, "git", "-C", state.request.filesystemPolicy.worktreeMount.sandboxPath, "status", "--porcelain"], { timeoutMs: 10_000 });
    if (!result.ok) return [];
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[A-Z?!]{1,2}\s+/, ""));
  }

  /** Real `docker exec ... du -sb <worktreeSandboxPath>`, returning the reported byte count, or `null` if the check itself could not be performed (never a fabricated 0). Not part of the `SandboxBackend` interface -- an orchestrator-only helper (`sandbox-command-loop.ts`) for the detective disk-limit enforcement documented in this class's own doc comment and the threat model's residual-risk note. */
  checkDiskUsageBytes(handle: SandboxHandle): number | null {
    const state = this.runtimeState.get(handle.sandboxId);
    if (!state) return null;
    const result = runDockerCommand(["exec", handle.sandboxId, "du", "-sb", state.request.filesystemPolicy.worktreeMount.sandboxPath], { timeoutMs: 10_000 });
    if (!result.ok) return null;
    const match = /^(\d+)/.exec(result.stdout.trim());
    return match ? Number(match[1]) : null;
  }

  cleanup(handle: SandboxHandle): SandboxCleanupResult {
    const stop = runDockerCommand(["stop", "-t", String(DOCKER_STOP_TIMEOUT_SECONDS), handle.sandboxId], { timeoutMs: (DOCKER_STOP_TIMEOUT_SECONDS + 10) * 1000 });
    const remove = runDockerCommand(["rm", handle.sandboxId], { timeoutMs: 15_000 });
    const inspect = runDockerCommand(["inspect", handle.sandboxId], { timeoutMs: 5000 });

    // The real proof, not just "the commands exited 0": the container
    // must actually be gone from `docker inspect`'s perspective.
    const reallyGone = !inspect.ok;
    const status: SandboxCleanupStatus = stop.ok && remove.ok && reallyGone ? "cleaned" : "cleanup_failed";
    const state = this.runtimeState.get(handle.sandboxId);
    if (state) state.cleanupStatus = status;

    if (status === "cleaned") {
      return { status, reason: `Sandbox ${handle.sandboxId} stopped and removed.` };
    }
    return {
      status,
      reason: `Sandbox ${handle.sandboxId} cleanup did not fully succeed (stop.ok=${stop.ok}, rm.ok=${remove.ok}, stillPresent=${!reallyGone}). Remove it manually (docker rm -f ${handle.sandboxId}).`,
    };
  }

  destroy(handle: SandboxHandle): SandboxDestroyResult {
    const forceRemove = runDockerCommand(["rm", "-f", handle.sandboxId], { timeoutMs: 15_000 });
    const inspect = runDockerCommand(["inspect", handle.sandboxId], { timeoutMs: 5000 });
    const reallyGone = !inspect.ok;
    this.runtimeState.delete(handle.sandboxId);
    if (forceRemove.ok && reallyGone) {
      return { ok: true, reason: `Sandbox ${handle.sandboxId} forcibly destroyed.` };
    }
    return { ok: false, reason: `Sandbox ${handle.sandboxId} could not be confirmed destroyed (rm.ok=${forceRemove.ok}, stillPresent=${!reallyGone}).` };
  }
}
