import { z } from "zod";

export const DependencySchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  type: z.string(),
});
export type Dependency = z.infer<typeof DependencySchema>;
