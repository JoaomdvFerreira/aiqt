import { z } from "zod";

export const MilestoneStatusSchema = z.enum([
  "pending",
  "active",
  "blocked",
  "done",
]);
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: MilestoneStatusSchema,
});
export type Milestone = z.infer<typeof MilestoneSchema>;
