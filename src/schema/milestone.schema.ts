import { z } from "zod";

export const MilestoneStatusSchema = z.enum(["ready", "planned"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;

export const MilestoneSchema = z.object({
  id: z.string(),
  title: z.string(),
  objective: z.string(),
  status: MilestoneStatusSchema,
  workUnitIds: z.array(z.string()),
});
export type Milestone = z.infer<typeof MilestoneSchema>;
