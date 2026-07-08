import { z } from "zod";

export const CheckpointSchema = z.object({
  id: z.string(),
  workUnitId: z.string(),
  summary: z.string(),
  createdAt: z.string(),
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
