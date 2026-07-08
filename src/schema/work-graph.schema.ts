import { z } from "zod";
import { MilestoneSchema } from "./milestone.schema.js";
import { WorkUnitSchema } from "./work-unit.schema.js";
import { DependencySchema } from "./dependency.schema.js";

export const WorkGraphSchema = z.object({
  milestones: z.array(MilestoneSchema),
  workUnits: z.array(WorkUnitSchema),
  dependencies: z.array(DependencySchema),
});
export type WorkGraph = z.infer<typeof WorkGraphSchema>;
