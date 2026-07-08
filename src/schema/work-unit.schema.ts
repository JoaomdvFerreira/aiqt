import { z } from "zod";

export const WorkUnitStatusSchema = z.enum([
  "ready",
  "planned",
  "in_progress",
  "needs_review",
  "done",
  "replanned",
  "cancelled",
]);
export type WorkUnitStatus = z.infer<typeof WorkUnitStatusSchema>;

export const WorkUnitSchema = z.object({
  id: z.string(),
  milestoneId: z.string(),
  title: z.string(),
  objective: z.string(),
  scope: z.array(z.string()),
  outOfScope: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  agentContextRefs: z.array(z.string()),
  suggestedFiles: z.array(z.string()),
  validationCommands: z.array(z.string()),
  status: WorkUnitStatusSchema,
  dependencies: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkUnit = z.infer<typeof WorkUnitSchema>;
