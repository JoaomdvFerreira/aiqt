import { z } from "zod";

/** M25 §5.2: one active binding per Work Unit; one active isolated binding per workspace; multiple active shared bindings may reference one shared workspace. Binding never changes Work Unit status. */
export const WorkspaceBindingStatusSchema = z.enum(["active", "released"]);
export type WorkspaceBindingStatus = z.infer<typeof WorkspaceBindingStatusSchema>;

export const WorkspaceBindingSchema = z
  .object({
    id: z.string().min(1),
    workUnitId: z.string().min(1),
    workspaceId: z.string().min(1),
    status: WorkspaceBindingStatusSchema,
    boundAt: z.string(),
    releasedAt: z.string().optional(),
  })
  .strict();
export type WorkspaceBinding = z.infer<typeof WorkspaceBindingSchema>;
