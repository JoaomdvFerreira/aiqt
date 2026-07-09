import { z } from "zod";

export const AgentPacketMetadataSchema = z.object({
  id: z.string(),
  workUnitId: z.string(),
  milestoneId: z.string(),
  createdAt: z.string(),
  format: z.enum(["markdown"]),
  contentHash: z.string(),
  sourceCommand: z.literal("aiqt next"),
});
export type AgentPacketMetadata = z.infer<typeof AgentPacketMetadataSchema>;
