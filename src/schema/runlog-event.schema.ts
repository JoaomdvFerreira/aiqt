import { z } from "zod";

export const RunlogEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  // "cli" added in M9 for review.finding_acknowledged/packet.cancelled events
  // per the build spec's exact required event shape; additive, backward
  // compatible with all existing runlog lines.
  actor: z.enum(["human", "aiqt", "agent", "system", "cli"]),
  summary: z.string(),
  relatedIds: z.array(z.string()),
  data: z.record(z.unknown()).optional(),
});
export type RunlogEvent = z.infer<typeof RunlogEventSchema>;
