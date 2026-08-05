import type { SandboxHostPlatform, SandboxIsolationPrimitive, SandboxSupportStatus } from "../schema/sandbox-backend.schema.js";

/**
 * M38-WU01 (build spec Sec 5 "Platform Strategy"). A pure function over
 * an explicit platform string -- it does not itself call
 * `process.platform` (the CLI-integration Work Unit, WU38-04, is where a
 * real caller would supply that value), and it never launches anything.
 * See docs/engineering/m38-sandbox-platform-decision.md for the full
 * rationale this function encodes.
 *
 * Decision (Sec 5: "Valid initial outcomes include Linux
 * container/runtime isolation, Linux namespace isolation, or another
 * primitive with equivalent enforceable guarantees. Windows support
 * must be explicit: supported through a real backend; supported only
 * through WSL/container infrastructure; or unsupported initially"):
 *
 * - `linux`: supported, backend `oci-container@1` (an OCI-compatible
 *   container runtime -- Docker or Podman -- providing namespace/cgroup
 *   isolation as its enforcement primitive).
 * - `darwin`/`win32`/anything else: unsupported initially. Chosen over
 *   "supported only through WSL/container infrastructure" because this
 *   milestone's CI (`.github/workflows/validate.yml`) runs exclusively
 *   on `ubuntu-latest` -- claiming Windows/macOS support via Docker
 *   Desktop's own Linux VM would be a guarantee this repository's own
 *   CI cannot verify, which build spec Sec 5's "must not claim
 *   cross-platform parity without equivalent guarantees" forbids.
 *   Revisiting this is a reasonable future decision, not a permanent one
 *   -- it is deliberately not baked into this function's name or the
 *   schema's `SandboxHostPlatformSchema` enum, which already reserves
 *   room for it.
 */
export interface SandboxPlatformDecision {
  platform: SandboxHostPlatform;
  supportStatus: SandboxSupportStatus;
  backendId: string | null;
  isolationPrimitive: SandboxIsolationPrimitive;
  reason: string;
}

const LINUX_BACKEND_ID = "oci-container@1";

/** Normalizes an arbitrary platform string (as Node's `process.platform` would supply, or a test double) into the closed set this decision distinguishes between. */
export function normalizeSandboxHostPlatform(rawPlatform: string): SandboxHostPlatform {
  if (rawPlatform === "linux") return "linux";
  if (rawPlatform === "darwin") return "darwin";
  if (rawPlatform === "win32") return "win32";
  return "other";
}

export function decideSandboxPlatformSupport(rawPlatform: string): SandboxPlatformDecision {
  const platform = normalizeSandboxHostPlatform(rawPlatform);

  if (platform === "linux") {
    return {
      platform,
      supportStatus: "supported",
      backendId: LINUX_BACKEND_ID,
      isolationPrimitive: "oci_container",
      reason: "Linux is the initial supported platform, using an OCI-compatible container runtime for namespace/cgroup isolation. Verified by this repository's own Node 24 CI, which runs exclusively on ubuntu-latest.",
    };
  }

  if (platform === "darwin") {
    return {
      platform,
      supportStatus: "unsupported",
      backendId: null,
      isolationPrimitive: "none",
      reason: "macOS is unsupported initially. A Docker Desktop-backed container runtime would provide isolation via its own internal Linux VM, but this repository's CI cannot verify that guarantee, and claiming it without verification would violate the build spec's cross-platform-parity requirement.",
    };
  }

  if (platform === "win32") {
    return {
      platform,
      supportStatus: "unsupported",
      backendId: null,
      isolationPrimitive: "none",
      reason: "Windows is unsupported initially, for the same reason as macOS -- WSL2/Docker Desktop container isolation is plausible but unverified by this repository's own CI, which runs exclusively on ubuntu-latest.",
    };
  }

  return {
    platform,
    supportStatus: "unsupported",
    backendId: null,
    isolationPrimitive: "none",
    reason: `Platform "${rawPlatform}" is not one this milestone evaluated. Unsupported by default (fail-closed), not assumed compatible.`,
  };
}
