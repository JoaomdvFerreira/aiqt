import { z } from "zod";
import {
  MilestonePlanInputSchema,
  WorkUnitPlanInputSchema,
  DependencyPlanInputSchema,
} from "./plan-input.schema.js";

/**
 * M17 §7/M17-RC1 §10: the smallest additive contract needed to declare a
 * refinement of one existing work unit. Reuses the existing milestone/work-
 * unit/dependency plan input schemas verbatim -- only the `extension`
 * envelope (entry/exit keys and a reason) is new. The on-wire shape is kept
 * compatible with M17 for existing refinement payloads; RC1 only changes
 * the CLI flag and internal terminology that select this operation.
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

/**
 * M17-RC1 §5: the append-mode payload. No target work unit and no
 * entry/exit/reason envelope is required -- milestones and work units are
 * both optional (a dependency-only append supplies neither), since append
 * never targets or replaces an existing record. milestoneClientKey on a
 * work unit, and fromClientKey/toClientKey on a dependency, may each name
 * either a new clientKey declared in this same payload or an existing
 * canonical id already in the graph.
 */
export const PlanAppendInputSchema = z
  .object({
    milestones: z.array(MilestonePlanInputSchema).default([]),
    workUnits: z.array(WorkUnitPlanInputSchema).default([]),
    dependencies: z.array(DependencyPlanInputSchema).default([]),
  })
  .strict();
export type PlanAppendInput = z.infer<typeof PlanAppendInputSchema>;
