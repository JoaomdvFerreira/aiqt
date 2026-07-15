import { z } from "zod";

/** M14 §11.1: additive, optional packet audit flags. Mirrors the authoritative agent_packet.created runlog data; never the sole storage location. */
export const PacketGuidanceFlagsSchema = z.object({
  includesDesignGuidance: z.boolean(),
  includesWorkingDirectoryDiscipline: z.boolean(),
  includesComponentSystemGuidance: z.boolean(),
  includesRecoveryGuidance: z.boolean(),
});
export type PacketGuidanceFlags = z.infer<typeof PacketGuidanceFlagsSchema>;

export const AgentPacketMetadataSchema = z.object({
  id: z.string(),
  workUnitId: z.string(),
  milestoneId: z.string(),
  createdAt: z.string(),
  format: z.enum(["markdown"]),
  contentHash: z.string(),
  sourceCommand: z.literal("aiqt next"),
  /** M14 §11.2: optional latest-packet mirror only. The authoritative historical record is the agent_packet.created runlog event data. */
  renderedSections: z.array(z.string()).optional(),
  guidanceFlags: PacketGuidanceFlagsSchema.optional(),
});
export type AgentPacketMetadata = z.infer<typeof AgentPacketMetadataSchema>;
