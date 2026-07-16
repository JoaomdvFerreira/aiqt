import { z } from "zod";
import {
  MilestonePlanInputSchema,
  WorkUnitPlanInputSchema,
  DependencyPlanInputSchema,
} from "./plan-input.schema.js";

/**
 * M17 §7: the smallest additive contract needed to declare a plan
 * extension. Reuses the existing milestone/work-unit/dependency plan input
 * schemas verbatim -- only the `extension` envelope (entry/exit keys and a
 * reason) is new.
 */
export const PlanExtensionMetaSchema = z
  .object({
    entryWorkUnitClientKeys: z.array(z.string().min(1)).min(1),
    exitWorkUnitClientKeys: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  })
  .strict();
export type PlanExtensionMeta = z.infer<typeof PlanExtensionMetaSchema>;

export const PlanExtensionInputSchema = z
  .object({
    extension: PlanExtensionMetaSchema,
    milestones: z.array(MilestonePlanInputSchema).min(1),
    workUnits: z.array(WorkUnitPlanInputSchema).min(1),
    dependencies: z.array(DependencyPlanInputSchema).default([]),
  })
  .strict();
export type PlanExtensionInput = z.infer<typeof PlanExtensionInputSchema>;
