import { z } from "zod";

export const MilestonePlanInputSchema = z
  .object({
    clientKey: z.string().min(1),
    title: z.string().min(1),
    objective: z.string().min(1),
  })
  .strict();
export type MilestonePlanInput = z.infer<typeof MilestonePlanInputSchema>;

export const WorkUnitPlanInputSchema = z
  .object({
    clientKey: z.string().min(1),
    milestoneClientKey: z.string().min(1),
    title: z.string().min(1),
    objective: z.string().min(1),
    scope: z.array(z.string().min(1)).min(1),
    outOfScope: z.array(z.string().min(1)).min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    agentContextRefs: z.array(z.string()).default([]),
    suggestedFiles: z.array(z.string()).default([]),
    validationCommands: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type WorkUnitPlanInput = z.infer<typeof WorkUnitPlanInputSchema>;

export const DependencyPlanInputSchema = z
  .object({
    fromClientKey: z.string().min(1),
    toClientKey: z.string().min(1),
    type: z.enum(["blocks", "requires", "relates_to"]),
    reason: z.string().nullable().optional(),
  })
  .strict();
export type DependencyPlanInput = z.infer<typeof DependencyPlanInputSchema>;

export const PlanInputSchema = z
  .object({
    milestones: z.array(MilestonePlanInputSchema).min(1),
    workUnits: z.array(WorkUnitPlanInputSchema).min(1),
    dependencies: z.array(DependencyPlanInputSchema).default([]),
  })
  .strict();
export type PlanInput = z.infer<typeof PlanInputSchema>;
