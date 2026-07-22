import { z } from "zod";

/**
 * M25 §5: shared by managed-workspace.schema.ts and
 * pending-workspace-operation.schema.ts. Kept in its own module (rather
 * than re-exported from either) so those two files can import each other
 * without an ES module circular-initialization hazard.
 */
export const WorkspaceAccessSchema = z.enum(["read_only", "read_write"]);
export type ManagedWorkspaceAccess = z.infer<typeof WorkspaceAccessSchema>;
