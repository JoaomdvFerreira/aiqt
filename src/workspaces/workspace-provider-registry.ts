import type { ManagedWorkspaceMode } from "../schema/managed-workspace.schema.js";
import type { WorkspaceProviderId } from "../schema/managed-workspace.schema.js";

/**
 * M25 §2: the exact, static, compile-time-known provider set. Extending
 * this list is a source-code change, never a runtime one -- no package
 * discovery, no filesystem plugin discovery, no environment-controlled
 * registration, no dynamic import, no CLI `--provider` escape hatch.
 */
export const SUPPORTED_WORKSPACE_PROVIDERS = ["shared-repository@1", "git-worktree@1"] as const;

export function isSupportedWorkspaceProviderId(value: unknown): value is WorkspaceProviderId {
  return typeof value === "string" && (SUPPORTED_WORKSPACE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * M25 §2: fixed M24-mode-to-provider mapping. `none` resolves to no
 * provider at all -- not an error, simply nothing to prepare. Canonical
 * state and CLI input cannot override this mapping.
 */
export function resolveProviderForWorkspaceMode(
  mode: ManagedWorkspaceMode | "none",
): WorkspaceProviderId | "no_provider" {
  switch (mode) {
    case "shared":
      return "shared-repository@1";
    case "isolated":
      return "git-worktree@1";
    case "none":
      return "no_provider";
  }
}
