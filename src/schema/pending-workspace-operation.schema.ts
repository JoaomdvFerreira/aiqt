import { z } from "zod";
import { WorkspaceAccessSchema } from "./workspace-access.schema.js";

/** M25 §5.3: canonical recovery markers. Only currently pending operations are stored; completed operations are removed after canonical finalization. */
export const PendingWorkspaceOperationTypeSchema = z.enum(["prepare", "release"]);
export type PendingWorkspaceOperationType = z.infer<typeof PendingWorkspaceOperationTypeSchema>;

export const PendingWorkspaceOperationSchema = z
  .object({
    id: z.string().min(1),
    type: PendingWorkspaceOperationTypeSchema,
    workUnitId: z.string().min(1),
    workspaceId: z.string().min(1),
    workspaceSeriesKey: z.string().min(1),
    generation: z.number().int().positive(),
    providerId: z.enum(["shared-repository@1", "git-worktree@1"]),
    expectedWorkspacePath: z.string().min(1).max(4096),
    expectedBranchName: z.string().max(180).optional(),
    baseCommit: z.string().regex(/^[0-9a-f]{40}$/i),
    createdAt: z.string(),
    /**
     * M25 §15.1: recovery must finalize a pending *prepare* using only the
     * pending operation record -- so the ManagedWorkspace fields it cannot
     * otherwise derive (assignmentKey/access) travel with the pending
     * operation itself rather than requiring a fresh lookup elsewhere.
     * Unused for a pending *release* (the released workspace already has
     * these fields).
     */
    assignmentKey: z.string().min(1).optional(),
    access: WorkspaceAccessSchema.optional(),
  })
  .strict();
export type PendingWorkspaceOperation = z.infer<typeof PendingWorkspaceOperationSchema>;
