import { z } from "zod";

export const WorkUnitStatusSchema = z.enum([
  "pending",
  "active",
  "blocked",
  "in_review",
  "done",
]);
export type WorkUnitStatus = z.infer<typeof WorkUnitStatusSchema>;

export const WorkUnitSchema = z.object({
  id: z.string(),
  milestoneId: z.string(),
  title: z.string(),
  status: WorkUnitStatusSchema,
});
export type WorkUnit = z.infer<typeof WorkUnitSchema>;
