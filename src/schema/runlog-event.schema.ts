import { z } from "zod";

export const RunlogEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  actor: z.enum(["human", "aiqt", "agent", "system"]),
  summary: z.string(),
  relatedIds: z.array(z.string()),
  data: z.record(z.unknown()).optional(),
});
export type RunlogEvent = z.infer<typeof RunlogEventSchema>;
