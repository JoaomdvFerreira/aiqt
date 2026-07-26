import { z } from "zod";
import { WorkGraphSchema } from "./work-graph.schema.js";
import { CheckpointSchema } from "./checkpoint.schema.js";
import { AgentPacketMetadataSchema } from "./agent-packet.schema.js";
import { ReviewAcknowledgmentStateSchema } from "./review-acknowledgment.schema.js";
import { IssueStateSchema } from "./issue-state.schema.js";
import { CheckpointAmendmentSchema } from "./checkpoint-amendment.schema.js";
import { EvidenceStateSchema } from "./evidence.schema.js";
import { WorkspaceStateSchema } from "./managed-workspace.schema.js";
import { ExecutionSessionSchema, MAX_SESSIONS } from "./execution-session.schema.js";
import { ExecutionAdapterRequestSchema, MAX_ADAPTER_REQUESTS } from "./execution-adapter-request.schema.js";
import { EvidenceGateConfigurationSchema } from "./evidence-gate-policy.schema.js";

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
  /** M26 §3: optional, additive. Missing entirely on pre-M26 state files; never materialized by a read-only command. */
  executionSessions: z.array(ExecutionSessionSchema).max(MAX_SESSIONS).optional(),
  /** M27 §3.1: optional, additive. Missing entirely on pre-M27 state files; never materialized by a read-only command. */
  executionAdapterRequests: z.array(ExecutionAdapterRequestSchema).max(MAX_ADAPTER_REQUESTS).optional(),
  /** M28 §3: optional, additive. Missing entirely on pre-M28 state files; never materialized by a read-only command. */
  evidenceGate: EvidenceGateConfigurationSchema.optional(),
});
export type StateModel = z.infer<typeof StateModelSchema>;
