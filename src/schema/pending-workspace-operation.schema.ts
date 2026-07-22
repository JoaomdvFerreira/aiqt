import { z } from "zod";

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
  })
  .strict();
export type PendingWorkspaceOperation = z.infer<typeof PendingWorkspaceOperationSchema>;
