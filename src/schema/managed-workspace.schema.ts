import { z } from "zod";
import { WorkspaceBindingSchema } from "./workspace-binding.schema.js";
import { PendingWorkspaceOperationSchema } from "./pending-workspace-operation.schema.js";

/** M25 §21: state-growth limits, validated before mutation. Not increased without review. */
export const MANAGED_WORKSPACES_MAX = 5000;
export const WORKSPACE_BINDINGS_MAX = 10000;
export const PENDING_OPERATIONS_MAX = 100;
export const ACTIVE_BINDING_PER_WORK_UNIT_MAX = 1;
export const ACTIVE_ISOLATED_BINDING_PER_WORKSPACE_MAX = 1;
export const ACTIVE_SHARED_BINDINGS_PER_WORKSPACE_MAX = 5000;
export const PHYSICAL_PATH_MAX_CHARS = 4096;
export const BRANCH_NAME_MAX_CHARS = 180;
export const WORKSPACE_GENERATION_MAX = Number.MAX_SAFE_INTEGER;
export const INSPECTION_WARNINGS_MAX = 32;
export const STATUS_WORKSPACES_MAX = 5000;
export const SERIALIZED_WORKSPACE_RECORD_MAX_BYTES = 16384;
export const SERIALIZED_PENDING_OPERATION_MAX_BYTES = 8192;

export const WorkspaceProviderIdSchema = z.enum(["shared-repository@1", "git-worktree@1"]);
export type WorkspaceProviderId = z.infer<typeof WorkspaceProviderIdSchema>;

export const WorkspaceModeSchema = z.enum(["shared", "isolated"]);
export type ManagedWorkspaceMode = z.infer<typeof WorkspaceModeSchema>;

export const WorkspaceAccessSchema = z.enum(["read_only", "read_write"]);
export type ManagedWorkspaceAccess = z.infer<typeof WorkspaceAccessSchema>;

export const ManagedWorkspaceLifecycleStatusSchema = z.enum(["ready", "released"]);
export type ManagedWorkspaceLifecycleStatus = z.infer<typeof ManagedWorkspaceLifecycleStatusSchema>;

/**
 * M25 §5.1: no credentials, remote URL, provider token, agent/session/
 * process data, or mutable observation fields (e.g. dirty status) are
 * ever persisted here -- those are derived on demand by workspace
 * inspection (WU25-04+), never stored. `branchName` is required only for
 * `git-worktree@1`. Released records are immutable historical records,
 * never reactivated or mutated.
 */
export const ManagedWorkspaceSchema = z
  .object({
    id: z.string().min(1),
    workspaceSeriesKey: z.string().min(1),
    generation: z.number().int().positive().max(WORKSPACE_GENERATION_MAX),
    providerId: WorkspaceProviderIdSchema,
    assignmentKey: z.string().min(1).max(128),
    mode: WorkspaceModeSchema,
    access: WorkspaceAccessSchema,
    implementationRoot: z.string().min(1).max(PHYSICAL_PATH_MAX_CHARS),
    workspacePath: z.string().min(1).max(PHYSICAL_PATH_MAX_CHARS),
    branchName: z.string().min(1).max(BRANCH_NAME_MAX_CHARS).optional(),
    baseCommit: z.string().regex(/^[0-9a-f]{40}$/i),
    lifecycleStatus: ManagedWorkspaceLifecycleStatusSchema,
    createdAt: z.string(),
    releasedAt: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.providerId === "git-worktree@1" && value.branchName === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "branchName is required for provider 'git-worktree@1'",
        path: ["branchName"],
      });
    }
    if (JSON.stringify(value).length > SERIALIZED_WORKSPACE_RECORD_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ManagedWorkspace exceeds serialized_workspace_record_max_bytes (${SERIALIZED_WORKSPACE_RECORD_MAX_BYTES})`,
      });
    }
  });
export type ManagedWorkspace = z.infer<typeof ManagedWorkspaceSchema>;

/**
 * M25 §5: additive, optional Work Unit-independent workspace state.
 * Missing entirely on every pre-M25 state file; never materialized by a
 * read-only command.
 */
export const WorkspaceStateSchema = z.object({
  managedWorkspaces: z.array(ManagedWorkspaceSchema).max(MANAGED_WORKSPACES_MAX),
  workspaceBindings: z.array(WorkspaceBindingSchema).max(WORKSPACE_BINDINGS_MAX),
  pendingWorkspaceOperations: z.array(PendingWorkspaceOperationSchema).max(PENDING_OPERATIONS_MAX),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;
