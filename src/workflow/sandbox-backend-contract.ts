import type {
  SandboxAvailabilityResult,
  SandboxCapabilityReport,
  SandboxCleanupStatus,
  SandboxEvidence,
  SandboxFilesystemPolicy,
  SandboxEnvironmentPolicy,
  SandboxNetworkPolicy,
  SandboxProcessPolicy,
  SandboxResourcePolicy,
  SandboxTerminationReason,
} from "../schema/sandbox-backend.schema.js";

/**
 * M38-WU01 (build spec Sec 6 "Sandbox backend contract"). A pure,
 * type-only interface -- there is no implementing class anywhere in
 * this repository yet, and none of the methods below are called by any
 * code in this Work Unit. WU38-02 implements the first real backend
 * against this interface; WU38-03 is the first Work Unit that may
 * actually call `launchProcess`.
 *
 * Every method that would identify "where to run a command" takes an
 * opaque `SandboxHandle` (a value returned by `create`), never a bare
 * `cwd`/working-directory string -- build spec Sec 2: "`cwd`, prompt
 * instructions, path-prefix checks, or post-hoc diff inspection are not
 * sandboxing." A backend that could only offer a `cwd` to run inside
 * could not implement this interface at all, by construction.
 */

/** Opaque, backend-assigned identifier for one created sandbox instance. Never a filesystem path -- a real backend's internal representation (a container ID, a namespace handle, etc.) is not exposed here. */
export interface SandboxHandle {
  readonly sandboxId: string;
}

/** Opaque, backend-assigned identifier for one launched process inside a sandbox. */
export interface SandboxProcessHandle {
  readonly sandboxId: string;
  readonly processId: string;
}

export interface SandboxCreateRequest {
  runId: string;
  filesystemPolicy: SandboxFilesystemPolicy;
  environmentPolicy: SandboxEnvironmentPolicy;
  networkPolicy: SandboxNetworkPolicy;
  processPolicy: SandboxProcessPolicy;
  resourcePolicy: SandboxResourcePolicy;
}

export interface SandboxCreateResult {
  ok: boolean;
  handle: SandboxHandle | null;
  reason: string;
}

export interface SandboxProcessLaunchRequest {
  handle: SandboxHandle;
  command: string;
  args: readonly string[];
}

export interface SandboxProcessLaunchResult {
  ok: boolean;
  processHandle: SandboxProcessHandle | null;
  reason: string;
}

/** One discrete lifecycle transition for a launched process -- never a raw, unbounded stdout/stderr stream. Mirrors the M37-WU02 request/import architecture's own "discrete lifecycle transitions" reinterpretation of "structured event streaming." */
export interface SandboxProcessEvent {
  processId: string;
  at: string;
  kind: "started" | "output_chunk" | "exited" | "terminated" | "orphan_detected";
  boundedDetail: string;
}

/** A disk measurement is either a verified byte count or an honest, bounded reason it could not be obtained. */
export type SandboxDiskUsageMeasurement =
  | { status: "measured"; bytes: number }
  | { status: "unavailable"; reason: "unknown_handle" | "measurement_command_failed" | "invalid_measurement_output" };

export interface SandboxCancellationResult {
  ok: boolean;
  /** True only when every process in the sandbox's owned tree was confirmed stopped -- a partial cancellation (e.g. an orphan surviving) must report false, never a false "cancelled". */
  processTreeFullyStopped: boolean;
  reason: string;
}

export interface SandboxResultCollection {
  terminationReason: SandboxTerminationReason;
  processEvents: readonly SandboxProcessEvent[];
}

export interface SandboxEvidenceExportResult {
  ok: boolean;
  evidence: SandboxEvidence | null;
  reason: string;
}

export interface SandboxCleanupResult {
  status: SandboxCleanupStatus;
  reason: string;
}

export interface SandboxDestroyResult {
  ok: boolean;
  reason: string;
}

/**
 * The full backend surface. `checkAvailability`/`reportCapabilities` are
 * always safe to call (read-only inspection, build spec: "availability
 * inspection"); every other method presupposes a prior successful
 * `create` and a capability check that already passed
 * (sandbox-capability-evaluation.ts) -- this interface does not itself
 * enforce that ordering, callers must.
 */
export interface SandboxBackend {
  readonly backendId: string;
  readonly backendVersion: string;

  checkAvailability(): SandboxAvailabilityResult;
  reportCapabilities(): SandboxCapabilityReport;

  create(request: SandboxCreateRequest): SandboxCreateResult;

  launchProcess(request: SandboxProcessLaunchRequest): SandboxProcessLaunchResult;
  streamEvents(handle: SandboxHandle): readonly SandboxProcessEvent[];
  cancel(handle: SandboxHandle, terminationReason?: SandboxTerminationReason): SandboxCancellationResult;
  collectResult(handle: SandboxHandle): SandboxResultCollection;

  exportEvidence(handle: SandboxHandle): SandboxEvidenceExportResult;
  cleanup(handle: SandboxHandle): SandboxCleanupResult;
  destroy(handle: SandboxHandle): SandboxDestroyResult;
}
