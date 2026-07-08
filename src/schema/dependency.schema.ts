import { z } from "zod";

export const DependencyTypeSchema = z.enum(["blocks", "requires", "relates_to"]);
export type DependencyType = z.infer<typeof DependencyTypeSchema>;

export const DependencySchema = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  type: DependencyTypeSchema,
  reason: z.string().nullable(),
});
export type Dependency = z.infer<typeof DependencySchema>;
