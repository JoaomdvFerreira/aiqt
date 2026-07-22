import { z } from "zod";
import { WorkGraphSchema } from "./work-graph.schema.js";
import { CheckpointSchema } from "./checkpoint.schema.js";
import { AgentPacketMetadataSchema } from "./agent-packet.schema.js";
import { ReviewAcknowledgmentStateSchema } from "./review-acknowledgment.schema.js";
import { IssueStateSchema } from "./issue-state.schema.js";
import { CheckpointAmendmentSchema } from "./checkpoint-amendment.schema.js";
import { EvidenceStateSchema } from "./evidence.schema.js";
import { WorkspaceStateSchema } from "./managed-workspace.schema.js";

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
  /** M11 §8.2: optional, additive. Missing entirely on pre-M11 state files. */
  issues: IssueStateSchema.optional(),
  /** M12 §6.1: optional, additive. Missing entirely on pre-M12 state files. */
  checkpointAmendments: z.array(CheckpointAmendmentSchema).optional(),
  /** M22-WU02: optional, additive. Missing entirely on pre-M22 state files. */
  evidence: EvidenceStateSchema.optional(),
  /** M25 §5: optional, additive. Missing entirely on pre-M25 state files. */
  workspace: WorkspaceStateSchema.optional(),
});
export type StateModel = z.infer<typeof StateModelSchema>;
