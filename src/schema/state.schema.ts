import { z } from "zod";
import { WorkGraphSchema } from "./work-graph.schema.js";
import { CheckpointSchema } from "./checkpoint.schema.js";
import { AgentPacketMetadataSchema } from "./agent-packet.schema.js";
import { ReviewAcknowledgmentStateSchema } from "./review-acknowledgment.schema.js";

export const ProjectStatusSchema = z.enum([
  "draft",
  "planned",
  "in_progress",
  "blocked",
  "review",
  "done",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const StateModelSchema = z.object({
  version: z.string(),
  projectStatus: ProjectStatusSchema,
  currentMilestoneId: z.string().nullable(),
  currentWorkUnitId: z.string().nullable(),
  workGraph: WorkGraphSchema,
  checkpoints: z.array(CheckpointSchema),
  lastAgentPacket: AgentPacketMetadataSchema.nullable(),
  nextRecommendedCommand: z.string().nullable(),
  lastUpdatedAt: z.string(),
  /** M9 §7.2: optional, additive. Missing entirely on pre-M9 state files. */
  review: ReviewAcknowledgmentStateSchema.optional(),
});
export type StateModel = z.infer<typeof StateModelSchema>;
