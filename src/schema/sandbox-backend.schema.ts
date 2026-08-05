import { z } from "zod";

/**
 * M38-WU01 (build spec: "Sandbox Threat Model, Platform Decision, and
 * Backend Contract"). Contract-only schemas for a future sandboxed
 * live-agent-execution backend -- nothing in this file creates a
 * container, namespace, mount, network interface, or process. Every
 * export here is a data shape or a pure predicate operating on that
 * data, matching the M36-WU01 precedent (src/schema/autonomous-run.schema.ts)
 * for a milestone's first, non-executing Work Unit.
 *
 * Distinct from src/schema/autonomous-run.schema.ts (the M36/M37
 * request/import contract, which remains the permanent lower-risk
 * fallback -- see src/workflow/sandbox-fallback-policy.ts). This file
 * describes the optional, higher-risk *live* execution path M38
 * introduces on top of it, never a replacement for it.
 */

const MAX_BOUNDED_TEXT_CHARS = 4000;
const MAX_BOUNDED_KEY_CHARS = 200;
const MAX_LIST_ITEMS = 100;

// ---------------------------------------------------------------------------
// Platform / backend identity
// ---------------------------------------------------------------------------

/** Mirrors Node's own `NodeJS.Platform` values relevant to this decision -- not the full list, only the ones this milestone's platform decision distinguishes between. */
export const SandboxHostPlatformSchema = z.enum(["linux", "darwin", "win32", "other"]);
export type SandboxHostPlatform = z.infer<typeof SandboxHostPlatformSchema>;

export const SandboxSupportStatusSchema = z.enum(["supported", "unsupported"]);
export type SandboxSupportStatus = z.infer<typeof SandboxSupportStatusSchema>;

/** Isolation primitives a backend may claim. `none` is never a valid claim for a `"supported"` platform decision -- it exists only so an unsupported-host decision has a well-typed value to carry. */
export const SandboxIsolationPrimitiveSchema = z.enum(["oci_container", "linux_namespace", "none"]);
export type SandboxIsolationPrimitive = z.infer<typeof SandboxIsolationPrimitiveSchema>;

export const SandboxBackendIdSchema = z.string().min(1).max(MAX_BOUNDED_KEY_CHARS);

// ---------------------------------------------------------------------------
// Capability model (build spec Sec 6 "Capability model")
// ---------------------------------------------------------------------------

export const SandboxCapabilitySchema = z.enum([
  "filesystem_isolation",
  "read_only_mounts",
  "writable_worktree",
  "network_deny",
  "network_destination_restriction",
  "environment_allowlist",
  "process_tree_control",
  "cpu_limit",
  "memory_limit",
  "disk_limit",
  "process_count_limit",
  "deterministic_cleanup",
  "forensic_capture",
]);
export type SandboxCapability = z.infer<typeof SandboxCapabilitySchema>;

/**
 * Every capability a live agent process requires before it may run at
 * all (build spec Sec 2 core invariant: "No live agent process runs
 * unless the backend can enforce filesystem, process, network,
 * resource, and environment boundaries"). `network_destination_restriction`
 * is deliberately excluded -- it is only required when network access is
 * explicitly enabled for a given run (build spec Sec 6 "Network policy"),
 * not for a network-denied run, so it cannot be an unconditional minimum.
 */
export const MINIMUM_REQUIRED_SANDBOX_CAPABILITIES: ReadonlySet<SandboxCapability> = new Set([
  "filesystem_isolation",
  "read_only_mounts",
  "writable_worktree",
  "network_deny",
  "environment_allowlist",
  "process_tree_control",
  "cpu_limit",
  "memory_limit",
  "disk_limit",
  "process_count_limit",
  "deterministic_cleanup",
  "forensic_capture",
]);

export const SandboxCapabilityReportSchema = z
  .object({
    backendId: SandboxBackendIdSchema,
    backendVersion: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    capabilities: z.array(SandboxCapabilitySchema).max(MAX_LIST_ITEMS),
  })
  .strict();
export type SandboxCapabilityReport = z.infer<typeof SandboxCapabilityReportSchema>;

export const SandboxAvailabilityResultSchema = z
  .object({
    backendId: SandboxBackendIdSchema,
    platform: SandboxHostPlatformSchema,
    available: z.boolean(),
    reason: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  })
  .strict();
export type SandboxAvailabilityResult = z.infer<typeof SandboxAvailabilityResultSchema>;

// ---------------------------------------------------------------------------
// Filesystem policy (build spec Sec 6 "Filesystem policy")
// ---------------------------------------------------------------------------

export const SandboxMountModeSchema = z.enum(["read_only", "read_write"]);
export type SandboxMountMode = z.infer<typeof SandboxMountModeSchema>;

export const SandboxMountSchema = z
  .object({
    hostPath: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    sandboxPath: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    mode: SandboxMountModeSchema,
  })
  .strict();
export type SandboxMount = z.infer<typeof SandboxMountSchema>;

export const SandboxFilesystemPolicySchema = z
  .object({
    worktreeMount: SandboxMountSchema,
    readOnlyMounts: z.array(SandboxMountSchema).max(MAX_LIST_ITEMS).default([]),
    isolatedOutputDirectory: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  })
  .strict();
export type SandboxFilesystemPolicy = z.infer<typeof SandboxFilesystemPolicySchema>;

// ---------------------------------------------------------------------------
// Network policy (build spec Sec 6 "Network policy")
// ---------------------------------------------------------------------------

export const SandboxNetworkModeSchema = z.enum(["denied", "explicitly_enabled"]);
export type SandboxNetworkMode = z.infer<typeof SandboxNetworkModeSchema>;

export const SandboxNetworkApprovalSchema = z
  .object({
    candidateId: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    provider: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    /** Non-empty allowlist of destinations the sandbox must be able to enforce. An empty/unenforceable list makes network-enabled live execution unsupported -- see sandbox-network-policy.ts. */
    destinationAllowlist: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    reason: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
    durationSeconds: z.number().int().positive(),
    maxRequestCount: z.number().int().positive(),
  })
  .strict();
export type SandboxNetworkApproval = z.infer<typeof SandboxNetworkApprovalSchema>;

export const SandboxNetworkPolicySchema = z
  .object({
    mode: SandboxNetworkModeSchema,
    approval: SandboxNetworkApprovalSchema.nullable(),
  })
  .strict();
export type SandboxNetworkPolicy = z.infer<typeof SandboxNetworkPolicySchema>;

export const DEFAULT_SANDBOX_NETWORK_POLICY: SandboxNetworkPolicy = { mode: "denied", approval: null };

// ---------------------------------------------------------------------------
// Environment policy (build spec Sec 6 "Environment policy")
// ---------------------------------------------------------------------------

export const SandboxEnvironmentPolicySchema = z
  .object({
    /** Explicit allowlist of variable NAMES to project into the sandbox. Never a wholesale host-environment inheritance flag -- there is deliberately no such field in this schema. */
    allowedVariableNames: z.array(z.string().min(1).max(MAX_BOUNDED_KEY_CHARS)).max(MAX_LIST_ITEMS).default([]),
  })
  .strict();
export type SandboxEnvironmentPolicy = z.infer<typeof SandboxEnvironmentPolicySchema>;

export const DEFAULT_SANDBOX_ENVIRONMENT_POLICY: SandboxEnvironmentPolicy = { allowedVariableNames: [] };

// ---------------------------------------------------------------------------
// Process policy (build spec Sec 6 "Process policy")
// ---------------------------------------------------------------------------

export const SandboxProcessPolicySchema = z
  .object({
    processCountLimit: z.number().int().positive(),
    gracefulStopTimeoutSeconds: z.number().int().positive(),
    forceTerminationTimeoutSeconds: z.number().int().positive(),
  })
  .strict();
export type SandboxProcessPolicy = z.infer<typeof SandboxProcessPolicySchema>;

// ---------------------------------------------------------------------------
// Resource policy (build spec Sec 6 "Resource policy")
// ---------------------------------------------------------------------------

export const SandboxResourcePolicySchema = z
  .object({
    maxWallClockSeconds: z.number().int().positive(),
    maxCpuSeconds: z.number().int().positive(),
    maxMemoryBytes: z.number().int().positive(),
    maxDiskWriteBytes: z.number().int().positive(),
    maxProcessCount: z.number().int().positive(),
    maxCommandCount: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    maxRetryCount: z.number().int().nonnegative(),
  })
  .strict();
export type SandboxResourcePolicy = z.infer<typeof SandboxResourcePolicySchema>;

// ---------------------------------------------------------------------------
// Process lifecycle / termination (referenced by the evidence schema below;
// no implementation of any of these states exists until WU38-03)
// ---------------------------------------------------------------------------

export const SandboxTerminationReasonSchema = z.enum([
  "completed",
  "cancelled",
  "budget_exhausted",
  "policy_denied",
  "resource_limit_exceeded",
  "sandbox_creation_failed",
  "cleanup_failed",
  // M38-WU02 addition: honestly distinguishes "no process was ever
  // launched because this backend does not yet implement launchProcess"
  // from every other reason above, all of which presuppose a process
  // attempt actually happened. Reusing "cancelled" or "policy_denied"
  // for this would misrepresent what occurred; the request/import
  // fallback is the correct action either way (sandbox-fallback-policy.ts).
  "not_yet_supported",
]);
export type SandboxTerminationReason = z.infer<typeof SandboxTerminationReasonSchema>;

export const SandboxCleanupStatusSchema = z.enum(["cleaned", "cleanup_failed"]);
export type SandboxCleanupStatus = z.infer<typeof SandboxCleanupStatusSchema>;

// ---------------------------------------------------------------------------
// Evidence (build spec Sec 6 "Evidence") -- the future shape a real
// sandboxed run's evidence packet must satisfy; no code in this Work Unit
// produces one.
// ---------------------------------------------------------------------------

export const SandboxEvidenceSchema = z
  .object({
    backendId: SandboxBackendIdSchema,
    backendVersion: z.string().min(1).max(MAX_BOUNDED_KEY_CHARS),
    capabilities: z.array(SandboxCapabilitySchema).max(MAX_LIST_ITEMS),
    mounts: z.array(SandboxMountSchema).max(MAX_LIST_ITEMS),
    /** Variable NAMES only, never values -- this schema has no field capable of carrying a secret value, by design. */
    environmentVariableNames: z.array(z.string().min(1).max(MAX_BOUNDED_KEY_CHARS)).max(MAX_LIST_ITEMS),
    networkPolicy: SandboxNetworkPolicySchema,
    resourcePolicy: SandboxResourcePolicySchema,
    commandsExecuted: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    outputBytesCaptured: z.number().int().nonnegative(),
    filesChanged: z.array(z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS)).max(MAX_LIST_ITEMS),
    terminationReason: SandboxTerminationReasonSchema,
    cleanupStatus: SandboxCleanupStatusSchema,
    residualRisk: z.string().min(1).max(MAX_BOUNDED_TEXT_CHARS),
  })
  .strict();
export type SandboxEvidence = z.infer<typeof SandboxEvidenceSchema>;
