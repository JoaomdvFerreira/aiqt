import { z } from "zod";
import { ExecutionMetadataSchema } from "./execution-metadata.schema.js";

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
  /** M17 §8.4: additive, optional replanning metadata. Set only when this work unit is replaced via `aiqt plan --extend`. Absent means never replanned. */
  replanReason: z.string().optional(),
  /** M17 §8.4: additive, optional. IDs of the new work units that replace this placeholder. Absent means never replanned. */
  replacedByWorkUnitIds: z.array(z.string()).optional(),
  /** M24 §2.1: additive, optional workspace-assignment/parallel-policy metadata. Missing entirely on every pre-M24 Work Unit; never materialized by a read-only command. */
  executionMetadata: ExecutionMetadataSchema.optional(),
});
export type WorkUnit = z.infer<typeof WorkUnitSchema>;
